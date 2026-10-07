import * as THREE from 'three'
import type { Pigeon } from './world'
import { findSpawn, resolveContacts } from './flock-physics'

const random = (min: number, max: number) => min + Math.random() * (max - min)
const RETURN_DELAY = 4

function createPoodle() {
  const root = new THREE.Group(), body = new THREE.Group()
  root.scale.setScalar(1.8)
  root.add(body)
  const geometry = new THREE.SphereGeometry(1, 12, 8)
  const coat = new THREE.MeshStandardMaterial({ color: 0x111114, roughness: .95 })
  const nose = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: .35 })
  const puff = (parent: THREE.Object3D, position: number[], scale: number[], mat = coat) => {
    const mesh = new THREE.Mesh(geometry, mat)
    mesh.position.set(...position as [number, number, number]); mesh.scale.set(...scale as [number, number, number])
    mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh)
    return mesh
  }
  const curls = (parent: THREE.Object3D, position: number[], scale: number[]) => {
    const center = new THREE.Group(); center.position.set(...position as [number, number, number]); parent.add(center)
    puff(center, [0, 0, 0], scale)
    for (let i = 0; i < 22; i++) {
      const y = 1 - 2 * (i + .5) / 22, angle = i * 2.39996, radius = Math.sqrt(1 - y * y)
      puff(center, [Math.cos(angle) * radius * scale[0], y * scale[1], Math.sin(angle) * radius * scale[2]], [.09, .09, .09])
    }
    return center
  }
  puff(body, [0, 1.05, 0], [.33, .32, .65])
  curls(body, [0, 1.15, .42], [.38, .43, .4])
  curls(body, [0, 1.08, -.48], [.32, .31, .29])
  const head = curls(body, [0, 1.72, .69], [.29, .32, .3])
  puff(head, [0, -.09, .32], [.15, .12, .26])
  puff(head, [0, -.075, .54], [.11, .08, .075], nose)
  const ears = [-1, 1].map(side => curls(head, [side * .26, -.18, -.01], [.13, .3, .17]))
  const tail = new THREE.Group(); tail.position.set(0, 1.15, -.7); tail.rotation.x = -.4; body.add(tail)
  puff(tail, [0, .19, 0], [.055, .24, .055]); curls(tail, [0, .43, 0], [.16, .16, .16])
  const legs: THREE.Group[] = []
  for (const z of [-.43, .43]) for (const x of [-.25, .25]) {
    const leg = new THREE.Group(); leg.position.set(x, 1, z); body.add(leg)
    puff(leg, [0, -.35, 0], [.065, .35, .065])
    curls(leg, [0, -.65, 0], [.14, .16, .14])
    puff(leg, [0, -.82, .065], [.11, .08, .18]); legs.push(leg)
  }
  return {
    root,
    animate(time: number) {
      const stride = time * 19
      body.position.y = Math.abs(Math.sin(stride)) * .2
      body.rotation.x = Math.sin(stride) * .12
      legs.forEach((leg, i) => { leg.rotation.x = Math.sin(stride + (i === 0 || i === 3 ? 0 : Math.PI)) * .85 })
      ears.forEach((ear, i) => { ear.rotation.z = Math.sin(stride - .5) * (i ? -.25 : .25) })
      head.rotation.x = Math.sin(stride) * .08; tail.rotation.z = Math.sin(time * 14) * .3
    },
    dispose() { root.removeFromParent(); geometry.dispose(); coat.dispose(); nose.dispose() },
  }
}

interface Escape {
  bird: Pigeon
  start: THREE.Vector3
  exit: THREE.Vector3
  alarmAt: number
  source: 'dog' | 'flock' | null
  triggerDistance: number
  returnAt: number
  speed: number
  returnSpeed: number
  returnMode: 'walk' | 'fly'
  landing: THREE.Vector3
  returnStart: number
  returnDuration: number
  upward: boolean
  stage: 'calm' | 'alert' | 'fleeing' | 'waiting' | 'returning' | 'done'
}

export function createPoodleVisit(scene: THREE.Scene, camera: THREE.PerspectiveCamera, container: HTMLElement, birds: Pigeon[], interactive: () => void, finished: () => void) {
  const dog = createPoodle(); scene.add(dog.root)
  const ray = new THREE.Raycaster(), ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
  const point = (x: number, y: number) => {
    ray.setFromCamera(new THREE.Vector2(x, y), camera)
    return ray.ray.intersectPlane(ground, new THREE.Vector3()) ?? new THREE.Vector3(0, 0, 0)
  }
  const offscreen = (margin = 1.25) => point(Math.random() < .5 ? -margin : margin, random(-.65, -.25))
  dog.root.position.copy(offscreen(1.6))
  let target = point(0, -.4), targetUntil = 0, dogEntered = false, deepRunDone = false
  const entries = new Map<string, Escape>()
  const firstUpward = Math.random() < .5
  let elapsed = 0, departedAt: number | undefined, exitStarted: number | undefined, disposed = false, unlocked = false
  const distance = (a: THREE.Vector3, b: THREE.Vector3) => Math.hypot(a.x - b.x, a.z - b.z)
  const inFrame = (position: THREE.Vector3, margin = 1) => {
    const projected = position.clone().add(new THREE.Vector3(0, .8, 0)).project(camera)
    return projected.z > -1 && projected.z < 1 && Math.abs(projected.x) < margin && Math.abs(projected.y) < margin
  }
  const enroll = (bird: Pigeon) => {
    entries.set(bird.id, { bird, start: bird.root.position.clone(), exit: new THREE.Vector3(), alarmAt: Infinity, source: null, triggerDistance: 0, returnAt: Infinity, speed: bird.speed, returnSpeed: 0, returnMode: 'walk', landing: new THREE.Vector3(), returnStart: 0, returnDuration: 0, upward: Math.random() < .45, stage: departedAt === undefined && exitStarted === undefined ? 'calm' : 'done' })
  }
  birds.forEach(enroll)
  // Even a small flock shows both escape directions; larger flocks stay random.
  const initialEntries = [...entries.values()]
  if (initialEntries[0]) initialEntries[0].upward = firstUpward
  if (initialEntries[1]) initialEntries[1].upward = !firstUpward
  const alarm = (entry: Escape, source: 'dog' | 'flock', separation: number) => {
    entry.stage = 'alert'; entry.source = source; entry.triggerDistance = separation
    entry.alarmAt = elapsed + (source === 'dog' ? random(.03, .1) : random(.1, .25))
  }
  const poseFlight = (bird: Pigeon) => {
    bird.torso.rotation.x = -.12; bird.head.position.z = .6
    bird.wings.forEach((wing, i) => { wing.rotation.z = (i ? -1 : 1) * (1.1 + Math.sin(elapsed * 29) * .75); wing.scale.y = 2.2 })
    bird.legs.forEach(leg => { leg.rotation.x = -.9 }); bird.updateNeck()
  }
  const restore = (entry: Escape) => {
    const bird = entry.bird
    bird.speed = entry.speed; bird.timer = random(3, 8); bird.flightDuration = 0; bird.settle = 0
    bird.root.visible = true; bird.root.position.y = 0; bird.torso.rotation.x = 0
    bird.wings.forEach(wing => { wing.rotation.z = 0; wing.scale.y = 1 })
    bird.legs.forEach(leg => { leg.rotation.x = 0 }); bird.head.position.z = .38; bird.updateNeck()
    entry.stage = 'done'
  }
  const scheduleReturns = () => {
    const shuffled = [...entries.values()].filter(e => e.stage !== 'done')
    for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]] }
    let batchAt = departedAt! + RETURN_DELAY
    const firstFlies = Math.random() < .5
    shuffled.forEach((entry, i) => {
      // Some share the same arrival time; others follow in short, uneven waves.
      if (i > 0 && Math.random() < .5) batchAt += random(.2, .65)
      entry.returnAt = batchAt
      entry.returnMode = (i < 2 ? (i === 0 ? firstFlies : !firstFlies) : Math.random() < .5) ? 'fly' : 'walk'
      entry.returnSpeed = entry.returnMode === 'fly' ? random(5, 8) : random(2.2, 3.4)
    })
  }
  container.dataset.poodlePhase = 'running'
  return {
    owns(id: string) { const stage = entries.get(id)?.stage; return !!stage && stage !== 'calm' && stage !== 'done' },
    release(id: string) {
      const entry = entries.get(id)
      if (!entry) return
      if (!entry.bird.root.visible) entry.bird.root.position.copy(findSpawn(birds.filter(b => b !== entry.bird && b.root.visible).map(b => b.physics)) ?? new THREE.Vector3())
      restore(entry)
    },
    update(dt: number) {
      elapsed += dt
      for (const bird of birds) if (!entries.has(bird.id)) enroll(bird)
      for (const [id] of entries) if (!birds.some(bird => bird.id === id)) entries.delete(id)
      if (departedAt === undefined) {
        const calm = [...entries.values()].filter(entry => entry.stage === 'calm')
        if (exitStarted === undefined && elapsed > 3.8 && deepRunDone && elapsed >= targetUntil && [...entries.values()].every(entry => entry.stage === 'waiting' || entry.stage === 'done')) {
          exitStarted = elapsed; target = offscreen(1.8)
        }
        if (exitStarted === undefined && elapsed >= targetUntil) {
          const nearest = calm.sort((a, b) => distance(a.bird.root.position, dog.root.position) - distance(b.bird.root.position, dog.root.position))[0]
          if (dogEntered && !deepRunDone && (elapsed > 1.3 || !nearest)) {
            // Give the deeper dash enough time to reach its target before zigzagging again.
            const center = point(random(-.35, .35), -.25)
            const inward = center.clone().sub(camera.position).setY(0).normalize()
            target = center.addScaledVector(inward, random(5, 8))
            targetUntil = elapsed + THREE.MathUtils.clamp(distance(dog.root.position, target) / 10.35 + .15, 1, 2.4)
            deepRunDone = true
          } else {
            target = !dogEntered ? point(0, -.4) : nearest ? nearest.bird.root.position.clone().setY(0).add(new THREE.Vector3(random(-1.2, 1.2), 0, random(-1.2, 1.2))) : point(random(-.75, .75), random(-.65, .05))
            targetUntil = elapsed + random(.4, .75)
          }
        }
        const heading = target.clone().sub(dog.root.position).setY(0)
        const speed = exitStarted === undefined ? 10.35 : 13.8
        dog.root.position.addScaledVector(heading.clone().normalize(), Math.min(heading.length(), speed * dt))
        if (heading.lengthSq() > .01) dog.root.rotation.y = Math.atan2(heading.x, heading.z)
        dog.animate(elapsed)
        dogEntered ||= inFrame(dog.root.position, .95)
        if (exitStarted !== undefined && (distance(dog.root.position, target) < .2 || (!inFrame(dog.root.position, 1.3) && elapsed - exitStarted > .4))) {
          departedAt = elapsed; dog.root.visible = false; scheduleReturns()
        }
        // Only actual takeoffs spread the alarm, never still-waiting neighbors.
        const takingOff = [...entries.values()].filter(entry => entry.stage === 'fleeing' && elapsed - entry.alarmAt < .9)
        for (const entry of calm) {
          const nearDog = distance(entry.bird.root.position, dog.root.position)
          const neighbor = takingOff.find(other => distance(entry.bird.root.position, other.start) < 5.2)
          if (neighbor) alarm(entry, 'flock', distance(entry.bird.root.position, neighbor.start))
          else if (dogEntered && nearDog < 5.94) alarm(entry, 'dog', nearDog)
        }
      }
      if (departedAt !== undefined && elapsed >= departedAt + RETURN_DELAY && !unlocked) {
        unlocked = true; interactive()
      }
      container.dataset.poodlePhase = departedAt === undefined ? 'running' : elapsed < departedAt + RETURN_DELAY ? 'waiting' : 'returning'
      for (const entry of entries.values()) {
        const { bird } = entry
        if (entry.stage === 'alert' && elapsed >= entry.alarmAt) {
          entry.start.copy(bird.root.position); entry.exit.copy(offscreen(1.6)); entry.exit.y = random(3, 5)
          if (entry.upward) {
            entry.exit.copy(entry.start).add(new THREE.Vector3(random(-3, 3), 8, random(-3, 3)))
            // Rise beyond the top edge for this camera, even when zoomed out.
            for (let i = 0; i < 100 && entry.exit.clone().project(camera).y < 1.4; i++) entry.exit.y += 1
          }
          bird.velocity.set(0, 0, 0); bird.flightDuration = 0; entry.stage = 'fleeing'
          container.dispatchEvent(new CustomEvent('pigeonstartled', { detail: { id: bird.id, source: entry.source, distance: entry.triggerDistance, time: elapsed, dogVisible: dog.root.visible, upward: entry.upward } }))
        }
        if (entry.stage === 'fleeing') {
          const t = THREE.MathUtils.clamp((elapsed - entry.alarmAt) / 1.5, 0, 1)
          bird.root.position.lerpVectors(entry.start, entry.exit, t)
          bird.root.position.y += Math.sin(t * Math.PI) * 1.5
          bird.root.rotation.y = Math.atan2(entry.exit.x - entry.start.x, entry.exit.z - entry.start.z)
          poseFlight(bird)
          if (entry.upward) bird.torso.rotation.x = -.45
          if (t === 1) { bird.root.visible = false; entry.stage = 'waiting' }
        }
        if (entry.stage === 'waiting' && elapsed >= entry.returnAt) {
          const occupied = [...entries.values()].filter(e => e !== entry && (e.stage === 'returning' || e.stage === 'done')).map(e => ({ ...e.bird.physics, position: e.stage === 'returning' ? e.bird.target : e.bird.root.position }))
          const destination = findSpawn(occupied)
          if (!destination) continue
          bird.root.position.copy(offscreen()); bird.root.visible = true
          bird.target.copy(destination); bird.settle = 0; bird.timer = 1000; bird.speed = entry.returnSpeed
          entry.landing.copy(destination); entry.returnStart = elapsed
          entry.start.copy(bird.root.position)
          entry.returnDuration = THREE.MathUtils.clamp(distance(entry.start, destination) / entry.returnSpeed, 1, 3.5)
          bird.root.rotation.y = Math.atan2(destination.x - bird.root.position.x, destination.z - bird.root.position.z)
          entry.stage = 'returning'
          container.dispatchEvent(new CustomEvent('pigeonreturning', { detail: { id: bird.id, mode: entry.returnMode, speed: entry.returnSpeed, time: elapsed } }))
        }
        if (entry.stage === 'returning') {
          if (entry.returnMode === 'fly') {
            const t = Math.min(1, (elapsed - entry.returnStart) / entry.returnDuration)
            bird.root.position.lerpVectors(entry.start, entry.landing, t)
            bird.root.position.y = Math.sin(t * Math.PI) * 2 + (1 - t) * 1.1
            poseFlight(bird)
            if (t === 1) restore(entry)
          } else {
            const neighbors = birds.filter(b => b.root.visible && b !== bird).map(b => b.physics)
            bird.update(dt, elapsed, bird.physics, neighbors)
            if (inFrame(bird.root.position, .85) || bird.root.position.distanceTo(bird.target) < .45 || elapsed - entry.returnStart > 9) restore(entry)
          }
        }
      }
      resolveContacts(birds.filter(b => b.root.visible).map(b => b.physics))
      container.dataset.poodleVisibleBirds = String(birds.filter(b => b.root.visible).length)
      if (departedAt !== undefined && elapsed > departedAt + RETURN_DELAY && [...entries.values()].every(e => e.stage === 'done')) this.dispose()
    },
    dispose() {
      if (disposed) return
      disposed = true; dog.dispose()
      for (const entry of entries.values()) {
        if (!birds.includes(entry.bird) || entry.stage === 'done') continue
        restore(entry)
      }
      container.dataset.poodlePhase = 'idle'; delete container.dataset.poodleVisibleBirds; finished()
    },
  }
}
