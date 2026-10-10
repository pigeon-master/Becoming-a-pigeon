import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { createPigeonBehaviors } from '../src/pigeon-behavior.ts'
import type { Pigeon } from '../src/world.ts'

function bird(id: string, x = 0, z = 0): Pigeon {
  const root = new THREE.Group(); root.position.set(x, 0, z)
  const velocity = new THREE.Vector3()
  const torso = new THREE.Group(), head = new THREE.Group()
  const face = new THREE.Mesh(new THREE.BoxGeometry(.3, .3, 1.4))
  face.position.z = .4; root.add(torso); torso.add(head); head.add(face)
  return {
    id, root, velocity, torso, head, face,
    wings: [new THREE.Group(), new THREE.Group()], legs: [new THREE.Group(), new THREE.Group()],
    settle: 0, flightDuration: 0, timer: 3,
    get physics() { return { position: root.position, velocity, radius: 1.35 } },
    updateNeck() {}, chooseTarget() {},
  } as unknown as Pigeon
}

test('pecking moves the head toward the ground, stays sparse and resets its pose', () => {
  const birds = Array.from({ length: 40 }, (_, i) => bird(String(i), i * 3))
  const controller = createPigeonBehaviors(new THREE.Scene(), birds, () => .1)
  let dipped = false, finished = false
  for (let i = 0; i < 350; i++) {
    controller.update(.05, true)
    const active = birds.filter(b => controller.owns(b))
    assert.ok(active.length <= 5 && active.length < birds.length)
    if (active.some(b => b.head.position.y < 1.4)) dipped = true
    for (const b of active) {
      b.face.updateWorldMatrix(true, false)
      const vertices = b.face.geometry.getAttribute('position'), point = new THREE.Vector3()
      for (let j = 0; j < vertices.count; j++) assert.ok(point.fromBufferAttribute(vertices, j).applyMatrix4(b.face.matrixWorld).y >= .0249)
    }
    if (dipped && !controller.owns(birds[0])) {
      assert.equal(birds[0].head.position.y, 1.57); finished = true
    }
  }
  assert.ok(dipped && finished); controller.dispose()
})

test('white liquid falls, splashes on the ground, fades and releases its objects', () => {
  const scene = new THREE.Scene(), birds = [bird('one')]
  const controller = createPigeonBehaviors(scene, birds, () => .5)
  for (let i = 0; i < 400 && controller.summary.actions.length === 0; i++) controller.update(.05, true)
  for (let i = 0; i < 24; i++) controller.update(.05, false)
  assert.equal(controller.summary.droppings, 0)
  for (let i = 0; i < 20 && controller.summary.droppings === 0; i++) controller.update(.05, false)
  assert.equal(controller.summary.droppings, 1)
  assert.ok(scene.children[0].position.y > .018)
  for (let i = 0; i < 30; i++) controller.update(.05, false)
  assert.equal(scene.children[0].position.y, .018)
  assert.equal(scene.children[0].children.length, 7)
  for (let i = 0; i < 600; i++) controller.update(.05, false)
  assert.equal(controller.summary.droppings, 0); assert.equal(scene.children.length, 0)
  controller.dispose()
})

test('paired behavior mounts one bird, flaps, separates and cancels both partners safely', () => {
  const birds = [bird('top'), bird('bottom', 0, 3)]
  const scene = new THREE.Scene(), controller = createPigeonBehaviors(scene, birds, () => 0)
  for (let i = 0; i < 12000 && !controller.summary.actions.some(action => action.kind === 'mating'); i++) controller.update(.05, true)
  const pair = controller.summary.actions.find(action => action.kind === 'mating')
  assert.equal(pair?.ids.length, 2)
  for (let i = 0; i < 35; i++) controller.update(.05, false)
  assert.equal(controller.mounted(birds[0]), true)
  assert.ok(birds[0].root.position.y > .6 && birds[0].root.position.y < .8)
  const mountedOffset = birds[0].root.position.clone().sub(birds[1].root.position).applyAxisAngle(new THREE.Vector3(0, 1, 0), -birds[1].root.rotation.y)
  assert.ok(mountedOffset.z < -.7 && mountedOffset.z > -.9, 'Mount sits over the tail end of the back')
  assert.ok(Math.abs(birds[0].wings[0].rotation.z) > .5)
  assert.ok(scene.children.some(object => object instanceof THREE.Mesh && (object.material as THREE.MeshBasicMaterial).color.getHex() === 0xff72ae))
  controller.cancel(birds[1])
  assert.equal(controller.summary.actions.some(action => action.kind === 'mating'), false)
  assert.equal(birds[0].root.position.y, 0)
  assert.ok(birds[0].root.position.distanceTo(birds[1].root.position) >= 2.7)
  assert.equal(birds[0].wings[0].scale.y, 1)
  // Cancellation does not immediately restart the pair.
  for (let i = 0; i < 40; i++) controller.update(.05, true)
  assert.equal(controller.summary.actions.length, 0)
  controller.dispose()
})

test('an eligible nearby pair starts without probability rejection', () => {
  const birds = [bird('top'), bird('bottom', 0, 3)]
  const controller = createPigeonBehaviors(new THREE.Scene(), birds, () => .8)
  const starts: number[] = []
  let wasMating = false
  for (let i = 0; i < 12000; i++) {
    controller.update(.05, true)
    const mating = controller.summary.actions.some(action => action.kind === 'mating')
    if (mating && !wasMating) starts.push((i + 1) * .05)
    wasMating = mating
  }
  assert.ok(starts.length > 0)
  assert.ok(starts[0] >= 30)
  controller.dispose()
})

test('a small flock cannot repeatedly mate without a long individual rest', () => {
  const birds = [bird('top'), bird('bottom', 0, 3)]
  const controller = createPigeonBehaviors(new THREE.Scene(), birds, () => 0)
  const starts: number[] = []
  let wasMating = false
  for (let i = 0; i < 18000; i++) {
    controller.update(.05, true)
    const mating = controller.summary.actions.some(action => action.kind === 'mating')
    if (mating && !wasMating) starts.push((i + 1) * .05)
    wasMating = mating
  }
  assert.ok(starts.length > 1, 'Rare behavior remains possible')
  assert.ok(starts[0] >= 30)
  for (let i = 1; i < starts.length; i++) assert.ok(starts[i] - starts[i - 1] >= 108, 'Pair must finish and rest before mating again')
  controller.dispose()
})

test('hidden, airborne and externally controlled birds never start an ambient action', () => {
  const birds = [bird('hidden'), bird('flying'), bird('controlled')]
  birds[0].root.visible = false; birds[1].flightDuration = 2
  const controller = createPigeonBehaviors(new THREE.Scene(), birds, () => .1)
  for (let i = 0; i < 1000; i++) controller.update(.05, true, b => b.id === 'controlled')
  assert.equal(controller.summary.actions.length, 0); controller.dispose()
})
