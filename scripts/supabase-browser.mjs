import { build } from 'vite'
import { chromium } from '@playwright/test'
import { createServer } from 'node:http'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'

// Real client and speech UI against an isolated simulated Supabase HTTP API.
// Database-side RLS is tested separately by test:supabase. No real account is used.
const root = await mkdtemp(resolve(tmpdir(), 'pigeon-supabase-browser-'))
const source = file => JSON.stringify(resolve('src', file).replaceAll('\\', '/'))
let browser, server
try {
  await writeFile(resolve(root, 'index.html'), '<body><button id="speak" hidden>Wanna Say Something?</button><button id="remove-pigeon" hidden>Remove</button><section id="speech-panel" hidden><input id="speech-input"><output id="speech-count"></output><button id="speech-close">Close</button><p id="speech-error" hidden></p></section><script type="module" src="/fixture.ts"></script>')
  await writeFile(resolve(root, 'fixture.ts'), `
    import * as THREE from 'three';
    import {connectFlock} from ${source('shared-flock.ts')};
    import {createSpeech} from ${source('speech.ts')};
    const visible=new Map(); let speech;
    const world={has:id=>visible.has(id),add:(face,options)=>{visible.set(options.id,'');return true},retain:ids=>{for(const id of visible.keys())if(!ids.has(id))visible.delete(id)},say:(id,text)=>visible.set(id,text),remove:async id=>visible.delete(id)};
    const shared=connectFlock(world,error=>window.error=error,snapshot=>speech?.refresh(snapshot));
    speech=createSpeech(shared);window.words=visible;window.shared=shared;
    window.capture=async()=>{
      const canvas=document.createElement('canvas');canvas.width=canvas.height=2;
      const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,1,0,0,0,1,0],3));g.setAttribute('uv',new THREE.Float32BufferAttribute([0,0,1,0,0,1],2));g.setAttribute('photoWeight',new THREE.Float32BufferAttribute([1,1,1],1));g.setIndex([0,1,2]);
      const face=new THREE.Mesh(g,new THREE.MeshStandardMaterial({map:new THREE.CanvasTexture(canvas)}));
      const owner=await shared.publish(face);speech.setOwner(owner);return owner;
    };
    window.addEventListener('pagehide',()=>shared.close());`)
  await build({ configFile: false, root, publicDir: false, logLevel: 'error', resolve: { alias: [{ find: /^three$/, replacement: resolve('node_modules/three/build/three.module.js') }] }, define: {
    'import.meta.env.VITE_STORAGE_MODE': JSON.stringify('supabase'),
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('https://fixture.supabase.co'),
    'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': JSON.stringify('sb_publishable_fixture'),
  }, build: { outDir: resolve(root, 'site') } })
  const site = resolve(root, 'site')
  server = createServer(async (req, res) => {
    try {
      const path = new URL(req.url, 'http://fixture').pathname
      const file = resolve(site, '.' + (path === '/' ? '/index.html' : path))
      if (!file.startsWith(site + sep)) throw new Error('outside fixture')
      res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : 'text/html')
      res.end(await readFile(file))
    } catch { res.writeHead(404); res.end() }
  })
  await new Promise(done => server.listen(0, '127.0.0.1', done))
  browser = await chromium.launch({ channel: 'msedge', headless: true })
  const rows = new Map(), errors = []
  let sequence = 0, failedSave = false
  async function visitor() {
    const context = await browser.newContext()
    const user = randomUUID()
    const jwt = [Buffer.from('{}').toString('base64url'), Buffer.from(JSON.stringify({ sub: user, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url'), 'fixture'].join('.')
    await context.route('https://fixture.supabase.co/**', async route => {
      const request = route.request(), url = new URL(request.url()), body = request.postDataJSON()
      const authenticated = request.headers().authorization === `Bearer ${jwt}`
      let data, status = 200
      if (url.pathname === '/auth/v1/signup') data = { access_token: jwt, refresh_token: 'fixture', token_type: 'bearer', expires_in: 3600, user: { id: user, aud: 'authenticated', role: 'authenticated', is_anonymous: true, created_at: new Date().toISOString() } }
      else if (url.pathname.endsWith('/rpc/create_pigeon')) {
        if (!authenticated) { status = 403; data = { message: 'Authentication required' } }
        else { rows.set(body.pigeon_id, { id: body.pigeon_id, owner_id: user, asset: body.face_asset, message: '', automatic: [], replaces: null, created_at: new Date().toISOString(), sequence: ++sequence }); data = body.pigeon_id }
      } else {
        const id = url.searchParams.get('id')?.replace(/^eq\./, '')
        const row = rows.get(id)
        if (request.method() === 'PATCH') {
          if (failedSave) { status = 503; data = { message: 'Simulated unavailable database' } }
          else if (row?.owner_id === user && authenticated) { Object.assign(row, body); data = [{ id }] }
          else data = []
        } else if (request.method() === 'DELETE') {
          if (row?.owner_id === user && authenticated) { rows.delete(id); data = [{ id }] } else data = []
        } else if (id) data = row ? { asset: row.asset } : null
        else data = [...rows.values()].map(({ asset, ...metadata }) => metadata)
      }
      await route.fulfill({ status, json: data })
    })
    const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message))
    await page.goto(`http://127.0.0.1:${server.address().port}`)
    await page.waitForFunction(() => !!window.capture)
    return page
  }
  const alice = await visitor(), bob = await visitor()
  const owner = await alice.evaluate(() => window.capture())
  await alice.locator('#speak').click()
  await alice.locator('#speech-input').fill('Hello 한글')
  await alice.waitForTimeout(900)
  assert.equal(rows.get(owner.id).message, '', 'Typing must remain local before submission')
  await alice.locator('#speech-input').press('Enter')
  await alice.locator('#speech-panel').waitFor({ state: 'hidden' })
  await bob.waitForFunction(id => !!window.words.get(id), owner.id)
  assert.match(rows.get(owner.id).message, /Hello|한글/)
  assert.equal(await bob.locator('#speak').isVisible(), false)
  assert.equal(await bob.evaluate(async owner => { try { await window.shared.say(owner, 'hacked'); return false } catch { return true } }, owner), true)
  assert.equal(await bob.evaluate(async owner => { try { await window.shared.remove(owner); return false } catch { return true } }, owner), true)
  const submitted = rows.get(owner.id).message
  await alice.reload(); await alice.locator('#speak').waitFor()
  assert.equal(await alice.evaluate(id => window.words.get(id), owner.id), submitted)
  // Failed submission must keep the editable text and make the error visible.
  failedSave = true
  await alice.locator('#speak').click(); await alice.locator('#speech-input').fill('Retry 한글')
  await alice.locator('#speech-input').press('Enter')
  await alice.locator('#speech-error').waitFor()
  assert.equal(await alice.locator('#speech-panel').isVisible(), true)
  assert.equal(rows.get(owner.id).message, submitted)
  failedSave = false
  await alice.locator('#speech-input').press('Enter')
  await alice.locator('#speech-panel').waitFor({ state: 'hidden' })
  await alice.waitForFunction(() => document.getElementById('speech-error').hidden)
  assert.match(rows.get(owner.id).message, /Retry/)
  assert.deepEqual(errors, [])
  console.log('PASS: anonymous ownership, Enter saves, other visitor reads, unauthorized writes fail, reload and failed-save retry.')
} finally {
  await browser?.close()
  if (server) await new Promise(done => server.close(done))
  if (!root.startsWith(resolve(tmpdir(), 'pigeon-supabase-browser-'))) throw new Error('Unexpected temporary directory')
  await rm(root, { recursive: true, force: true })
}
