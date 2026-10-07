import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { validSpeech } from '../src/speech-text.ts'
import type { FaceAsset, FlockSnapshot, PigeonRecord } from '../src/pigeon-data.ts'

export function validAsset(value: unknown): value is FaceAsset {
  if (!value || typeof value !== 'object') return false
  const a = value as FaceAsset
  const numbers = (v: unknown, max: number, limit: number) => Array.isArray(v) && v.length <= max && v.every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= limit)
  if (!numbers(a.positions, 6000, 5) || a.positions.length < 9 || a.positions.length % 3) return false
  const count = a.positions.length / 3
  if (!numbers(a.uv, 4000, 1) || a.uv.length !== count * 2 || a.uv.some(n => n < 0)) return false
  if (!numbers(a.photoWeights, 2000, 1) || a.photoWeights.length !== count || a.photoWeights.some(n => n < 0)) return false
  if (!numbers(a.indices, 12000, count - 1) || !a.indices.length || a.indices.length % 3 || a.indices.some(n => n < 0 || !Number.isInteger(n))) return false
  if (typeof a.image !== 'string' || a.image.length > 700000 || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(a.image)) return false
  const image = Buffer.from(a.image.split(',')[1], 'base64')
  return image.length > 4 && image[0] === 255 && image[1] === 216 && image[2] === 255
}

export function openStore(filename = process.env.PIGEON_DB_PATH ?? resolve('data/pigeons.sqlite')) {
  if (filename !== ':memory:') mkdirSync(dirname(resolve(filename)), { recursive: true })
  const db = new DatabaseSync(filename)
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS requests (sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE);
    CREATE TABLE IF NOT EXISTS pigeons (id TEXT PRIMARY KEY, sequence INTEGER NOT NULL, created_at INTEGER NOT NULL, replaces TEXT, asset TEXT NOT NULL);`)
  const columns = db.prepare('PRAGMA table_info(pigeons)').all() as { name: string }[]
  if (!columns.some(c => c.name === 'message')) db.exec("ALTER TABLE pigeons ADD COLUMN message TEXT NOT NULL DEFAULT ''")
  if (!columns.some(c => c.name === 'owner_hash')) db.exec("ALTER TABLE pigeons ADD COLUMN owner_hash TEXT NOT NULL DEFAULT ''")
  if (!columns.some(c => c.name === 'automatic')) db.exec("ALTER TABLE pigeons ADD COLUMN automatic TEXT NOT NULL DEFAULT '[]'")
  const hash = (token: string) => createHash('sha256').update(token).digest('hex')
  const snapshot = (): FlockSnapshot => ({
    revision: Number((db.prepare('SELECT COALESCE(MAX(sequence), 0) AS n FROM requests').get() as { n: number }).n),
    birds: (db.prepare('SELECT id, created_at AS createdAt, replaces, message, automatic FROM pigeons ORDER BY sequence').all() as unknown as (Omit<PigeonRecord, 'automatic'> & { automatic: string })[]).map(bird => ({ ...bird, automatic: JSON.parse(bird.automatic) as number[] })),
  })
  return {
    snapshot,
    remove(id: string, token: string) {
      const result = db.prepare('DELETE FROM pigeons WHERE id = ? AND owner_hash = ?').run(id, hash(token))
      if (result.changes) return true
      // Keep requests as tombstones so a delayed create retry cannot resurrect it.
      return !db.prepare('SELECT id FROM pigeons WHERE id = ?').get(id)
    },
    get(id: string): FaceAsset | null {
      const row = db.prepare('SELECT asset FROM pigeons WHERE id = ?').get(id) as { asset: string } | undefined
      return row ? JSON.parse(row.asset) : null
    },
    add(id: string, asset: FaceAsset, token = '') {
      db.exec('BEGIN IMMEDIATE')
      try {
        // A retry cannot create another pigeon or resurrect an evicted one.
        if (!db.prepare('SELECT id FROM requests WHERE id = ?').get(id)) {
          const flock = snapshot().birds
          const replaces = flock.length >= 40 ? flock[0].id : null
          const sequence = db.prepare('INSERT INTO requests(id) VALUES (?)').run(id).lastInsertRowid
          if (replaces) db.prepare('DELETE FROM pigeons WHERE id = ?').run(replaces)
          db.prepare('INSERT INTO pigeons (id, sequence, created_at, replaces, asset, owner_hash) VALUES (?, ?, ?, ?, ?, ?)').run(id, sequence, Date.now(), replaces, JSON.stringify(asset), token ? hash(token) : '')
        }
        const result = snapshot(); db.exec('COMMIT'); return result
      } catch (error) { db.exec('ROLLBACK'); throw error }
    },
    say(id: string, token: string, message: string, automatic: number[] = []) {
      if (!validSpeech(message, automatic)) return false
      if (!token || !db.prepare('SELECT id FROM pigeons WHERE id = ? AND owner_hash = ?').get(id, hash(token))) return false
      db.prepare('UPDATE pigeons SET message = ?, automatic = ? WHERE id = ?').run(message, JSON.stringify(automatic), id)
      return true
    },
    close() { db.close() },
  }
}
