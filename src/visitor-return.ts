import * as THREE from 'three'
import type { Pigeon } from './world'
import type { FlockBody } from './flock-physics'
import { findSpawn } from './flock-physics'

const random = (min: number, max: number) => min + Math.random() * (max - min)
export interface VisitorReturn {
  bird: Pigeon
  start: THREE.Vector3
  landing: THREE.Vector3
  returnAt: number
  returnStart: number
  returnDuration: number
  returnMode: 'walk' | 'fly'
  returnSpeed: number
}

export function scheduleVisitorReturns(entries: VisitorReturn[], departure: number, delay = 4) {
  const shuffled = [...entries]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1)); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  let batchAt = departure + delay
  const firstFlies = Math.random() < .5
  shuffled.forEach((entry, i) => {
    if (i > 0 && Math.random() < .5) batchAt += random(.2, .65)
    entry.returnAt = batchAt
    entry.returnMode = (i < 2 ? (i === 0 ? firstFlies : !firstFlies) : Math.random() < .5) ? 'fly' : 'walk'
    entry.returnSpeed = entry.returnMode === 'fly' ? random(5, 8) : random(2.2, 3.4)
  })
}

export function beginVisitorReturn(entry: VisitorReturn, time: number, spawn: THREE.Vector3, occupied: FlockBody[]) {
  const destination = findSpawn(occupied)
  if (!destination) return false
  const bird = entry.bird
  bird.root.position.copy(spawn); bird.root.visible = true
  bird.target.copy(destination); bird.settle = 0; bird.timer = 1000; bird.speed = entry.returnSpeed
  entry.landing.copy(destination); entry.returnStart = time; entry.start.copy(spawn)
  entry.returnDuration = THREE.MathUtils.clamp(Math.hypot(spawn.x - destination.x, spawn.z - destination.z) / entry.returnSpeed, 1, 3.5)
  bird.root.rotation.y = Math.atan2(destination.x - spawn.x, destination.z - spawn.z)
  return true
}

export function updateVisitorReturn(entry: VisitorReturn, dt: number, time: number, neighbors: FlockBody[], inFrame: (position: THREE.Vector3, margin: number) => boolean) {
  const bird = entry.bird
  if (entry.returnMode === 'fly') {
    const t = Math.min(1, (time - entry.returnStart) / entry.returnDuration)
    bird.root.position.lerpVectors(entry.start, entry.landing, t)
    bird.root.position.y = Math.sin(t * Math.PI) * 2 + (1 - t) * 1.1
    bird.torso.rotation.x = -.12; bird.head.position.z = .6
    bird.wings.forEach((wing, i) => { wing.rotation.z = (i ? -1 : 1) * (1.1 + Math.sin(time * 29) * .75); wing.scale.y = 2.2 })
    bird.legs.forEach(leg => { leg.rotation.x = -.9 }); bird.updateNeck()
    return t === 1
  }
  // Walking uses the normal gait and collision steering, not position interpolation.
  bird.update(dt, time, bird.physics, neighbors)
  return inFrame(bird.root.position, .85) || bird.root.position.distanceTo(bird.target) < .45 || time - entry.returnStart > 9
}
