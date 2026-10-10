import * as THREE from 'three'
import type { Pigeon } from './world'
import { PIGEON_RADIUS, findSpawn } from './flock-physics.ts'

type Kind = 'peck' | 'dropping' | 'mating'
interface Action {
  kind: Kind; birds: Pigeon[]; age: number; duration: number
  start: THREE.Vector3; landing: THREE.Vector3; emitted: boolean
  nextPeck: number; peckStart: number; peckDuration: number; nextHeart: number
}
interface Dropping {
  root: THREE.Group; material: THREE.MeshStandardMaterial; velocity: THREE.Vector3
  age: number; life: number; landed: boolean
}

export function createPigeonBehaviors(scene: THREE.Scene, birds: Pigeon[], random = Math.random) {
  const between = (a: number, b: number) => a + random() * (b - a)
  const actions = new Set<Action>(), busy = new Map<Pigeon, Action>()
  const cooldowns = new Map<Pigeon, number>(), droppings: Dropping[] = []
  const matingRest = new Map<Pigeon, number>()
  const sphere = new THREE.SphereGeometry(1, 10, 7)
  const hearts: { mesh: THREE.Mesh; age: number; material: THREE.MeshBasicMaterial }[] = []
  const heart = new THREE.Shape()
  heart.moveTo(0, -.5); heart.bezierCurveTo(-.9, .05, -.55, .8, 0, .35); heart.bezierCurveTo(.55, .8, .9, .05, 0, -.5)
  const heartGeometry = new THREE.ShapeGeometry(heart)
  const tip = new THREE.Vector3()
  let matingCooldown = between(45, 60)
  const eligible = (bird: Pigeon) => bird.root.visible && bird.root.position.y < .05 && !bird.flightDuration && bird.settle <= 0 && !busy.has(bird)
  const reset = (bird: Pigeon) => {
    bird.root.position.y = 0; bird.torso.position.y = 0; bird.torso.rotation.x = 0
    bird.head.position.set(0, 1.57, .38); bird.head.rotation.set(0, 0, 0)
    bird.wings.forEach(wing => { wing.rotation.z = 0; wing.scale.y = 1 })
    bird.legs.forEach(leg => { leg.rotation.x = 0 })
    bird.velocity.set(0, 0, 0); bird.updateNeck(); bird.timer = between(3, 8)
  }
  const landingFor = (top: Pigeon, bottom: Pigeon) => {
    const point = new THREE.Vector3(0, 0, -3).applyAxisAngle(new THREE.Vector3(0, 1, 0), bottom.root.rotation.y).add(bottom.root.position).setY(0)
    const others = birds.filter(b => b !== top && b.root.visible).map(b => b.physics)
    if (others.every(other => Math.hypot(point.x - other.position.x, point.z - other.position.z) > 2 * PIGEON_RADIUS + .05)) return point
    return findSpawn(others) ?? top.root.position.clone().setY(0)
  }
  const finish = (action: Action) => {
    if (action.kind === 'mating' && birds.includes(action.birds[0])) action.birds[0].root.position.copy(landingFor(action.birds[0], action.birds[1]))
    for (const bird of action.birds) {
      busy.delete(bird)
      if (birds.includes(bird)) { reset(bird); bird.chooseTarget(); cooldowns.set(bird, between(14, 32)) }
      if (action.kind === 'mating' && birds.includes(bird)) matingRest.set(bird, between(100, 160))
    }
    actions.delete(action)
  }
  const discardDropping = (drop: Dropping) => {
    drop.root.traverse(object => { if (object instanceof THREE.Mesh && object.geometry !== sphere) object.geometry.dispose() })
    drop.root.removeFromParent(); drop.material.dispose()
    droppings.splice(droppings.indexOf(drop), 1)
  }
  const emit = (bird: Pigeon) => {
    if (droppings.length >= 12) discardDropping(droppings[0])
    const root = new THREE.Group()
    root.position.copy(new THREE.Vector3(0, .57, -.65).applyAxisAngle(new THREE.Vector3(0, 1, 0), bird.root.rotation.y).add(bird.root.position))
    const material = new THREE.MeshStandardMaterial({ color: 0xdcd6c5, roughness: .65, transparent: true, depthWrite: false })
    const liquid = new THREE.Mesh(sphere, material); liquid.scale.set(.06, .16, .06); root.add(liquid); scene.add(root)
    droppings.push({ root, material, age: 0, life: between(18, 28), landed: false, velocity: new THREE.Vector3(0, -.4, -.8).applyAxisAngle(new THREE.Vector3(0, 1, 0), bird.root.rotation.y) })
  }
  const begin = (kind: Kind, participants: Pigeon[]) => {
    const action: Action = { kind, birds: participants, age: 0, duration: kind === 'peck' ? between(2.5, 4.5) : kind === 'dropping' ? 2.7 : between(8.8, 10), start: participants[0].root.position.clone(), landing: new THREE.Vector3(), emitted: false, nextPeck: .35, peckStart: 0, peckDuration: .2, nextHeart: 1.25 }
    if (kind === 'mating') action.landing.copy(landingFor(participants[0], participants[1]))
    participants.forEach(bird => { reset(bird); busy.set(bird, action) }); actions.add(action)
  }
  return {
    owns(bird: Pigeon) { return busy.has(bird) },
    mounted(bird: Pigeon) { const action = busy.get(bird); return action?.kind === 'mating' && action.birds[0] === bird },
    cancel(bird?: Pigeon) {
      if (bird) { const action = busy.get(bird); if (action) finish(action) }
      else for (const action of [...actions]) finish(action)
    },
    get summary() { return { actions: [...actions].map(action => ({ kind: action.kind, ids: action.birds.map(b => b.id) })), droppings: droppings.length } },
    update(dt: number, allowNew: boolean, excluded: (bird: Pigeon) => boolean = () => false) {
      if (allowNew) matingCooldown = Math.max(0, matingCooldown - dt)
      for (const [bird, remaining] of matingRest) {
        if (!birds.includes(bird)) matingRest.delete(bird)
        else matingRest.set(bird, Math.max(0, remaining - dt))
      }
      for (const bird of cooldowns.keys()) if (!birds.includes(bird)) cooldowns.delete(bird)
      for (const action of [...actions]) if (action.birds.some(bird => !birds.includes(bird) || excluded(bird))) finish(action)
      const cap = Math.min(5, Math.max(1, Math.ceil(birds.length * .22)))
      // A failed opportunity also resets the timer: never retry the probability
      // every frame. Small flocks have both longer intervals and lower chances.
      if (allowNew && matingCooldown === 0) {
        const flockSize = birds.filter(bird => bird.root.visible && !excluded(bird)).length
        matingCooldown = flockSize <= 5 ? between(45, 60) : between(35, 50)
        const chance = Math.min(.45, .25 + Math.max(0, flockSize - 2) * .03)
        const available = birds.filter(bird => !excluded(bird) && eligible(bird) && !(matingRest.get(bird) ?? 0))
        const canStart = available.length >= 2 && busy.size + 2 <= Math.max(2, cap) && ![...actions].some(action => action.kind === 'mating')
        const offset = canStart && random() < chance ? Math.floor(random() * available.length) : -1
        for (let i = 0; offset >= 0 && i < available.length; i++) {
          const bird = available[(offset + i) % available.length]
          const partner = available.find(other => other !== bird && other.root.position.distanceTo(bird.root.position) < 6 && birds.every(third => third === bird || third === other || third.root.position.distanceTo(other.root.position) > 2.7))
          if (partner) { begin('mating', [bird, partner]); break }
        }
      }
      for (const bird of birds) {
        if (!cooldowns.has(bird)) cooldowns.set(bird, between(7, 22))
        cooldowns.set(bird, Math.max(0, cooldowns.get(bird)! - dt))
        if (!allowNew || excluded(bird) || !eligible(bird) || cooldowns.get(bird)! > 0 || busy.size >= cap) continue
        cooldowns.set(bird, between(10, 26))
        const choice = random()
        if (choice < .43) begin('peck', [bird])
        else if (choice < .59) begin('dropping', [bird])
        // Remaining chances leave the pigeon walking normally.
      }
      for (const action of [...actions]) {
        action.age += dt
        const bird = action.birds[0]
        if (action.kind === 'peck') {
          const envelope = Math.max(0, Math.min(1, action.age / .3, (action.duration - action.age) / .3))
          if (action.age >= action.nextPeck) {
            action.peckStart = action.age; action.peckDuration = between(.12, .21)
            action.nextPeck = action.age + action.peckDuration + between(.04, .18) + (random() < .2 ? between(.15, .35) : 0)
          }
          const phase = (action.age - action.peckStart) / action.peckDuration
          const tap = phase >= 0 && phase < 1 ? Math.sin(phase * Math.PI) : 0
          bird.torso.rotation.x = envelope * .12; bird.torso.position.y = -envelope * .04
          bird.head.position.set(0, 1.57 - envelope * .8, .38 + envelope * (.35 + tap * .05))
          bird.head.rotation.x = envelope * (.9 + tap * .08)
          // Use the actual deformed face vertices, so even long beaks cannot cross the asphalt.
          bird.face.updateWorldMatrix(true, false)
          const vertices = bird.face.geometry.getAttribute('position')
          let lowest = Infinity
          for (let i = 0; i < vertices.count; i++) lowest = Math.min(lowest, tip.fromBufferAttribute(vertices, i).applyMatrix4(bird.face.matrixWorld).y)
          const clearance = .025 + (1 - tap) * .14
          const lift = Math.max(.025 - lowest, (clearance - lowest) * envelope)
          bird.head.position.y += lift / Math.max(.1, bird.torso.matrixWorld.elements[5])
          bird.updateNeck()
        } else if (action.kind === 'dropping') {
          bird.torso.rotation.x = action.age < 1.3 ? 0 : Math.sin(Math.min(1, (action.age - 1.3) / 1.4) * Math.PI) * .15
          if (!action.emitted && action.age > 1.65) { emit(bird); action.emitted = true }
        } else {
          const bottom = action.birds[1], yaw = bottom.root.rotation.y
          const mount = new THREE.Vector3(0, .68, -.78).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw).add(bottom.root.position)
          bird.root.rotation.y = yaw
          if (action.age < 1.15) {
            const p = THREE.MathUtils.smoothstep(action.age, 0, 1.15)
            bird.root.position.lerpVectors(action.start, mount, p); bird.root.position.y += Math.sin(p * Math.PI) * .65
          } else if (action.age > action.duration - 1.1) {
            const p = THREE.MathUtils.smoothstep(action.age, action.duration - 1.1, action.duration)
            bird.root.position.lerpVectors(mount, action.landing, p); bird.root.position.y += Math.sin(p * Math.PI) * .35
          } else bird.root.position.copy(mount)
          bottom.torso.position.y = -.12; bottom.head.position.y = 1.4; bottom.updateNeck()
          bird.torso.rotation.x = .12
          bird.wings.forEach((wing, i) => { wing.rotation.z = (i ? -1 : 1) * (1.15 + Math.sin(action.age * 24) * .5); wing.scale.y = 2.2 })
          bird.head.position.z = .48 + Math.sin(action.age * 12) * .04; bird.updateNeck()
          if (action.age >= action.nextHeart && action.age < action.duration - .7) {
            action.nextHeart = action.age + between(.35, .55)
            const material = new THREE.MeshBasicMaterial({ color: 0xff72ae, transparent: true, side: THREE.DoubleSide, depthWrite: false })
            const mesh = new THREE.Mesh(heartGeometry, material)
            mesh.position.copy(bottom.root.position).add(new THREE.Vector3(between(-.85, .85), between(2.1, 2.5), between(-.5, .5)))
            mesh.scale.setScalar(.08); mesh.onBeforeRender = (_renderer, _scene, camera) => { mesh.quaternion.copy(camera.quaternion); mesh.updateMatrixWorld() }
            scene.add(mesh); hearts.push({ mesh, age: 0, material })
          }
        }
        if (action.age >= action.duration) finish(action)
      }
      for (const drop of [...droppings]) {
        drop.age += dt
        if (!drop.landed) {
          drop.velocity.y -= 9.8 * dt; drop.root.position.addScaledVector(drop.velocity, dt)
          if (drop.root.position.y <= .018) {
            drop.landed = true; drop.root.position.y = .018; drop.root.clear()
            for (let i = 0; i < 7; i++) {
              const shape = new THREE.Shape(), size = i ? between(.018, .05) : .19
              for (let j = 0; j < 18; j++) {
                const angle = j / 18 * Math.PI * 2, radius = size * (.85 + .25 * Math.sin(j * 2.3) + .18 * Math.cos(j * 4.1)) * between(.8, 1.2)
                const x = Math.cos(angle) * radius, y = Math.sin(angle) * radius * (i ? .6 : 1.35)
                if (j === 0) shape.moveTo(x, y); else shape.lineTo(x, y)
              }
              shape.closePath()
              const splat = new THREE.Mesh(new THREE.ShapeGeometry(shape), drop.material); splat.rotation.x = -Math.PI / 2
              if (i) splat.position.set(Math.cos(i * 2.4) * between(.12, .28), i * .0002, Math.sin(i * 2.4) * between(.15, .32))
              drop.root.add(splat)
            }
          }
        }
        drop.material.opacity = Math.min(1, Math.max(0, (drop.life - drop.age) / 4))
        if (drop.age >= drop.life) discardDropping(drop)
      }
      for (let i = hearts.length - 1; i >= 0; i--) {
        const heart = hearts[i]; heart.age += dt; heart.mesh.position.y += dt * .65
        heart.mesh.scale.setScalar(.3 * Math.min(1, heart.age / .15)); heart.material.opacity = Math.min(1, (1.5 - heart.age) / .5)
        if (heart.age >= 1.5) { heart.mesh.removeFromParent(); heart.material.dispose(); hearts.splice(i, 1) }
      }
    },
    dispose() { this.cancel(); for (const drop of [...droppings]) discardDropping(drop); for (const heart of hearts) { heart.mesh.removeFromParent(); heart.material.dispose() } hearts.length = 0; sphere.dispose(); heartGeometry.dispose() },
  }
}
