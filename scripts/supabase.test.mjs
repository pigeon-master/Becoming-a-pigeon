import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'

test('Supabase SQL enforces public reads, owner-only writes, speech validation and 40-bird FIFO', async () => {
  const db = new PGlite()
  const alice = randomUUID(), bob = randomUUID(), a = randomUUID(), b = randomUUID()
  const asset = { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], uv: [0, 0, 1, 0, 0, 1], photoWeights: [1, 1, 1], indices: [0, 1, 2], image: 'data:image/jpeg;base64,/9j/4A==' }
  const identity = async (id, role = 'authenticated') => {
    await db.exec('reset role')
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id ?? ''])
    await db.exec(`set role ${role}`)
  }
  const create = id => db.query('select public.create_pigeon($1::uuid, $2::jsonb)', [id, JSON.stringify(asset)])
  try {
    // Supabase supplies these roles and auth.uid() in production.
    await db.exec(`create role anon; create role authenticated;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to anon, authenticated;`)
    await db.query('insert into auth.users(id) values ($1),($2)', [alice, bob])
    await db.exec(await readFile('supabase/schema.sql', 'utf8'))
    // Applying the setup twice must preserve data and leave the same privileges.
    await identity(alice); await create(a)
    await db.exec('reset role'); await db.exec(await readFile('supabase/schema.sql', 'utf8'))
    await identity(bob); await create(b)
    assert.equal((await db.query('select id from public.pigeons')).rows.length, 2)
    assert.equal((await db.query("update public.pigeons set message = '타인 변경' where id = $1 returning id", [a])).rows.length, 0)
    assert.equal((await db.query('delete from public.pigeons where id = $1 returning id', [a])).rows.length, 0)
    await assert.rejects(create(a), /Not your pigeon/)
    await assert.rejects(db.query('update public.pigeons set owner_id = $1 where id = $2', [bob, a]), /permission denied/)
    await assert.rejects(db.query('insert into public.pigeons(id,owner_id,asset) values ($1,$2,$3)', [randomUUID(), bob, asset]), /permission denied/)
    await db.query("update public.pigeons set message = '안녕..99..Hello', automatic = '{2,3,4,5,6,7}' where id = $1", [b])
    await assert.rejects(db.query('update public.pigeons set message = $1, automatic = $2 where id = $3', ['가'.repeat(51), [], b]), /pigeon_speech_valid/)
    await assert.rejects(db.query('update public.pigeons set message = $1, automatic = $2 where id = $3', ['abc', [0], b]), /pigeon_speech_valid/)
    await identity(null, 'anon')
    assert.equal((await db.query('select message from public.pigeons where id = $1', [b])).rows[0].message, '안녕..99..Hello')
    await assert.rejects(db.query("update public.pigeons set message = ''"), /permission denied/)
    await assert.rejects(create(randomUUID()), /permission denied/)
    await identity(alice)
    for (let i = 0; i < 39; i++) await create(randomUUID())
    assert.equal((await db.query('select count(*)::int as n from public.pigeons')).rows[0].n, 40)
    assert.equal((await db.query('select id from public.pigeons where id = $1', [a])).rows.length, 0)
    await create(a) // Evicted request retry must not resurrect the bird.
    assert.equal((await db.query('select id from public.pigeons where id = $1', [a])).rows.length, 0)
    await identity(bob)
    assert.equal((await db.query('delete from public.pigeons where id = $1 returning id', [b])).rows.length, 1)
    assert.equal((await db.query('select id from public.pigeons where id = $1', [b])).rows.length, 0)
  } finally { await db.close() }
})
