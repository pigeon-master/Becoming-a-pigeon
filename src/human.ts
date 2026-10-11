import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { bindSmoothSurface, createSmoothSurface, smoothUnion } from './smooth-surface'

const atlas = new THREE.Texture()
atlas.colorSpace = THREE.SRGBColorSpace
const frontRect = new THREE.Vector4(0, 0, .5, 1), backRect = new THREE.Vector4(.5, 0, .5, 1)
let photoReady: Promise<void> | undefined
export function loadHumanPhotos() {
  const loader = new THREE.ImageLoader()
  return photoReady ??= loader.loadAsync(`${import.meta.env.BASE_URL}models/human-photo-atlas.png`).then(image => {
    atlas.image = image; atlas.needsUpdate = true
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height
    const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0)
    const pixels = context.getImageData(0, 0, image.width, image.height).data
    for (let panel = 0; panel < 2; panel++) {
      let left = image.width, top = image.height, right = 0, bottom = 0
      for (let y = 0; y < image.height; y++) for (let x = panel * image.width / 2; x < (panel + 1) * image.width / 2; x++) {
        if (pixels[(y * image.width + x) * 4 + 3] < 200) continue
        left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y)
      }
      let headX = 0, headPixels = 0
      for (let y = top; y < top + (bottom - top) * .14; y++) for (let x = left; x <= right; x++) {
        if (pixels[(y * image.width + x) * 4 + 3] < 200) continue
        headX += x; headPixels++
      }
      const width = right - left + 1, center = headPixels ? headX / headPixels : (left + right) / 2
      ;(panel ? backRect : frontRect).set((center - width / 2) / image.width, 1 - (bottom + 1) / image.height, width / image.width, (bottom - top + 1) / image.height)
    }
  }).catch(error => { photoReady = undefined; throw error })
}

// Simple photo-projected volumes; the nose is a smooth deformation of the face.
export function createHuman() {
  const root = new THREE.Group(), body = new THREE.Group()
  root.name = 'human-visitor'; root.add(body)
  const sphere = new THREE.SphereGeometry(1, 24, 16)
  const faceGeometry = new THREE.SphereGeometry(1, 64, 48)
  const facePositions = faceGeometry.getAttribute('position')
  for (let i = 0; i < facePositions.count; i++) {
    const x = facePositions.getX(i) * .47, y = .1 + facePositions.getY(i) * .59
    const front = THREE.MathUtils.smoothstep(facePositions.getZ(i), .15, .55)
    const bridge = .055 * Math.exp(-((x / .052) ** 2 + ((y + .025) / .15) ** 2))
    const tip = .09 * Math.exp(-((x / .07) ** 2 + ((y + .12) / .055) ** 2))
    const nostrils = .024 * Math.exp(-(((Math.abs(x) - .065) / .035) ** 2 + ((y + .145) / .04) ** 2))
    facePositions.setZ(i, facePositions.getZ(i) + front * (bridge + tip + nostrils) / .41)
  }
  faceGeometry.computeVertexNormals()
  const shirtGeometry = new THREE.LatheGeometry([
    new THREE.Vector2(0, 3.4), new THREE.Vector2(.54, 3.4), new THREE.Vector2(.55, 3.8),
    new THREE.Vector2(.61, 4.3), new THREE.Vector2(.71, 4.9), new THREE.Vector2(.66, 5.16),
    new THREE.Vector2(.4, 5.4), new THREE.Vector2(.22, 5.46), new THREE.Vector2(0, 5.46),
  ], 32)
  const trouserGeometry = new THREE.CylinderGeometry(.29, .26, 1.54, 24, 4)
  const shinGeometry = new THREE.CylinderGeometry(.26, .2, 1.53, 24, 4)
  const upperSleeveGeometry = new THREE.LatheGeometry([
    new THREE.Vector2(0, -1.08), new THREE.Vector2(.17, -1.08),
    new THREE.Vector2(.18, -.7), new THREE.Vector2(.21, -.25),
    new THREE.Vector2(.24, 0), new THREE.Vector2(.21, .1),
    new THREE.Vector2(.16, .2), new THREE.Vector2(0, .26),
  ], 32)
  const lowerSleeveGeometry = new THREE.CylinderGeometry(.17, .13, .96, 24, 4)
  const neckGeometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 5.34, 0), new THREE.Vector3(0, 5.49, .045),
    new THREE.Vector3(0, 5.65, .2), new THREE.Vector3(0, 5.81, .45),
  ], false, 'centripetal'), 32, .17, 20, false)
  const neckMaterial = new THREE.MeshStandardMaterial({ color: 0xe0b59d, roughness: .82 })
  const shoeProfile = [new THREE.Vector2(0, 0)]
  for (let i = 0; i <= 20; i++) {
    const angle = i / 20 * Math.PI / 2
    shoeProfile.push(new THREE.Vector2(Math.cos(angle), Math.sin(angle)))
  }
  const shoeGeometry = new THREE.LatheGeometry(shoeProfile, 32)
  shoeGeometry.scale(.24, .28, .46)
  // Place the ankle nearer the heel: .64 forward and .28 behind it.
  shoeGeometry.translate(0, 0, .18)
  const materials = {
    skin: new THREE.MeshStandardMaterial({ color: 0xe5bca5, roughness: .72 }),
    shirt: new THREE.MeshStandardMaterial({ color: 0x3e4245, roughness: .92 }),
    pants: new THREE.MeshStandardMaterial({ color: 0x9db5ce, roughness: .95 }),
    shoes: new THREE.MeshStandardMaterial({ color: 0xa6a6aa, roughness: .8 }),
  }
  const handMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .8 })
  const handGeometries: THREE.BufferGeometry[] = []
  const part = (parent: THREE.Object3D, name: string, position: number[], scale: number[], material: THREE.Material) => {
    const mesh = new THREE.Mesh(sphere, material); mesh.name = name
    mesh.position.set(...position as [number, number, number]); mesh.scale.set(...scale as [number, number, number])
    mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh
  }
  const joint = (parent: THREE.Object3D, name: string, x: number, y: number, z = 0) => {
    const group = new THREE.Group(); group.name = name; group.position.set(x, y, z); parent.add(group); return group
  }
  part(body, 'hips', [0, 3.3, 0], [.63, .42, .34], materials.pants)
  const shirt = new THREE.Mesh(shirtGeometry, materials.shirt)
  shirt.name = 'shirt-torso'
  shirt.scale.z = .55; shirt.castShadow = true; shirt.receiveShadow = true; body.add(shirt)
  const neck = new THREE.Mesh(neckGeometry, neckMaterial)
  neck.name = 'curved-neck'; neck.userData.bareSkin = true
  neck.castShadow = true; neck.receiveShadow = true; body.add(neck)
  const head = joint(body, 'head', 0, 6.02)
  const face = new THREE.Mesh(faceGeometry, materials.skin)
  face.name = 'face'; face.position.y = .1; face.scale.set(.47, .59, .41); face.castShadow = true; head.add(face)
  const legs = [-1, 1].map(side => {
    const hip = joint(body, side < 0 ? 'left-hip' : 'right-hip', side * .32, 3.3)
    const thigh = new THREE.Mesh(trouserGeometry, materials.pants)
    thigh.position.y = -.75; thigh.castShadow = true; hip.add(thigh)
    const knee = joint(hip, 'knee', 0, -1.5)
    // Fill the joint with the same denim surface so bending never exposes a gap.
    part(knee, 'knee-fabric', [0, 0, 0], [.26, .27, .26], materials.pants)
    const shin = new THREE.Mesh(shinGeometry, materials.pants)
    shin.position.y = -.73; shin.castShadow = true; knee.add(shin)
    const shoe = new THREE.Mesh(shoeGeometry, materials.shoes)
    shoe.name = 'shoe'; shoe.position.set(0, -1.785, 0); shoe.castShadow = true; knee.add(shoe)
    return { hip, knee, shoe }
  })
  const arms = [-1, 1].map(side => {
    const shoulder = joint(body, side < 0 ? 'left-shoulder' : 'right-shoulder', side * .54, 5.12)
    const upperSleeve = new THREE.Mesh(upperSleeveGeometry, materials.shirt)
    upperSleeve.name = 'upper-sleeve'; upperSleeve.castShadow = true; shoulder.add(upperSleeve)
    const elbow = joint(shoulder, 'elbow', 0, -1.05)
    const lowerSleeve = new THREE.Mesh(lowerSleeveGeometry, materials.shirt)
    lowerSleeve.name = 'lower-sleeve'; lowerSleeve.position.y = -.46; lowerSleeve.castShadow = true; elbow.add(lowerSleeve)
    const hand = joint(elbow, 'hand', 0, -.94)
    // One closed smooth surface, with a subtle mirrored thumb in its silhouette.
    const handGeometry = new THREE.SphereGeometry(1, 40, 32)
    handGeometries.push(handGeometry)
    const positions = handGeometry.getAttribute('position'), colors: number[] = []
    const palmColor = new THREE.Color(0xedc4ac), backColor = new THREE.Color(0xe0b098)
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i)
      const height = -.235 + y * .285
      const wrist = 1 - .24 * THREE.MathUtils.smoothstep(y, .15, .85)
      const thumb = .055 * Math.exp(-(((height + .17) / .08) ** 2))
        * THREE.MathUtils.smoothstep(-side * x, 0, .65)
      // The palm faces local +Z; the back is slightly fuller and darker.
      positions.setXYZ(i, x * .13 * wrist - side * thumb, height, z * (z > 0 ? .052 : .066))
      const color = backColor.clone().lerp(palmColor, THREE.MathUtils.smoothstep(z, -.25, .35))
      colors.push(color.r, color.g, color.b)
    }
    handGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
    handGeometry.computeVertexNormals()
    const handMesh = new THREE.Mesh(handGeometry, handMaterial)
    handMesh.name = 'smooth-hand'; hand.add(handMesh)
    hand.traverse(object => {
      if (object instanceof THREE.Mesh) { object.userData.handSurface = true; object.castShadow = true; object.receiveShadow = true }
    })
    return { shoulder, elbow, hand, side }
  })
  // Project in a T-pose, then retain these UVs as each limb bends.
  arms.forEach(({ shoulder, side }) => { shoulder.rotation.z = side * Math.PI / 2 })
  // Replace the separate torso and sleeves with one blended surface in the bind pose.
  shirt.removeFromParent()
  for (const { shoulder, elbow } of arms) {
    shoulder.getObjectByName('upper-sleeve')?.removeFromParent()
    elbow.getObjectByName('lower-sleeve')?.removeFromParent()
  }
  const profile = [[3.4,.54],[3.8,.55],[4.3,.61],[4.9,.71],[5.16,.66],[5.4,.4],[5.46,.22]]
  const upperBodyGeometry = createSmoothSurface(new THREE.Vector3(-2.85, 3.25, -.65), new THREE.Vector3(2.85, 5.65, .65), (x, y, z) => {
    let radius = y < 3.4 ? .54 : .22
    for (let i = 1; i < profile.length; i++) if (y >= profile[i-1][0] && y <= profile[i][0]) {
      radius = THREE.MathUtils.lerp(profile[i-1][1], profile[i][1], (y-profile[i-1][0])/(profile[i][0]-profile[i-1][0])); break
    }
    let distance = Math.max(Math.hypot(x, z / .55) - radius, 3.4 - y, y - 5.46)
    const ax = Math.abs(x), nearest = THREE.MathUtils.clamp(ax, .54, 2.48)
    const sleeveRadius = THREE.MathUtils.lerp(.235, .13, THREE.MathUtils.smoothstep(nearest, .7, 2.48))
    distance = smoothUnion(distance, Math.hypot(ax - nearest, y - 5.12, z) - sleeveRadius, .13)
    return distance
  }, 64)
  const upperBody = new THREE.Mesh(upperBodyGeometry, materials.shirt)
  upperBody.name = 'unified-shirt'; upperBody.castShadow = true; upperBody.receiveShadow = true; body.add(upperBody)
  root.updateMatrixWorld(true)
  const projected: THREE.BufferGeometry[] = []
  const point = new THREE.Vector3(), normal = new THREE.Vector3(), normalMatrix = new THREE.Matrix3()
  const heightStops = [[0, 0], [1.8, .27], [3.52, .49], [5.12, .8], [5.55, .86], [6.74, 1]]
  const photoHeight = (y: number) => {
    for (let i = 1; i < heightStops.length; i++) if (y <= heightStops[i][0]) {
      const [a, b] = [heightStops[i - 1], heightStops[i]]
      return THREE.MathUtils.lerp(a[1], b[1], (y - a[0]) / (b[0] - a[0]))
    }
    return 1
  }
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return
    if (object.userData.handSurface || object.userData.bareSkin) return
    object.geometry = object.geometry.clone(); projected.push(object.geometry)
    const positions = object.geometry.getAttribute('position'), normals = object.geometry.getAttribute('normal')
    const uv: number[] = [], facing: number[] = []
    normalMatrix.getNormalMatrix(object.matrixWorld)
    for (let i = 0; i < positions.count; i++) {
      point.fromBufferAttribute(positions, i).applyMatrix4(object.matrixWorld)
      normal.fromBufferAttribute(normals, i).applyMatrix3(normalMatrix).normalize()
      const armDrop = Math.abs(point.x) > .7 && point.y > 4.8 ? .05 * Math.abs(point.x) / 3.12 : 0
      let photoX = ((object.name === 'face' ? point.x * .43 / .47 : point.x) + 3.12) / 6.24
      if (object.name === 'shirt-torso') photoX = (point.x * THREE.MathUtils.lerp(1, 1.08, THREE.MathUtils.smoothstep(point.y, 3.8, 4.9)) + 3.12) / 6.24
      if (object.name.endsWith('sleeve')) photoX = THREE.MathUtils.clamp(photoX, .15, .85)
      if (object.name === 'unified-shirt') photoX = Math.abs(point.x) > .7 ? THREE.MathUtils.clamp(photoX, .15, .85) : (point.x * 1.08 + 3.12) / 6.24
      uv.push(photoX, photoHeight(point.y) - armDrop)
      facing.push(THREE.MathUtils.smoothstep(normal.z, -.25, .25))
    }
    object.geometry.setAttribute('photoUv', new THREE.Float32BufferAttribute(uv, 2))
    object.geometry.setAttribute('photoFacing', new THREE.Float32BufferAttribute(facing, 1))
  })
  const deformUpperBody = bindSmoothSurface(upperBody, arms.flatMap(arm => [arm.shoulder, arm.elbow]), point => {
    const ax = Math.abs(point.x), armWeight = THREE.MathUtils.smoothstep(ax, .42, .9)
    const elbowWeight = THREE.MathUtils.smoothstep(ax, 1.48, 1.76)
    return arms.flatMap(({ side }) => point.x * side > 0 ? [armWeight * (1 - elbowWeight), armWeight * elbowWeight] : [0, 0])
  })
  arms.forEach(({ shoulder }) => { shoulder.rotation.z = 0 })
  for (const material of Object.values(materials)) {
    material.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, { humanAtlas: { value: atlas }, humanFrontRect: { value: frontRect }, humanBackRect: { value: backRect } })
      shader.vertexShader = 'attribute vec2 photoUv; attribute float photoFacing; varying vec2 vHumanUv; varying float vHumanFacing;\n' + shader.vertexShader
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvHumanUv=photoUv; vHumanFacing=photoFacing;')
      shader.fragmentShader = 'uniform sampler2D humanAtlas; uniform vec4 humanFrontRect; uniform vec4 humanBackRect; varying vec2 vHumanUv; varying float vHumanFacing;\n' + shader.fragmentShader
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
        vec4 photoFront=texture2D(humanAtlas,humanFrontRect.xy+clamp(vHumanUv,0.001,0.999)*humanFrontRect.zw);
        vec4 photoBack=texture2D(humanAtlas,humanBackRect.xy+vec2(1.0-clamp(vHumanUv.x,0.001,0.999),clamp(vHumanUv.y,0.001,0.999))*humanBackRect.zw);
        vec4 photo=mix(photoBack,photoFront,vHumanFacing);
        diffuseColor.rgb=mix(diffuseColor.rgb,photo.rgb,photo.a);
      `)
    }
    material.customProgramCacheKey = () => 'human-photo-projection-v1'
  }
  // Accessories keep their black fabric material instead of sampling the shirt photo.
  const bagMaterial = new THREE.MeshStandardMaterial({ color: 0x101113, roughness: .94 })
  const zipperMaterial = new THREE.MeshStandardMaterial({ color: 0x343638, roughness: .55, metalness: .35 })
  const bagGeometry = new RoundedBoxGeometry(.75, .9, .27, 4, .06)
  const pocketGeometry = new RoundedBoxGeometry(.6, .44, .04, 3, .025)
  const zipperGeometry = new THREE.BoxGeometry(.5, .016, .018)
  const bag = joint(body, 'crossbody-bag', .7, 3.5, -.16)
  bag.rotation.y = Math.PI / 2
  bag.rotation.z = -.08
  const bagMesh = new THREE.Mesh(bagGeometry, bagMaterial)
  bagMesh.castShadow = true; bagMesh.receiveShadow = true; bag.add(bagMesh)
  const pocket = new THREE.Mesh(pocketGeometry, bagMaterial)
  pocket.position.set(0, -.12, .153); pocket.castShadow = true; bag.add(pocket)
  const zipper = new THREE.Mesh(zipperGeometry, zipperMaterial)
  zipper.position.set(0, .09, .183); bag.add(zipper)
  const strapPath = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-.48, 5.26, .28), new THREE.Vector3(-.34, 4.98, .4),
    new THREE.Vector3(.02, 4.5, .43), new THREE.Vector3(.45, 3.99, .35),
    new THREE.Vector3(.7, 3.82, .19), new THREE.Vector3(.7, 3.82, -.5),
    new THREE.Vector3(.48, 4.05, -.34), new THREE.Vector3(.02, 4.6, -.41),
    new THREE.Vector3(-.36, 5.12, -.3), new THREE.Vector3(-.48, 5.31, -.05),
  ], true, 'centripetal')
  const strapProfile = new THREE.Shape()
  strapProfile.moveTo(-.057, -.012); strapProfile.lineTo(.057, -.012)
  strapProfile.lineTo(.057, .012); strapProfile.lineTo(-.057, .012); strapProfile.closePath()
  const strapGeometry = new THREE.ExtrudeGeometry(strapProfile, { steps: 100, bevelEnabled: false, extrudePath: strapPath })
  const strap = new THREE.Mesh(strapGeometry, bagMaterial)
  strap.name = 'crossbody-strap'; strap.castShadow = true; strap.receiveShadow = true; body.add(strap)
  // Shrink after photo projection to preserve the face texture's alignment.
  head.scale.setScalar(.94)
  // Forward neck posture is applied after projection so the face stays aligned.
  head.position.z = .5
  head.rotation.x = .1
  root.scale.set(1.27, 1.41, 1.27)
  let lastTime = 0, walkingBlend = 0, lastStride = 0
  return {
    root,
    animate(time: number, gesture = 0, walking = true, travelled?: number) {
      const dt = Math.min(.1, Math.max(0, time - lastTime)); lastTime = time
      walkingBlend = walking ? 1 : THREE.MathUtils.lerp(walkingBlend, 0, 1 - Math.exp(-dt * 12))
      const footReach = .85
      // A planted foot travels backwards relative to the body at exactly its forward speed.
      if (walking) lastStride = (travelled ?? time * 6.2) / (4 * footReach * root.scale.x) * Math.PI * 2
      const walk = walkingBlend * (1 - gesture), stride = lastStride
      const upper = 1.5, lower = 1.785
      const stanceProgress = THREE.MathUtils.euclideanModulo(stride / Math.PI, 1)
      const stanceZ = footReach * (1 - stanceProgress * 2)
      // Contact -> down -> passing -> up -> contact, matching the reference walk cycle.
      const heights = [[0, -.12], [.18, -.14], [.5, -.025], [.8, -.015], [1, -.12]]
      let pelvisHeight = -.12
      for (let i = 1; i < heights.length; i++) if (stanceProgress <= heights[i][0]) {
        const a = heights[i - 1], b = heights[i]
        const blend = THREE.MathUtils.smoothstep(stanceProgress, a[0], b[0])
        pelvisHeight = THREE.MathUtils.lerp(a[1], b[1], blend); break
      }
      const reachableHeight = Math.sqrt((upper + lower) ** 2 - stanceZ * stanceZ) + .015 - 3.3 - .004
      body.position.y = Math.min(pelvisHeight, reachableHeight) * walk
      body.rotation.z = -.055 * gesture
      body.rotation.y = 0
      head.rotation.y = -body.rotation.y * .65
      bag.rotation.z = -.08 + Math.sin(stride) * .015 * walk
      bag.rotation.x = Math.sin(stride - .4) * .015 * walk
      legs.forEach(({ hip, knee, shoe }, i) => {
        const cycle = THREE.MathUtils.euclideanModulo(stride / (Math.PI * 2) + i * .5, 1)
        const supporting = cycle < .5, progress = supporting ? cycle * 2 : (cycle - .5) * 2
        const footZ = supporting ? footReach * (1 - progress * 2)
          : footReach * (-1 + 2 * THREE.MathUtils.smoothstep(progress, 0, 1))
        // Heel first, then flat support, followed by a toe push-off and a low foot swing.
        const roll = supporting
          ? -.1 * (1 - THREE.MathUtils.smoothstep(progress, 0, .16)) + .18 * THREE.MathUtils.smoothstep(progress, .78, 1)
          : THREE.MathUtils.lerp(.18, -.1, THREE.MathUtils.smoothstep(progress, .1, .9))
        const lift = supporting ? 0 : .22 * Math.sin(progress * Math.PI) ** 1.2
        const soleReach = roll >= 0 ? .64 : .28
        const ankleHeight = .015 + soleReach * Math.abs(Math.sin(roll)) + lift
        const height = 3.3 + body.position.y - ankleHeight
        const bend = Math.acos(THREE.MathUtils.clamp((height * height + footZ * footZ - upper * upper - lower * lower) / (2 * upper * lower), -1, 1))
        hip.position.y = 3.3
        const hipAngle = Math.atan2(-footZ, height) - Math.atan2(lower * Math.sin(bend), upper + lower * Math.cos(bend))
        hip.rotation.x = hipAngle * walk + (i === 0 ? -1.95 * gesture : 0)
        knee.rotation.x = bend * walk + (i === 0 ? 2.35 * gesture : .04 * gesture)
        shoe.rotation.x = (roll - hipAngle - bend) * walk
      })
      arms.forEach(({ shoulder, elbow, hand, side }) => {
        const phase = stride + (side > 0 ? Math.PI : 0)
        shoulder.rotation.x = Math.cos(phase) * .22 * walk
        shoulder.position.z = side > 0 ? .17 : 0
        shoulder.rotation.z = side * (gesture * 1.92 + (side > 0 ? .23 : .08) * (1 - gesture))
        elbow.rotation.x = (-.14 - Math.max(0, Math.cos(phase)) * .08 * walk) * (1 - gesture)
        // Palms face inward while walking and forward when the arms are raised.
        hand.rotation.y = -side * Math.PI / 2 * (1 - gesture)
      })
      deformUpperBody()
    },
    dispose() { root.removeFromParent(); projected.forEach(geometry => geometry.dispose()); for (const geometry of [sphere, faceGeometry, shirtGeometry, upperBodyGeometry, trouserGeometry, shinGeometry, upperSleeveGeometry, lowerSleeveGeometry, neckGeometry, shoeGeometry, ...handGeometries, bagGeometry, pocketGeometry, zipperGeometry, strapGeometry]) geometry.dispose(); Object.values(materials).forEach(material => material.dispose()); neckMaterial.dispose(); handMaterial.dispose(); bagMaterial.dispose(); zipperMaterial.dispose() },
  }
}
