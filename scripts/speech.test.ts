import { test } from 'node:test'
import assert from 'node:assert/strict'
import { addNoise, automaticIndices, editSpeech, humanCount, normalizeSpeech, restoreSpeech, speechValue, validSpeech } from '../src/speech-text.ts'
import { openStore } from '../server/store.ts'
import type { FaceAsset } from '../src/pigeon-data.ts'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, sep } from 'node:path'

test('random interruptions respect 50 characters, keep Hangul and never exceed four nines', () => {
  let seed = 19
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }
  for (const text of ['안녕하세요 Hello there', 'a'.repeat(50), '가'.repeat(50), '999999999999', 'English 한국어 9', '👋'.repeat(50)]) {
    for (let i = 0; i < 50; i++) {
      const original = editSpeech([], text, text.length).chars
      const result = addNoise(original, text.length, random), value = speechValue(result.chars)
      assert.equal(humanCount(result.chars), humanCount(original))
      assert.ok(humanCount(result.chars) <= 50)
      assert.ok(!/9{5}/.test(value))
      assert.ok(/9/.test(value) && /\./.test(value))
      assert.ok(result.cursor >= 0 && result.cursor <= value.length)
      assert.ok(validSpeech(value, automaticIndices(result.chars)))
    }
  }
  assert.equal(normalizeSpeech('가 '.repeat(60)).length, 50)
  assert.equal(speechValue(addNoise([], 0).chars), '')
})
test('all 50 user characters survive noise and restore with the same count', () => {
  const original = editSpeech([], '가'.repeat(50), 50).chars
  const result = addNoise(original, 50, () => .5).chars
  assert.ok(speechValue(result).length > 50)
  assert.equal(humanCount(result), 50)
  assert.equal(result.filter(c => !c.automatic).map(c => c.char).join(''), '가'.repeat(50))
  assert.equal(humanCount(restoreSpeech(speechValue(result), automaticIndices(result))), 50)
  assert.equal(validSpeech('x'.repeat(101), []), false)
  assert.equal(validSpeech('hello', [0]), false)
  const full = editSpeech([], 'a'.repeat(50), 50).chars
  const blocked = editSpeech(full, 'a'.repeat(25) + 'x' + 'a'.repeat(25), 26, { start: 25, end: 25, type: 'insertText' })
  assert.equal(speechValue(blocked.chars), 'a'.repeat(50))
  assert.equal(blocked.cursor, 25)
})

test('generated dot groups contain exactly two dots, including near the noise limit', () => {
  for (let room = 1; room <= 75; room++) {
    for (const random of [() => 0, () => .5, () => .999]) {
      const previous = [...Array.from({ length: 75 - room }, () => ({ char: '.', automatic: true })), { char: 'a', automatic: false }]
      const result = addNoise(previous, previous.length, random)
      const added = speechValue(result.chars).slice(previous.length)
      assert.ok(added.includes('9'))
      for (const group of added.match(/\.+/g) ?? []) assert.equal(group.length, 2)
      assert.ok(automaticIndices(result.chars).length <= 75)
      assert.equal(humanCount(result.chars), 1)
    }
  }
})
test('noise is inserted only at the newly typed caret and preserves the earlier prefix', () => {
  const previous = editSpeech([], '앞 문장 NEW 뒤 문장', 8).chars
  const result = addNoise(previous, 8, () => .5)
  assert.ok(speechValue(result.chars).startsWith('앞 문장 NEW.'))
  assert.ok(speechValue(result.chars).endsWith(' 뒤 문장'))
  assert.deepEqual(result.chars.slice(0, 8), previous.slice(0, 8))
  const atEnd = addNoise(previous, speechValue(previous).length, () => .5)
  assert.ok(speechValue(atEnd.chars).startsWith(speechValue(previous)))
})
test('deletion respects the selected character provenance and never adds noise', () => {
  const original = restoreSpeech('99', [1])
  const result = editSpeech(original, '9', 0, { start: 0, end: 1, type: 'deleteContentBackward' })
  assert.equal(humanCount(result.chars), 0)
  assert.equal(speechValue(result.chars), '9')
  const cleared = editSpeech(result.chars, '', 0, { start: 1, end: 1, type: 'deleteContentBackward' })
  assert.equal(humanCount(cleared.chars), 0)
  assert.equal(speechValue(cleared.chars), '')
  assert.equal(humanCount(editSpeech([], '99..', 4).chars), 4)
})

test('deleting noise frees capacity for new noise even near the automatic character limit', () => {
  const value = 'a' + '.9.'.repeat(25)
  const full = restoreSpeech(value, Array.from({ length: 75 }, (_, i) => i + 1))
  const deleted = editSpeech(full, value.slice(0, -1), value.length - 1, { start: value.length, end: value.length, type: 'deleteContentBackward' })
  assert.equal(automaticIndices(deleted.chars).length, 74)
  const shortened = speechValue(deleted.chars)
  const typed = editSpeech(deleted.chars, shortened + 'b', shortened.length + 1, { start: shortened.length, end: shortened.length, type: 'insertText' })
  const resumed = addNoise(typed.chars, shortened.length + 1, () => .99)
  assert.ok(speechValue(resumed.chars).endsWith('b9'))
  assert.equal(humanCount(resumed.chars), 2)
  assert.equal(automaticIndices(resumed.chars).length, 75)
  assert.ok(validSpeech(speechValue(resumed.chars), automaticIndices(resumed.chars)))
})
test('speech belongs to its creator, persists and is removed when its pigeon is replaced', () => {
  const store = openStore(':memory:')
  const asset = { positions: [], uv: [], indices: [], photoWeights: [], image: '' } as FaceAsset
  try {
    store.add('first', asset, 'a'.repeat(64))
    assert.equal(store.say('first', 'b'.repeat(64), 'not mine'), false)
    assert.equal(store.say('first', '', 'not mine'), false)
    assert.equal(store.say('first', 'a'.repeat(64), '안녕.9999.Hello'), true)
    assert.equal(store.snapshot().birds[0].message, '안녕.9999.Hello')
    const message = addNoise(editSpeech([], 'a'.repeat(50), 50).chars, 50, () => .5).chars
    assert.equal(store.say('first', 'a'.repeat(64), speechValue(message), automaticIndices(message)), true)
    const saved = store.snapshot().birds[0]
    assert.equal(humanCount(restoreSpeech(saved.message, saved.automatic)), 50)
    assert.ok(!JSON.stringify(store.snapshot()).includes('owner_hash'))
    for (let i = 0; i < 40; i++) store.add(`new-${i}`, asset)
    assert.equal(store.say('first', 'a'.repeat(64), 'gone'), false)
    assert.equal(store.snapshot().birds.length, 40)
  } finally { store.close() }
})
test('existing database gains speech columns without deleting previous pigeons', () => {
  const root = resolve(tmpdir()), directory = mkdtempSync(resolve(root, 'pigeon-speech-'))
  const file = resolve(directory, 'legacy.sqlite')
  const db = new DatabaseSync(file)
  db.exec(`CREATE TABLE pigeons (id TEXT PRIMARY KEY, sequence INTEGER NOT NULL, created_at INTEGER NOT NULL, replaces TEXT, asset TEXT NOT NULL);
    INSERT INTO pigeons VALUES ('legacy', 1, 123, NULL, '{}')`)
  db.close()
  const store = openStore(file)
  try {
    assert.equal(store.snapshot().birds[0].id, 'legacy')
    assert.equal(store.snapshot().birds[0].message, '')
    assert.equal(store.say('legacy', 'a'.repeat(64), 'claim'), false)
  } finally {
    store.close(); assert.ok(directory.startsWith(root + sep)); rmSync(directory, { recursive: true, force: true })
  }
})
