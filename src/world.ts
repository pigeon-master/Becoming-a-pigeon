import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { findSpawn, PIGEON_RADIUS, resolveContacts, steerAround } from './flock-physics'
import type { FlockBody } from './flock-physics'
import { createPoodleVisit } from './poodle'
import { createPigeonBehaviors } from './pigeon-behavior'

const rand = (a: number, i: number) => a + Math.random() * (i - a)
const material = (color: number, roughness = .85) => new THREE.MeshStandardMaterial({ color, roughness })
const sphere = new THREE.SphereGeometry(1, 20, 14)
const bodyMat = material(0x899095), wingMat = material(0x697278), darkMat = material(0x30383d)
const neckMat = new THREE.MeshStandardMaterial({ color: 0x415d59, metalness: .35, roughness: .4 })
const footMat = material(0xb16e72)
function ellipsoid(parent: THREE.Object3D, mat: THREE.Material, scale: number[], position: number[]) {
  const mesh = new THREE.Mesh(sphere, mat)
  mesh.scale.set(scale[0], scale[1], scale[2]); mesh.position.set(position[0], position[1], position[2])
  mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh
}
function asphalt() {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1024
  const ctx = canvas.getContext('2d')!
  const data = ctx.createImageData(1024, 1024)
  for (let i = 0; i < data.data.length; i += 4) {
    const n = rand(61, 94); data.data[i] = n; data.data[i + 1] = n + 1; data.data[i + 2] = n; data.data[i + 3] = 255
  }
  ctx.putImageData(data, 0, 0)
  for (let i = 0; i < 9000; i++) {
    ctx.fillStyle = Math.random() > .5 ? '#a7a79b55' : '#22272366'
    ctx.fillRect(rand(0, 1024), rand(0, 1024), rand(1, 3), rand(1, 3))
  }
  ctx.strokeStyle = '#30343188'; ctx.lineWidth = 1.5
  for (let j = 0; j < 9; j++) {
    let x = rand(0, 1024), y = rand(0, 1024); ctx.beginPath(); ctx.moveTo(x, y)
    for (let k = 0; k < 12; k++) { x += rand(-25, 25); y += rand(5, 30); ctx.lineTo(x, y) }
    ctx.stroke()
  }
  const tex = new THREE.CanvasTexture(canvas); tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(8, 8); tex.colorSpace = THREE.SRGBColorSpace; return tex
}

export class Pigeon {
  id = ''
  bubble = document.createElement('div')
  root = new THREE.Group(); torso = new THREE.Group(); head = new THREE.Group()
  wings: THREE.Group[] = []; legs: THREE.Group[] = []
  neck: THREE.Mesh
  face: THREE.Mesh
  target = new THREE.Vector3(); phase = rand(0, 6); speed = rand(.525, 1)
  timer = rand(3, 10); flight = 0; flightDuration = 0; start = new THREE.Vector3()
  settle = 3
  velocity = new THREE.Vector3()
  collisionCooldown = 0
  get physics(): FlockBody { return { position: this.root.position, velocity: this.velocity, radius: PIGEON_RADIUS } }
  constructor(face: THREE.Mesh) {
    this.bubble.className = 'speech-bubble'; this.bubble.hidden = true
    this.face = face
    this.root.add(this.torso)
    ellipsoid(this.torso, bodyMat, [.46, .49, .72], [0, .76, -.1])
    this.neck = ellipsoid(this.torso, neckMat, [.28, .46, .3], [0, 1.13, .31])
    const tail = ellipsoid(this.torso, darkMat, [.28, .085, .52], [0, .66, -.85]); tail.rotation.x = -.18
    this.head.position.set(0, 1.57, .38); this.torso.add(this.head)
    this.head.add(face)
    this.updateNeck()
    for (const s of [-1, 1]) {
      const wing = new THREE.Group(); wing.position.set(s * .34, .98, -.16); this.torso.add(wing)
      ellipsoid(wing, wingMat, [.14, .32, .62], [s * .04, -.12, -.12])
      for (let i = 0; i < 2; i++) ellipsoid(wing, darkMat, [.15, .042, .38], [s * .053, -.15 + i * .14, -.25 - i * .09])
      for (let i = 0; i < 6; i++) ellipsoid(wing, wingMat, [.045, .065, .3], [s * (.04 + i * .016), -.25 + i * .06, -.54])
      this.wings.push(wing)
      const leg = new THREE.Group(); leg.position.set(s * .18, .38, 0); this.root.add(leg)
      ellipsoid(leg, footMat, [.032, .18, .032], [0, -.14, 0])
      for (let i = -1; i <= 1; i++) {
        const toe = ellipsoid(leg, footMat, [.02, .022, .15], [i * .047, -.3, .085]); toe.rotation.y = i * .35
      }
      this.legs.push(leg)
    }
    this.root.position.set(rand(-7, 7), 0, rand(-4, 5)); this.chooseTarget()
    this.root.rotation.y = Math.atan2(this.target.x - this.root.position.x, this.target.z - this.root.position.z)
  }
  chooseTarget() { this.target.set(rand(-8, 8), 0, rand(-5, 6)) }
  dispose() {
    this.bubble.remove()
    this.root.removeFromParent()
    this.face.geometry.dispose()
    const materials = Array.isArray(this.face.material) ? this.face.material : [this.face.material]
    for (const mat of materials) {
      if ('map' in mat && mat.map instanceof THREE.Texture) mat.map.dispose()
      mat.dispose()
    }
    // Body geometry and feather materials are shared by the remaining flock.
  }
  updateNeck() {
    const base = new THREE.Vector3(0, 1.01, .24)
    const top = this.head.position.clone().add(new THREE.Vector3(0, -.17, -.09))
    const direction = top.clone().sub(base)
    this.neck.position.copy(base).add(top).multiplyScalar(.5)
    this.neck.scale.set(.27, direction.length() * .5 + .2, .28)
    this.neck.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize())
  }
  fly() {
    if (this.flightDuration) return
    this.chooseTarget(); this.start.copy(this.root.position); this.flight = 0
    this.flightDuration = Math.max(1.8, this.start.distanceTo(this.target) / 3.2)
  }
  collide(normal: THREE.Vector3) {
    if (this.collisionCooldown > 0 || normal.lengthSq() < .00001) return
    normal.normalize()
    const away = normal.clone().add(new THREE.Vector3(normal.z, 0, -normal.x).multiplyScalar(.6)).normalize()
    this.target.copy(this.root.position).addScaledVector(away, rand(3, 5)); this.target.y = 0
    this.timer = rand(3, 6); this.collisionCooldown = .6
  }
  update(dt: number, time: number, body: FlockBody, neighbors: FlockBody[]) {
    this.collisionCooldown = Math.max(0, this.collisionCooldown - dt)
    if (this.settle > 0) { this.settle -= dt; return }
    this.timer -= dt
    if (this.timer <= 0 && !this.flightDuration) {
      if (Math.random() < .24) this.fly(); else this.chooseTarget()
      this.timer = rand(6, 16)
    }
    const delta = this.target.clone().sub(this.root.position); delta.y = 0
    const desired = delta.clone().normalize().multiplyScalar(this.flightDuration ? 3.2 : this.speed)
    if (delta.length() < .2) desired.set(0, 0, 0)
    const steering = steerAround(body, neighbors, desired)
    this.velocity.lerp(steering, 1 - Math.exp(-dt * 8))
    this.root.position.addScaledVector(this.velocity, dt)
    const angle = this.velocity.lengthSq() > .0001 ? Math.atan2(this.velocity.x, this.velocity.z) : this.root.rotation.y
    const diff = Math.atan2(Math.sin(angle - this.root.rotation.y), Math.cos(angle - this.root.rotation.y))
    this.root.rotation.y += diff * Math.min(1, dt * 5)
    if (this.flightDuration) {
      this.flight += dt
      const t = Math.min(this.flight / this.flightDuration, 1)
      this.root.position.y = Math.sin(t * Math.PI) * 1.9
      this.torso.rotation.x = .17
      this.wings.forEach((w, i) => { w.rotation.z = (i ? -1 : 1) * (1.15 + Math.sin(time * 22) * .65); w.scale.y = 2.2 })
      this.legs.forEach(l => { l.rotation.x = -.9 })
      this.head.position.z = .6
      if (t === 1) { this.flightDuration = 0; this.root.position.y = 0 }
    } else {
      const moving = this.velocity.lengthSq() > .005
      this.phase += dt * (moving ? 9 * this.speed / .61 : 1)
      const step = Math.sin(this.phase)
      // Quick forward thrust, then a slower hold as the body catches up.
      const cycle = (this.phase / (Math.PI * 2)) % 1
      const bob = cycle < .22 ? cycle / .22 : 1 - (cycle - .22) / .78
      this.head.position.z = .34 + (moving ? bob * .25 : Math.sin(time * 1.4) * .025)
      this.head.position.y = 1.57 + (moving ? Math.abs(step) * .025 : 0)
      this.torso.position.y = moving ? Math.abs(step) * .035 : 0
      this.torso.rotation.x = 0
      this.wings.forEach(w => { w.rotation.z = THREE.MathUtils.damp(w.rotation.z, 0, 10, dt); w.scale.y = THREE.MathUtils.damp(w.scale.y, 1, 10, dt) })
      this.legs.forEach((l, i) => { l.rotation.x = moving ? step * (i ? 1 : -1) * .55 : 0 })
    }
    this.updateNeck()
  }
}

export function createWorld(container: HTMLElement) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.setClearColor(0xffffff)
  renderer.domElement.setAttribute('aria-label', '도심 아스팔트를 자유롭게 걷고 나는 3D 비둘기 광장')
  container.append(renderer.domElement)
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0xffffff)
  const camera = new THREE.PerspectiveCamera(48, 1, .1, 4000)
  camera.position.set(0, 4, 14)
  const controls = new OrbitControls(camera, renderer.domElement)
  controls.target.set(0, 1, 0); controls.enableDamping = true; controls.minDistance = 4; controls.maxDistance = 28
  const bubbleHideDistance = 21, bubbleShowDistance = 19
  let bubblesVisibleAtZoom = true
  let followFlock = false
  controls.addEventListener('start', () => { followFlock = true })
  controls.maxPolarAngle = Math.PI / 2.08; controls.minPolarAngle = .3; controls.enablePan = false
  scene.add(new THREE.HemisphereLight(0xe8f2ff, 0x747460, 2.4))
  const sun = new THREE.DirectionalLight(0xfff0d1, 3.2); sun.position.set(-90, 180, 90); sun.castShadow = true
  sun.shadow.mapSize.set(4096, 4096); Object.assign(sun.shadow.camera, { left: -32, right: 32, top: 32, bottom: -32, near: .5, far: 600 })
  sun.shadow.normalBias = .035; scene.add(sun)
  sun.updateMatrixWorld(); sun.shadow.updateMatrices(sun)
  let shadowExtent = 32
  const shadowPoint = new THREE.Vector3()
  const groundTexture = asphalt(); groundTexture.repeat.set(120, 120)
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400), new THREE.MeshStandardMaterial({ map: groundTexture, roughness: 1 }))
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground)
  const birds: Pigeon[] = []
  const behaviors = createPigeonBehaviors(scene, birds)
  let visit: ReturnType<typeof createPoodleVisit> | undefined
  const releasePoodle = () => {
    if (visit || removing.size) return Promise.resolve()
    behaviors.cancel()
    controls.enabled = false
    return new Promise<void>(resolve => {
      visit = createPoodleVisit(scene, camera, container, birds,
        () => { controls.enabled = true; resolve() },
        () => { visit = undefined; controls.enabled = true; resolve(); container.dispatchEvent(new Event('poodleend')) })
    })
  }
  const removing = new Set<string>()
  const removals = new Map<string, Promise<void>>()
  const effects = new Set<(now: number) => void>()
  const flockCenter = new THREE.Vector3(), centerShift = new THREE.Vector3()
  const centerFlockView = (dt: number) => {
    if (!followFlock || !controls.enabled || removing.size || visit) return
    const visible = birds.filter(bird => bird.root.visible)
    if (!visible.length) { controls.minDistance = 4; return }
    flockCenter.set(0, 0, 0)
    for (const bird of visible) flockCenter.add(bird.root.position)
    flockCenter.multiplyScalar(1 / visible.length); flockCenter.y = 1.1
    // Translate camera and orbit pivot together, preserving the user's viewing angle.
    centerShift.copy(flockCenter).sub(controls.target).multiplyScalar(1 - Math.exp(-dt * 4))
    controls.target.add(centerShift); camera.position.add(centerShift)
    const radii = visible.map(bird => Math.hypot(bird.root.position.x - flockCenter.x, bird.root.position.z - flockCenter.z)).sort((a, i) => a - i)
    // Use the main flock, so a single wandering bird cannot force a large zoom-out.
    const radius = radii[Math.floor((radii.length - 1) * .7)]
    const minimum = THREE.MathUtils.clamp(4 + radius * .7 / Math.min(1, camera.aspect), 4, 13)
    controls.minDistance = THREE.MathUtils.damp(controls.minDistance, minimum, 4, dt)
  }
  const updateCount = () => {
    container.dataset.pigeonCount = String(birds.length)
    container.dataset.pigeonIds = birds.map(i => i.id).join(',')
  }
  const remove = (id: string): Promise<void> => {
    const existing = removals.get(id)
    if (existing) return existing
    const bird = birds.find(i => i.id === id)
    if (!bird) return Promise.resolve()
    behaviors.cancel(bird)
    visit?.release(id)
    removing.add(id); bird.bubble.textContent = ''; bird.velocity.set(0, 0, 0)
    const hole = new THREE.Group()
    hole.position.set(bird.root.position.x, .015, bird.root.position.z)
    hole.rotation.x = -Math.PI / 2
    const disk = new THREE.Mesh(new THREE.CircleGeometry(1.08, 64), new THREE.MeshBasicMaterial({ color: 0x000000 }))
    hole.add(disk)
    const rings: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>[] = []
    for (let i = 0; i < 3; i++) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(.68 + i * .16, .7 + i * .16, 64, 1, i * 2, Math.PI * 1.3), new THREE.MeshBasicMaterial({ color: 0x494949, transparent: true, opacity: .45, depthWrite: false }))
      ring.position.z = .002 + i * .001; hole.add(ring); rings.push(ring)
    }
    scene.add(hole); hole.visible = false; hole.scale.setScalar(.001)
    container.dataset.removingPigeon = id
    const start = performance.now(), initial = bird.root.position.clone(), yaw = bird.root.rotation.y
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
    const duration = reduced ? 700 : 1800
    const zoomDuration = reduced ? 0 : 650, delay = zoomDuration + 1000
    const restoreDuration = reduced ? 0 : 700
    const cameraFrom = camera.position.clone(), targetFrom = controls.target.clone()
    const targetTo = initial.clone().add(new THREE.Vector3(0, 1, 0))
    // Preserve the viewer's azimuth and elevation while moving closer to the bird.
    const viewDirection = cameraFrom.clone().sub(targetFrom).normalize()
    const cameraTo = targetTo.clone().addScaledVector(viewDirection, Math.min(5, cameraFrom.distanceTo(targetFrom)))
    const controlsEnabled = controls.enabled; controls.enabled = false
    controls.minDistance = 4
    container.dataset.removalPhase = 'focusing'
    const promise = new Promise<void>(resolve => {
      const finish = () => {
        clearTimeout(fallback); effects.delete(animate)
        const index = birds.indexOf(bird)
        if (index >= 0) { birds.splice(index, 1); bird.dispose() }
        hole.removeFromParent()
        disk.geometry.dispose(); disk.material.dispose()
        rings.forEach(ring => { ring.geometry.dispose(); ring.material.dispose() })
        removing.delete(id); removals.delete(id); delete container.dataset.removingPigeon
        camera.position.copy(cameraFrom); controls.target.copy(targetFrom); controls.update()
        delete container.dataset.removalPhase; controls.enabled = controlsEnabled
        updateCount(); resolve()
      }
      const animate = (now: number) => {
        const age = now - start
        if (age >= delay + duration) {
          bird.root.visible = false; hole.visible = false
          container.dataset.removalPhase = 'restoring'
          const restored = restoreDuration ? THREE.MathUtils.smoothstep(age - delay - duration, 0, restoreDuration) : 1
          camera.position.lerpVectors(cameraTo, cameraFrom, restored)
          controls.target.lerpVectors(targetTo, targetFrom, restored)
          if (restored >= 1) finish()
          return
        }
        if (age < delay) {
          const zoom = zoomDuration ? THREE.MathUtils.smoothstep(age, 0, zoomDuration) : 1
          camera.position.lerpVectors(cameraFrom, cameraTo, zoom); controls.target.lerpVectors(targetFrom, targetTo, zoom)
          container.dataset.removalPhase = age < zoomDuration ? 'focusing' : 'waiting'
          return
        }
        hole.visible = true; container.dataset.removalPhase = 'sinking'
        const t = Math.min(1, (age - delay) / duration)
        const sink = THREE.MathUtils.smoothstep(t, .18, .88)
        hole.scale.setScalar(Math.max(.001, THREE.MathUtils.smoothstep(t, 0, .18) * (1 - THREE.MathUtils.smoothstep(t, .8, 1))))
        const angle = t * Math.PI * 16
        const radius = reduced ? 0 : Math.sin(t * Math.PI) * .28 * (1 - sink)
        bird.root.position.set(initial.x + Math.sin(angle) * radius, initial.y * (1 - sink) - sink * 1.5, initial.z + Math.cos(angle) * radius)
        bird.root.rotation.y = yaw + (reduced ? 0 : angle)
        bird.root.rotation.z = reduced ? 0 : Math.sin(t * Math.PI) * .25
        bird.root.scale.setScalar(Math.max(.01, 1 - sink))
        rings.forEach((ring, i) => { ring.rotation.z = reduced ? 0 : -angle * (.35 + i * .1) })
      }
      // Background tabs may stop rendering; durable deletion must still finish.
      const fallback = setTimeout(finish, delay + duration + restoreDuration + 250)
      effects.add(animate)
    })
    removals.set(id, promise)
    return promise
  }
  container.dataset.pigeonCount = '0'
  const add = (face: THREE.Mesh, options: { id?: string; replaces?: string | null; focus?: boolean } = {}) => {
    const oldest = birds.find(i => i.id === options.replaces) ?? (birds.length >= 40 ? birds[0] : undefined)
    let spawn = oldest ? oldest.root.position.clone() : null
    if (!spawn && options.focus === false) {
      for (let i = 0; i < 320; i++) {
        const candidate = new THREE.Vector3(rand(-11, 11), 0, rand(-8, 8))
        if (birds.every(i => Math.hypot(candidate.x - i.root.position.x, candidate.z - i.root.position.z) > PIGEON_RADIUS * 2 + .2)) { spawn = candidate; break }
      }
    }
    spawn ??= findSpawn(birds.map(i => i.physics))
    if (!spawn) return false
    const bird = new Pigeon(face)
    bird.id = options.id ?? crypto.randomUUID()
    bird.root.position.copy(spawn); bird.root.rotation.y = 0
    if (options.focus === false) {
      bird.settle = 0
      const heading = bird.target.clone().sub(spawn).setY(0).normalize()
      bird.velocity.copy(heading).multiplyScalar(bird.speed)
      bird.root.rotation.y = Math.atan2(heading.x, heading.z)
    }
    if (oldest) {
      behaviors.cancel(oldest)
      // Keep the exact vacated position, including an airborne bird's landing arc.
      if (oldest.flightDuration) {
        bird.settle = 0; bird.flight = oldest.flight; bird.flightDuration = oldest.flightDuration
        bird.target.copy(oldest.target); bird.velocity.copy(oldest.velocity)
      }
      birds.splice(birds.indexOf(oldest), 1); oldest.dispose()
    }
    bird.bubble.dataset.pigeonId = bird.id; container.append(bird.bubble)
    birds.push(bird); scene.add(bird.root); container.dataset.pigeonCount = String(birds.length)
    if (options.focus !== false) { followFlock = false; controls.minDistance = 4; camera.position.copy(spawn).add(new THREE.Vector3(0, 3.3, 8)); controls.target.copy(spawn).add(new THREE.Vector3(0, 1, 0)); controls.update() }
    return true
  }
  const observer = new ResizeObserver(() => {
    renderer.setSize(container.clientWidth, container.clientHeight)
    camera.aspect = container.clientWidth / container.clientHeight; camera.updateProjectionMatrix()
  }); observer.observe(container)
  let paused = matchMedia('(prefers-reduced-motion: reduce)').matches
  let last = performance.now(), time = 0
  renderer.setAnimationLoop(now => {
    const dt = Math.min((now - last) / 1000, .05); last = now
    if (!document.hidden) visit?.update(dt)
    if (!paused && !document.hidden) {
      behaviors.update(dt, !visit, bird => removing.has(bird.id) || !!visit?.owns(bird.id))
      const summary = behaviors.summary
      container.dataset.pigeonBehaviors = JSON.stringify(summary.actions)
      container.dataset.droppingCount = String(summary.droppings)
      // Small substeps prevent a fast flyer from tunnelling through a neighbor.
      const steps = Math.max(1, Math.ceil(dt / (1 / 60))), step = dt / steps
      for (let i = 0; i < steps; i++) {
        time += step
        const active = birds.filter(i => !removing.has(i.id) && !visit?.owns(i.id))
        const snapshot = active.map(i => ({ position: i.root.position.clone(), velocity: i.velocity.clone(), radius: PIGEON_RADIUS }))
        active.forEach((i, index) => { if (!behaviors.owns(i)) i.update(step, time, snapshot[index], snapshot) })
        // A mounted pair intentionally shares a footprint; its lower bird represents it.
        const collidable = active.filter(i => !behaviors.mounted(i))
        const contacts = resolveContacts(collidable.map(i => i.physics))
        contacts.forEach((normal, index) => { if (!behaviors.owns(collidable[index])) collidable[index].collide(normal) })
      }
    }
    effects.forEach(animate => animate(now))
    // Include offscreen arrivals and their ground shadows before they enter view.
    // Grow in fixed steps without shrinking during a visit to avoid a moving seam.
    let requiredExtent = shadowExtent
    for (const bird of birds) {
      if (!bird.root.visible) continue
      const position = bird.root.position
      for (const height of [0, position.y + 3]) {
        shadowPoint.set(position.x, height, position.z).applyMatrix4(sun.shadow.camera.matrixWorldInverse)
        requiredExtent = Math.max(requiredExtent, Math.abs(shadowPoint.x) + 8, Math.abs(shadowPoint.y) + 8)
      }
    }
    if (requiredExtent > shadowExtent) {
      shadowExtent = Math.ceil(requiredExtent / 8) * 8
      Object.assign(sun.shadow.camera, { left: -shadowExtent, right: shadowExtent, top: shadowExtent, bottom: -shadowExtent })
      sun.shadow.camera.updateProjectionMatrix()
    }
    centerFlockView(dt)
    controls.update(); renderer.render(scene, camera)
    const viewDistance = camera.position.distanceTo(controls.target)
    // Separate thresholds prevent flickering while wheel damping settles.
    if (viewDistance >= bubbleHideDistance) bubblesVisibleAtZoom = false
    else if (viewDistance <= bubbleShowDistance) bubblesVisibleAtZoom = true
    const anchor = new THREE.Vector3()
    for (const bird of birds) {
      if (!bubblesVisibleAtZoom || !bird.root.visible || !bird.bubble.textContent) { bird.bubble.hidden = true; continue }
      // Project the animated head, including head-bobbing and flight, each frame.
      bird.head.getWorldPosition(anchor); anchor.y += .56; anchor.project(camera)
      bird.bubble.hidden = anchor.z < -1 || anchor.z > 1 || Math.abs(anchor.x) > .97 || Math.abs(anchor.y) > .97
      const margin = Math.min(140, container.clientWidth / 2)
      const x = THREE.MathUtils.clamp((anchor.x + 1) * container.clientWidth / 2, margin, container.clientWidth - margin)
      bird.bubble.style.left = `${x}px`
      bird.bubble.style.top = `${(1 - anchor.y) * container.clientHeight / 2}px`
      bird.bubble.style.setProperty('--tail-offset', `${(anchor.x + 1) * container.clientWidth / 2 - x}px`)
    }
  })
  return {
    say(id: string, message: string) {
      const bird = birds.find(i => i.id === id)
      if (bird && !removing.has(id)) {
        const text = document.createElement('span'); text.className = 'wide-text'; text.textContent = message
        bird.bubble.replaceChildren(text)
      }
    },
    has(id: string) { return birds.some(i => i.id === id) },
    retain(ids: Set<string>) {
      for (let i = birds.length - 1; i >= 0; i--) if (!ids.has(birds[i].id) && !removing.has(birds[i].id)) { behaviors.cancel(birds[i]); birds[i].dispose(); birds.splice(i, 1) }
      container.dataset.pigeonCount = String(birds.length)
      container.dataset.pigeonIds = birds.map(i => i.id).join(',')
    },
    add, remove, releasePoodle, get poodleActive() { return !!visit }, get paused() { return paused }, get count() { return birds.length },
    togglePause() { paused = !paused; return paused },
    scatter() { birds.forEach((bird, i) => { bird.timer = .3 + i * .22; bird.fly() }) },
    resetView() { followFlock = false; controls.minDistance = 4; camera.position.set(0, 4, 14); controls.target.set(0, 1, 0) },
  }
}
