import * as THREE from 'three'
import Delaunator from 'delaunator'
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision'
import type { FaceAsset } from './pigeon-data'

let detector: Promise<FaceLandmarker> | undefined
export async function createFace(photo: HTMLCanvasElement, stretch: number) {
  detector ??= FilesetResolver.forVisionTasks(`${import.meta.env.BASE_URL}models/wasm`).then(files =>
    FaceLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetPath: `${import.meta.env.BASE_URL}models/face_landmarker.task`, delegate: 'CPU' },
      runningMode: 'IMAGE', numFaces: 1,
    })).catch(error => { detector = undefined; throw error })
  const model = await detector
  const points = model.detect(photo).faceLandmarks[0]?.slice(0, 468)
  if (!points) throw new Error('얼굴을 찾지 못했어요. 밝은 곳에서 얼굴 전체가 보이는 정면 사진으로 다시 시도해 주세요.')
  const xs = points.map(p => p.x), ys = points.map(p => p.y)
  const width = Math.max(...xs) - Math.min(...xs)
  const height = Math.max(...ys) - Math.min(...ys)
  const cx = (Math.max(...xs) + Math.min(...xs)) / 2
  const cy = (Math.max(...ys) + Math.min(...ys)) / 2
  const nose = points[1], mouth = points[13]
  const triangulation = Delaunator.from(points.map(p => [p.x, p.y]))
  const hull = Array.from(triangulation.hull)
  const boundary = new Set(hull)
  const pos: number[] = [], uv: number[] = [], photoWeights: number[] = []
  // Distance to the actual detected outline gives a soft feather transition,
  // including asymmetric faces, without a floating rectangular photo edge.
  const edgeDistance = (x: number, y: number) => {
    let distance = Infinity
    for (let i = 0; i < hull.length; i++) {
      const a = points[hull[i]], b = points[hull[(i + 1) % hull.length]]
      const ax = (a.x - x) / width, ay = (a.y - y) / height
      const dx = (b.x - a.x) / width, dy = (b.y - a.y) / height
      const t = THREE.MathUtils.clamp(-(ax * dx + ay * dy) / (dx * dx + dy * dy), 0, 1)
      distance = Math.min(distance, Math.hypot(ax + t * dx, ay + t * dy))
    }
    return distance
  }
  for (const [index, p] of points.entries()) {
    const nx = (p.x - nose.x) / width
    const ny = (p.y - (nose.y * .55 + mouth.y * .45)) / height
    // Keep the protrusion narrow across the cheeks and shallow above/below the mouth.
    const muzzle = Math.exp(-((nx / .13) ** 2 + (ny / .16) ** 2) * 1.6)
    const distance = boundary.has(index) ? 0 : edgeDistance(p.x, p.y)
    const roundness = THREE.MathUtils.smoothstep(distance, 0, .22)
    pos.push(-(p.x - cx) / width * .64, -(p.y - cy) / height * .76,
      roundness * (.23 - p.z / width * .5) + muzzle * stretch * THREE.MathUtils.smoothstep(distance, 0, .1))
    uv.push(p.x, 1 - p.y)
    photoWeights.push(THREE.MathUtils.smoothstep(distance, 0, .085))
  }
  const triangles = Array.from(triangulation.triangles)
  // Close the same mesh around the temples, crown and jaw to form the skull.
  // Reuse the outline vertices so there is no gap between face and head.
  let previous = hull
  for (let ring = 1; ring <= 8; ring++) {
    const angle = ring / 9 * Math.PI / 2
    const current: number[] = []
    for (const source of hull) {
      const index = pos.length / 3
      current.push(index)
      pos.push(pos[source * 3] * Math.cos(angle), pos[source * 3 + 1] * Math.cos(angle), -.32 * Math.sin(angle))
      uv.push(0, 0); photoWeights.push(0)
    }
    for (let i = 0; i < hull.length; i++) {
      const next = (i + 1) % hull.length
      triangles.push(previous[i], current[i], previous[next], previous[next], current[i], current[next])
    }
    previous = current
  }
  const back = pos.length / 3
  pos.push(0, 0, -.32); uv.push(0, 0); photoWeights.push(0)
  for (let i = 0; i < hull.length; i++) triangles.push(previous[i], back, previous[(i + 1) % hull.length])
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  geometry.setAttribute('photoWeight', new THREE.Float32BufferAttribute(photoWeights, 1))
  geometry.setIndex(triangles)
  geometry.computeVertexNormals()
  const texture = new THREE.CanvasTexture(photo)
  texture.colorSpace = THREE.SRGBColorSpace
  return buildFace(geometry, texture)
}

function buildFace(geometry: THREE.BufferGeometry, texture: THREE.Texture) {
  const material = new THREE.MeshStandardMaterial({
    map: texture, roughness: .87, side: THREE.DoubleSide,
  })
  const feather = new THREE.Color(0x415d59)
  material.onBeforeCompile = shader => {
    shader.uniforms.featherColor = { value: feather }
    shader.vertexShader = 'attribute float photoWeight; varying float vPhotoWeight;\n' + shader.vertexShader
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvPhotoWeight = photoWeight;')
    shader.fragmentShader = 'uniform vec3 featherColor; varying float vPhotoWeight;\n' + shader.fragmentShader
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb = mix(featherColor, diffuseColor.rgb, vPhotoWeight);')
  }
  material.customProgramCacheKey = () => 'continuous-pigeon-head-v1'
  const mesh = new THREE.Mesh(geometry, material)
  mesh.castShadow = true
  return mesh
}

export function encodeFace(mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>): FaceAsset {
  const geometry = mesh.geometry, source = mesh.material.map!.image as HTMLCanvasElement
  const originalUv = Array.from(geometry.getAttribute('uv').array)
  // Store only the face rectangle, not the rest of the camera frame.
  const faceUv = originalUv.slice(0, 468 * 2)
  const xs = faceUv.filter((_, i) => i % 2 === 0), ys = faceUv.filter((_, i) => i % 2 === 1)
  const minU = Math.max(0, Math.min(...xs)), maxU = Math.min(1, Math.max(...xs))
  const minV = Math.max(0, Math.min(...ys)), maxV = Math.min(1, Math.max(...ys))
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 512
  canvas.getContext('2d')!.drawImage(source, minU * source.width, (1 - maxV) * source.height, (maxU - minU) * source.width, (maxV - minV) * source.height, 0, 0, 512, 512)
  const uv = originalUv.map((value, i) => THREE.MathUtils.clamp(i % 2 ? (value - minV) / (maxV - minV) : (value - minU) / (maxU - minU), 0, 1))
  return { positions: Array.from(geometry.getAttribute('position').array), uv,
    photoWeights: Array.from(geometry.getAttribute('photoWeight').array), indices: Array.from(geometry.index!.array), image: canvas.toDataURL('image/jpeg', .85) }
}

export async function decodeFace(asset: FaceAsset) {
  const image = new Image(); image.src = asset.image; await image.decode()
  const texture = new THREE.Texture(image); texture.colorSpace = THREE.SRGBColorSpace; texture.needsUpdate = true
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(asset.positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(asset.uv, 2))
  geometry.setAttribute('photoWeight', new THREE.Float32BufferAttribute(asset.photoWeights, 1))
  geometry.setIndex(asset.indices); geometry.computeVertexNormals()
  return buildFace(geometry, texture)
}
