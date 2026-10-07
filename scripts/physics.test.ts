import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Vector3 } from 'three'
import { findSpawn, PIGEON_HEIGHT, PIGEON_RADIUS, resolveContacts, steerAround } from '../src/flock-physics.ts'
import type { FlockBody } from '../src/flock-physics.ts'

const body = (x: number, z: number, y = 0): FlockBody => ({ position: new Vector3(x, y, z), velocity: new Vector3(), radius: PIGEON_RADIUS })
function separated(bodies: FlockBody[]) {
  for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) {
    const a = bodies[i], b = bodies[j]
    if (Math.abs(a.position.y - b.position.y) >= PIGEON_HEIGHT) continue
    assert.ok(Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z) >= a.radius + b.radius - .002, `Overlapping birds ${i}, ${j}`)
  }
}
test('40 new birds spawn without overlap, including while the flock is paused', () => {
  const flock: FlockBody[] = []
  for (let i = 0; i < 40; i++) {
    const position = findSpawn(flock); assert.ok(position)
    flock.push({ ...body(0, 0), position }); separated(flock)
  }
})
test('exactly coincident birds separate with finite positions and bounce', () => {
  const flock = [body(0, 0), body(0, 0), body(0, 0)]
  assert.equal(resolveContacts(flock).size, 3); separated(flock)
  flock.forEach(b => assert.ok(b.position.toArray().every(Number.isFinite)))
  const a = body(-1, 0), b = body(1, 0)
  a.velocity.x = 1; b.velocity.x = -1
  resolveContacts([a, b]); separated([a, b])
  assert.ok(a.velocity.x < 0 && b.velocity.x > 0)
})
test('head-on approach steers to opposite sides before contact', () => {
  const a = body(-1.8, 0), b = body(1.8, 0)
  a.velocity.x = .8; b.velocity.x = -.8
  const left = steerAround(a, [a, b], a.velocity), right = steerAround(b, [a, b], b.velocity)
  assert.ok(left.z * right.z < 0)
  assert.ok(left.x < a.velocity.x && right.x > b.velocity.x)
})
test('flight respects height and resolves an occupied landing position', () => {
  const ground = body(0, 0), flyer = body(0, 0, PIGEON_HEIGHT + .1)
  assert.equal(resolveContacts([ground, flyer]).size, 0)
  flyer.position.y = .5
  assert.equal(resolveContacts([ground, flyer]).size, 2); separated([ground, flyer])
  assert.equal(flyer.position.y, .5)
})
test('walking and fast flight remain separated across 120 seconds of crossing paths', () => {
  const flock = Array.from({ length: 12 }, (_, i) => body(Math.sin(i / 12 * Math.PI * 2) * 8, Math.cos(i / 12 * Math.PI * 2) * 8))
  const targets = flock.map(b => b.position.clone().negate())
  const dt = 1 / 60
  for (let frame = 0; frame < 7200; frame++) {
    const snapshot = flock.map(b => ({ ...b, position: b.position.clone(), velocity: b.velocity.clone() }))
    flock.forEach((b, i) => {
      if (b.position.distanceTo(targets[i]) < .3) targets[i].negate()
      const desired = targets[i].clone().sub(b.position).normalize().multiplyScalar(i % 3 ? 1 : 3.2)
      const velocity = steerAround(snapshot[i], snapshot, desired)
      b.velocity.lerp(velocity, 1 - Math.exp(-dt * 8))
      b.position.addScaledVector(b.velocity, dt)
    })
    resolveContacts(flock); separated(flock)
  }
})
