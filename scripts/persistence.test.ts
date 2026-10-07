import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import { openStore, validAsset } from '../server/store.ts'
import { createApp } from '../server/index.ts'
import type { FaceAsset, FlockSnapshot } from '../src/pigeon-data.ts'

const asset: FaceAsset = { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], uv: [0, 0, 1, 0, 0, 1], photoWeights: [1, 1, 1], indices: [0, 1, 2], image: `data:image/jpeg;base64,${Buffer.from([255, 216, 255, 224, 0, 255, 217]).toString('base64')}` }
test('deletion requires ownership, survives retries and never resurrects a removed pigeon', async () => {
  const server = createApp(':memory:')
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address(); assert.ok(address && typeof address !== 'string')
  const url = `http://127.0.0.1:${address.port}/api/pigeons`
  const id = randomUUID(), other = randomUUID(), token = 'a'.repeat(64)
  const create = (bird: string) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: bird, token, asset }) })
  const remove = (authorization?: string, origin?: string) => fetch(`${url}/${id}`, { method: 'DELETE', headers: { ...(authorization ? { Authorization: `Bearer ${authorization}` } : {}), ...(origin ? { Origin: origin } : {}) } })
  try {
    await create(id); await create(other)
    assert.equal((await remove()).status, 403)
    assert.equal((await remove('b'.repeat(64))).status, 403)
    assert.equal((await remove(token, 'https://elsewhere.example')).status, 403)
    assert.equal((await fetch(`${url}/${id}`)).status, 200)
    assert.equal((await remove(token)).status, 200)
    assert.equal((await remove(token)).status, 200)
    assert.equal((await fetch(`${url}/${id}`)).status, 404)
    await create(id)
    const saved = await (await fetch(url)).json() as FlockSnapshot
    assert.deepEqual(saved.birds.map(b => b.id), [other])
  } finally { await new Promise<void>(resolve => server.close(() => resolve())) }
})
test('disk persistence, FIFO replacement and idempotent retries survive store restart', () => {
  const root = resolve(tmpdir()), directory = mkdtempSync(resolve(root, 'pigeon-store-'))
  const file = resolve(directory, 'test.sqlite')
  let store = openStore(file)
  try {
    const ids = Array.from({ length: 42 }, () => randomUUID())
    ids.forEach(id => store.add(id, asset))
    assert.deepEqual(store.snapshot().birds.map(b => b.id), ids.slice(2))
    assert.equal(store.snapshot().birds.at(-1)?.replaces, ids[1])
    assert.equal(store.get(ids[0]), null)
    store.close(); store = openStore(file)
    assert.deepEqual(store.get(ids[41]), asset)
    store.add(ids[0], asset); store.add(ids[41], asset)
    assert.equal(store.snapshot().revision, 42)
    assert.deepEqual(store.snapshot().birds.map(b => b.id), ids.slice(2))
  } finally {
    store.close()
    assert.ok(directory.startsWith(root + sep))
    rmSync(directory, { recursive: true, force: true })
  }
})
test('invalid mesh, out-of-range UV, oversized image and non-finite positions are rejected', () => {
  assert.ok(validAsset(asset))
  assert.equal(validAsset({ ...asset, indices: [0, 1, 5] }), false)
  assert.equal(validAsset({ ...asset, uv: [-1, 0, 0, 0, 0, 0] }), false)
  assert.equal(validAsset({ ...asset, positions: [Infinity, ...asset.positions.slice(1)] }), false)
  assert.equal(validAsset({ ...asset, image: 'x'.repeat(700001) }), false)
})
test('concurrent HTTP creation keeps 40 records; repeated request does not add a bird', async () => {
  const server = createApp(':memory:')
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address(); assert.ok(address && typeof address !== 'string')
  const url = `http://127.0.0.1:${address.port}/api/pigeons`
  try {
    const ids = Array.from({ length: 45 }, () => randomUUID())
    const results = await Promise.all(ids.map(id => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, asset }) })))
    results.forEach(r => assert.equal(r.status, 200))
    const snapshot = await (await fetch(url)).json() as FlockSnapshot
    assert.equal(snapshot.birds.length, 40); assert.equal(snapshot.revision, 45)
    const retained = snapshot.birds.at(-1)!.id
    await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: retained, asset }) })
    assert.deepEqual(await (await fetch(url)).json(), snapshot)
    const bad = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: randomUUID(), asset: {} }) })
    assert.equal(bad.status, 400)
  } finally { await new Promise<void>(resolve => server.close(() => resolve())) }
})
