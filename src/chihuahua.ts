import * as THREE from 'three'
import { bindSmoothSurface, createSmoothSurface, ellipsoidDistance, smoothUnion } from './smooth-surface'

const atlas = new THREE.Texture()
atlas.colorSpace = THREE.SRGBColorSpace
let ready: Promise<void> | undefined
export function loadChihuahuaPhotos() {
  return ready ??= new THREE.ImageLoader().loadAsync(`${import.meta.env.BASE_URL}models/chihuahua-photo-atlas.png`).then(image => {
    atlas.image = image; atlas.needsUpdate = true
  }).catch(error => { ready = undefined; throw error })
}

export function createChihuahua() {
  const root = new THREE.Group(), body = new THREE.Group()
  root.name = 'chihuahua-visitor'; root.scale.setScalar(1.8); root.add(body)
  const geometries: THREE.BufferGeometry[] = []
  const coatMap = atlas.clone(); coatMap.offset.set(.005, .005); coatMap.repeat.set(.49, .49)
  const coat = new THREE.MeshStandardMaterial({ map: coatMap, roughness: .96 })
  const faceMaterial = new THREE.MeshStandardMaterial({ color: 0xc8aa80, roughness: .94 })
  faceMaterial.onBeforeCompile = shader => {
    shader.uniforms.dogPhoto = { value: atlas }
    shader.vertexShader = 'attribute vec2 photoUv; attribute float photoDepth; varying vec2 dogUv; varying float dogDepth;\n' + shader.vertexShader
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\ndogUv=photoUv; dogDepth=photoDepth;')
    shader.fragmentShader = 'uniform sampler2D dogPhoto; varying vec2 dogUv; varying float dogDepth;\n' + shader.fragmentShader
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      vec2 uv=clamp(dogUv,0.002,0.998);
      vec4 front=texture2D(dogPhoto,vec2(.015,.51)+uv*vec2(.475,.465));
      vec4 back=texture2D(dogPhoto,vec2(.515,.51)+vec2(1.0-uv.x,uv.y)*vec2(.475,.465));
      vec4 photo=mix(back,front,smoothstep(-.06,.06,dogDepth));
      // Planar fur on the cheeks replaces the stretched edge of the frontal portrait.
      vec3 side=texture2D(dogPhoto,vec2(.515,.005)+vec2(clamp((dogDepth+.4)/.8,.05,.95),uv.y)*vec2(.475,.485)).rgb;
      float portrait=smoothstep(.04,.19,abs(dogDepth));
      diffuseColor.rgb=mix(side,photo.rgb,photo.a*portrait);
    `)
  }
  faceMaterial.customProgramCacheKey = () => 'chihuahua-photo-v1'
  const mesh = (parent: THREE.Object3D, name: string, geometry: THREE.BufferGeometry, material = coat) => {
    geometries.push(geometry)
    const result = new THREE.Mesh(geometry, material); result.name = name; result.castShadow = true; result.receiveShadow = true; parent.add(result); return result
  }
  const head = new THREE.Group(); head.position.set(0, 1.62, .58); body.add(head)
  const headGeometry = new THREE.SphereGeometry(1, 64, 48), hp = headGeometry.getAttribute('position')
  for (let i = 0; i < hp.count; i++) {
    const x = hp.getX(i) * .39, y = .045 + hp.getY(i) * .39, z = hp.getZ(i) * .32
    const front = THREE.MathUtils.smoothstep(hp.getZ(i), 0, .55)
    const muzzle = .18 * Math.exp(-((x / .145) ** 2 + ((y + .055) / .13) ** 2))
    const eyes = .055 * Math.exp(-(((Math.abs(x) - .205) / .125) ** 2 + ((y - .06) / .12) ** 2))
    hp.setXYZ(i, x, y, z + front * (muzzle + eyes))
  }
  headGeometry.computeVertexNormals()
  const face = mesh(head, 'continuous-face', headGeometry, faceMaterial)
  const earShape = new THREE.Shape()
  earShape.moveTo(-.12, 0); earShape.bezierCurveTo(-.2, .16, -.17, .33, -.08, .43)
  earShape.bezierCurveTo(.01, .35, .17, .18, .13, .045); earShape.quadraticCurveTo(0, -.075, -.12, 0)
  const ears = [-1, 1].map(side => {
    const ear = mesh(head, 'small-ear', new THREE.ExtrudeGeometry(earShape, { depth: .045, bevelEnabled: true, bevelThickness: .025, bevelSize: .025, bevelSegments: 3, steps: 1, curveSegments: 14 }), faceMaterial)
    ear.position.set(side * .29, .255, -.045); ear.rotation.z = -side * .4
    return { ear, side }
  })
  for (const object of [face, ...ears.map(e => e.ear)]) {
    const positions = object.geometry.getAttribute('position'), normals = object.geometry.getAttribute('normal'), uv: number[] = [], depth: number[] = [], point = new THREE.Vector3()
    object.updateMatrix()
    for (let i = 0; i < positions.count; i++) {
      point.fromBufferAttribute(positions, i).applyMatrix4(object.matrix)
      // Anchor the portrait's nose to the modeled muzzle; the source portrait is off-center.
      const feature = object === face ? 1 - THREE.MathUtils.smoothstep(point.y, .22, .38) : 0
      let faceX = point.x, faceY = point.y
      if (object === face) {
        // Enlarge each eye locally, keeping the nose, mouth and outward gaze in place.
        for (const side of [-1, 1]) {
          const dx = point.x - side * .205, dy = point.y - .06
          const weight = .12 * Math.exp(-((dx / .14) ** 2 + (dy / .12) ** 2))
          faceX -= dx * weight; faceY -= dy * weight
        }
      }
      const photoX = faceX / THREE.MathUtils.lerp(1, .85, feature) + .039 * feature
      const photoY = (faceY + .055) / THREE.MathUtils.lerp(1, .88, feature) - .055 + .08 * feature
      uv.push((photoX + .55) / 1.1, (photoY + .345) / 1.055)
      depth.push(object === face ? positions.getZ(i) : normals.getZ(i) * .33)
    }
    object.geometry.setAttribute('photoUv', new THREE.Float32BufferAttribute(uv, 2))
    object.geometry.setAttribute('photoDepth', new THREE.Float32BufferAttribute(depth, 1))
  }
  const legs: { leg: THREE.Group; phase: number }[] = []
  for (const z of [-.48, .43]) for (const side of [-1, 1]) {
    const leg = new THREE.Group(); leg.position.set(side * .25, .7, z); body.add(leg)
    legs.push({ leg, phase: (z > 0 ? 0 : Math.PI * .85) + (side > 0 ? .4 : 0) })
  }
  const torsoGeometry = createSmoothSurface(new THREE.Vector3(-.55, -.06, -.95), new THREE.Vector3(.55, 1.88, .95), (x, y, z) => {
    let d = smoothUnion(ellipsoidDistance(x, y - .88, z + .08, .35, .33, .68), ellipsoidDistance(x, y - 1.02, z - .36, .27, .28, .3), .13)
    // A tapered neck grows out of the chest and overlaps the base of the head.
    const neckT = THREE.MathUtils.clamp(((y - 1.17) * .27 + (z - .38) * .18) / (.27 ** 2 + .18 ** 2), 0, 1)
    const neck = Math.hypot(x, y - (1.17 + neckT * .27), z - (.38 + neckT * .18)) - THREE.MathUtils.lerp(.215, .185, neckT)
    d = smoothUnion(d, neck, .11)
    for (const { leg } of legs) {
      const lx = x - leg.position.x, lz = z - leg.position.z
      const cy = THREE.MathUtils.clamp(y, .15, .69)
      const radius = THREE.MathUtils.lerp(.075, .12, THREE.MathUtils.smoothstep(y, .2, .7))
      const limb = Math.hypot(lx, y - cy, lz) - radius
      const paw = ellipsoidDistance(lx, y - .115, lz - .035, .1, .095, .145)
      d = smoothUnion(d, smoothUnion(limb, paw, .06), .13)
    }
    return d
  }, 48)
  const uv: number[] = [], positions = torsoGeometry.getAttribute('position')
  for (let i = 0; i < positions.count; i++) uv.push((positions.getZ(i) + .95) / 1.9, positions.getY(i) / 1.88)
  torsoGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  const torso = mesh(body, 'continuous-body', torsoGeometry)
  const deformBody = bindSmoothSurface(torso, legs.map(entry => entry.leg), point => {
    const nearest = legs.reduce((best, entry, index) => {
      const distance = Math.hypot(point.x - entry.leg.position.x, point.z - entry.leg.position.z)
      return distance < best.distance ? { index, distance } : best
    }, { index: 0, distance: Infinity })
    return legs.map((_, index) => index === nearest.index ? 1 - THREE.MathUtils.smoothstep(point.y, .4, .8) : 0)
  })
  const tail = mesh(body, 'tail', new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, .22, -.15), new THREE.Vector3(0, .39, -.12),
    new THREE.Vector3(0, .44, .05), new THREE.Vector3(0, .35, .16),
  ]), 20, .047, 8, false))
  tail.position.set(0, 1.02, -.7)
  return {
    root,
    animate(time: number) {
      const stride = time * 23
      body.position.y = .08 + Math.sin(stride * 2) * .055; body.rotation.x = Math.sin(stride) * .075
      legs.forEach(({ leg, phase }) => { leg.rotation.x = Math.sin(stride + phase) * .75 })
      ears.forEach(({ ear, side }) => { ear.rotation.z = -side * (.4 + Math.sin(stride - .55) * .04) })
      head.rotation.x = Math.sin(stride - .4) * .05; tail.rotation.z = Math.sin(time * 13) * .22
      deformBody()
    },
    dispose() { root.removeFromParent(); geometries.forEach(g => g.dispose()); coatMap.dispose(); coat.dispose(); faceMaterial.dispose() },
  }
}
