import { Vector3 } from 'three'

// Broad capsules around the torso, head and tail; altitude matters during flight.
export const PIGEON_RADIUS = 1.35
export const PIGEON_HEIGHT = 1.9
export interface FlockBody {
  position: Vector3
  velocity: Vector3
  radius: number
}
const sameHeight = (a: FlockBody, b: FlockBody) => Math.abs(a.position.y - b.position.y) < PIGEON_HEIGHT

export function steerAround(body: FlockBody, others: FlockBody[], desired: Vector3) {
  const steering = desired.clone()
  for (const other of others) {
    if (body === other || !sameHeight(body, other)) continue
    const away = body.position.clone().sub(other.position); away.y = 0
    const distance = away.length(), spacing = body.radius + other.radius
    if (distance < .00001 || distance > spacing + 2) continue
    const normal = away.divideScalar(distance)
    const approach = desired.clone().sub(other.velocity).dot(normal)
    if (approach >= 0 && distance > spacing + .1) continue
    const strength = Math.max(0, 1 - (distance - spacing) / 2)
    // Each bird passes on its own right, avoiding head-on left/right oscillation.
    const right = new Vector3(normal.z, 0, -normal.x)
    steering.addScaledVector(normal, strength * 1.7)
    steering.addScaledVector(right, strength * 1.25)
  }
  return steering.clampLength(0, desired.length())
}

export function resolveContacts(bodies: FlockBody[]) {
  const contacts = new Map<number, Vector3>()
  // Iteration propagates separation through groups instead of fixing just one pair.
  for (let pass = 0; pass < 20; pass++) {
    let penetration = 0
    for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i], b = bodies[j]
      if (!sameHeight(a, b)) continue
      const normal = a.position.clone().sub(b.position); normal.y = 0
      const distance = normal.length(), spacing = a.radius + b.radius
      if (distance >= spacing) continue
      penetration = Math.max(penetration, spacing - distance)
      if (distance > .00001) normal.divideScalar(distance)
      else normal.set(Math.cos((i + j * 7) * 2.4), 0, Math.sin((i + j * 7) * 2.4))
      const correction = (spacing - distance + .0001) * .5
      a.position.addScaledVector(normal, correction); b.position.addScaledVector(normal, -correction)
      const closing = a.velocity.clone().sub(b.velocity).dot(normal)
      if (closing < 0) {
        const impulse = -closing * .6
        a.velocity.addScaledVector(normal, impulse); b.velocity.addScaledVector(normal, -impulse)
      }
      contacts.set(i, (contacts.get(i) ?? new Vector3()).add(normal))
      contacts.set(j, (contacts.get(j) ?? new Vector3()).addScaledVector(normal, -1))
    }
    if (penetration < .0001) break
  }
  return contacts
}

export function findSpawn(bodies: FlockBody[]) {
  // Search outward from the showcase position; never create intersecting birds.
  for (let ring = 0; ring <= 10; ring++) {
    const samples = Math.max(1, ring * 12)
    for (let step = 0; step < samples; step++) {
      const angle = step / samples * Math.PI * 2
      const position = new Vector3(Math.sin(angle) * ring * .6, 0, Math.cos(angle) * ring * .6)
      const candidate = { position, velocity: new Vector3(), radius: PIGEON_RADIUS }
      if (bodies.every(other => !sameHeight(candidate, other) || Math.hypot(position.x - other.position.x, position.z - other.position.z) >= PIGEON_RADIUS + other.radius + .15)) return position
    }
  }
  // The 40-bird limit fits this larger reserve search.
  for (let x = -15; x <= 15; x += 3) for (let z = -15; z <= 15; z += 3) {
    const position = new Vector3(x, 0, z)
    if (bodies.every(other => Math.hypot(x - other.position.x, z - other.position.z) >= PIGEON_RADIUS + other.radius + .15)) return position
  }
  return null
}
