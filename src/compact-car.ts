import * as THREE from 'three'

const atlas = new THREE.Texture()
atlas.colorSpace = THREE.SRGBColorSpace
let rearLettering: HTMLImageElement | undefined
let ready: Promise<void> | undefined
export function loadCarPhotos() {
  const loader = new THREE.ImageLoader()
  return ready ??= Promise.all([
    loader.loadAsync(`${import.meta.env.BASE_URL}models/compact-car-atlas.png`),
    loader.loadAsync(`${import.meta.env.BASE_URL}models/car-rear-lettering.png`),
  ]).then(([image, lettering]) => {
    atlas.image = image; atlas.needsUpdate = true; rearLettering = lettering
  }).catch(error => { ready = undefined; throw error })
}

export function createCompactCar() {
  const root = new THREE.Group(); root.name = 'compact-car-visitor'; root.scale.setScalar(1.45 * 2.5)
  const geometries: THREE.BufferGeometry[] = [], materials: THREE.Material[] = [], textures: THREE.Texture[] = []
  const paint = new THREE.MeshPhysicalMaterial({ color: 0xe51024, metalness: .35, roughness: .3, clearcoat: .7 })
  materials.push(paint)
  paint.onBeforeCompile = shader => {
    shader.uniforms.carPhoto = { value: atlas }
    shader.vertexShader = 'varying vec3 carPoint; varying vec3 carNormal;\n' + shader.vertexShader
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\ncarPoint=position;carNormal=normal;')
    shader.fragmentShader = 'uniform sampler2D carPhoto; varying vec3 carPoint; varying vec3 carNormal;\n' + shader.fragmentShader
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      vec3 n=normalize(carNormal);
      vec2 faceUV=clamp(vec2(.5+carPoint.x/2.5,.075+carPoint.y/2.65*.84),.02,.98);
      vec2 sideUV=clamp(vec2(.5+carPoint.z/4.6,.28+carPoint.y/2.65*.58),.02,.98);
      vec3 front=texture2D(carPhoto,vec2(0.,.5)+faceUV*.5).rgb;
      vec3 rear=texture2D(carPhoto,vec2(.5,.5)+vec2(1.-faceUV.x,faceUV.y)*.5).rgb;
      vec3 side=texture2D(carPhoto,sideUV*.5).rgb;
      vec3 red=texture2D(carPhoto,vec2(.5,0.)+clamp(carPoint.xz/5.+.5,.02,.98)*.5).rgb;
      float arch=min(length(vec2(carPoint.z-1.6,carPoint.y-.46)),length(vec2(carPoint.z+1.45,carPoint.y-.46)));
      side=mix(side,vec3(.012),1.-smoothstep(.44,.51,arch));
      vec3 weights=pow(abs(n),vec3(6.));weights/=max(dot(weights,vec3(1.)),.001);
      diffuseColor.rgb=side*weights.x+red*weights.y+mix(rear,front,step(0.,n.z))*weights.z;
      // Tint directly on the curved shell so no floating glass panel cuts into the paint.
      float glassBand=step(1.6,carPoint.y)*(1.-step(2.38,carPoint.y));
      float frontGlass=glassBand*step(.25,carPoint.z)*(1.-step(.76,abs(carPoint.x)));
      float rearGlass=glassBand*(1.-step(-1.68,carPoint.z))*(1.-step(.74,abs(carPoint.x)));
      diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.004,.006,.009),max(frontGlass,rearGlass));
    `)
    // The photographed windows remain opaque and have a smoother glass finish.
    shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor=mix(.16,.36,smoothstep(.04,.18,dot(diffuseColor.rgb,vec3(.2126,.7152,.0722))));')
  }
  paint.customProgramCacheKey = () => 'compact-car-atlas-v1'
  const add = (name: string, geometry: THREE.BufferGeometry, material: THREE.Material) => {
    geometries.push(geometry)
    const mesh = new THREE.Mesh(geometry, material); mesh.name = name; mesh.castShadow = true; mesh.receiveShadow = true; root.add(mesh); return mesh
  }
  // One rounded shell from bumpers through the cabin, rather than stacked boxes.
  const levels = [
    [.38, .93, 2.06, -1.98], [.55, 1.04, 2.2, -2.1], [1.05, 1.08, 2.2, -2.12],
    [1.4, 1.04, 1.94, -2.08], [1.55, .99, 1.33, -2.02], [2.15, .9, .75, -1.82],
    [2.48, .79, .28, -1.63], [2.56, .65, .05, -1.4], [2.59, .08, -.55, -.8],
  ]
  const vertices: number[] = [], indices: number[] = [], segments = 64
  for (const [y, width, front, rear] of levels) for (let i = 0; i < segments; i++) {
    const a = i / segments * Math.PI * 2, c = Math.cos(a), s = Math.sin(a)
    vertices.push(width * Math.sign(c) * Math.abs(c) ** .42, y, (front + rear) / 2 + (front - rear) / 2 * Math.sign(s) * Math.abs(s) ** .42)
  }
  for (let row = 0; row < levels.length - 1; row++) for (let i = 0; i < segments; i++) {
    const a = row * segments + i, b = row * segments + (i + 1) % segments, c = a + segments, d = b + segments
    indices.push(a, c, b, b, c, d)
  }
  for (let i = 1; i < segments - 1; i++) {
    indices.push(0, i, i + 1)
    const top = (levels.length - 1) * segments; indices.push(top, top + i + 1, top + i)
  }
  const shell = new THREE.BufferGeometry(); shell.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3)); shell.setIndex(indices); shell.computeVertexNormals()
  add('photo-wrapped-shell', shell, paint)
  const rubber = new THREE.MeshStandardMaterial({ color: 0x131313, roughness: .9 })
  const silver = new THREE.MeshStandardMaterial({ color: 0xaeb2b5, metalness: .8, roughness: .32 })
  materials.push(rubber, silver)
  const wheels: THREE.Group[] = []
  for (const side of [-1, 1]) for (const z of [-1.45, 1.6]) {
    const axle = new THREE.Group(); axle.position.set(side * 1.04, .46, z); root.add(axle); wheels.push(axle)
    const tire = add('tire', new THREE.CylinderGeometry(.46, .46, .24, 28), rubber); axle.add(tire); tire.rotation.z = Math.PI / 2
    const hub = add('wheel-hub', new THREE.CylinderGeometry(.3, .3, .255, 24), silver); axle.add(hub); hub.rotation.z = Math.PI / 2
    for (let i = 0; i < 6; i++) {
      const hole = add('hub-inset', new THREE.SphereGeometry(.058, 8, 6), rubber); axle.add(hole)
      hole.position.set(side * .135, Math.cos(i / 6 * Math.PI * 2) * .19, Math.sin(i / 6 * Math.PI * 2) * .19); hole.scale.x = .12
    }
  }
  const decal = (name: string, text: string, font: string, background: string | null, width: number, height: number) => {
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 192
    const ctx = canvas.getContext('2d')!
    if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, 512, 192) }
    if (text === '보초' && rearLettering) ctx.drawImage(rearLettering, 0, 0, 512, 192)
    else { ctx.fillStyle = background ? '#101010' : '#ffffff'; ctx.font = font; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, 256, 104) }
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; textures.push(texture)
    const mat = new THREE.MeshBasicMaterial({ map: texture, transparent: !background, depthWrite: !!background, polygonOffset: true, polygonOffsetFactor: -2 }); materials.push(mat)
    mat.userData.alwaysTransparent = !background
    return add(name, new THREE.PlaneGeometry(width, height), mat)
  }
  const plate = decal('rear-plate-99구9999', '99구9999', 'bold 108px Gulim, sans-serif', '#f0eee4', .93, .31)
  plate.position.set(0, 1.35, -2.135); plate.rotation.y = Math.PI
  const frontPlate = add('front-plate-99구9999', plate.geometry.clone(), plate.material)
  frontPlate.position.set(0, .85, 2.215)
  const label = decal('rear-window-보초', '보초', '172px Gungsuh, "궁서", "궁서체", serif', null, .8, .32)
  // Rear-view left is positive local X. The decal follows the sloping rear glass.
  label.position.set(.34, 1.84, -1.945); label.rotation.set(.368, Math.PI, 0)
  for (const side of [-1, 1]) {
    const mirror = add('wing-mirror', new THREE.SphereGeometry(1, 16, 10), paint)
    mirror.scale.set(.17, .13, .2); mirror.position.set(side * 1.07, 1.62, .91)
  }
  const antennaBase = add('front-roof-antenna-base', new THREE.SphereGeometry(1, 12, 8), rubber)
  antennaBase.position.set(0, 2.535, .16); antennaBase.scale.set(.07, .035, .105)
  // The mast starts above the windshield and lies back at a shallow angle.
  const antennaStart = new THREE.Vector3(0, 2.56, .16), antennaEnd = new THREE.Vector3(0, 2.88, -1.04)
  const antennaDirection = antennaEnd.clone().sub(antennaStart)
  const antenna = add('rear-leaning-roof-antenna', new THREE.CylinderGeometry(.009, .018, antennaDirection.length(), 8), rubber)
  antenna.position.copy(antennaStart).add(antennaEnd).multiplyScalar(.5)
  antenna.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), antennaDirection.normalize())
  return {
    root,
    animate(travelled: number) { wheels.forEach(wheel => { wheel.rotation.x = travelled / (.46 * root.scale.x) }); root.position.y = Math.sin(travelled * 2) * .015 },
    fade(opacity: number) {
      materials.forEach(material => {
        const transparent = opacity < 1 || material.userData.alwaysTransparent === true
        if (material.transparent !== transparent) { material.transparent = transparent; material.needsUpdate = true }
        material.opacity = opacity; material.depthWrite = opacity >= 1 && !material.userData.alwaysTransparent
      })
    },
    dispose() { root.removeFromParent(); geometries.forEach(geometry => geometry.dispose()); materials.forEach(material => material.dispose()); textures.forEach(texture => texture.dispose()) },
  }
}
