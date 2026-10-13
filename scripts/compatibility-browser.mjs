import { build } from 'vite'
import { chromium, firefox, webkit } from '@playwright/test'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import assert from 'node:assert/strict'

const artifacts = resolve('artifacts')
await mkdir(artifacts, { recursive: true })
const temporary = await mkdtemp(resolve(artifacts, 'compatibility-'))
const source = name => JSON.stringify(resolve(name).replaceAll('\\', '/'))
let browser, server
try {
  await writeFile(resolve(temporary, 'index.html'), '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0"><main id="world" style="position:fixed;inset:0"></main><script type="module" src="/fixture.ts"></script>')
  // Instrument only the isolated fixture; WebGLRenderer.render is an instance method.
  const worldSource = (await readFile(resolve('src/world.ts'), 'utf8'))
    .replace(/from (['"])\.\/([^'"]+)\1/g, (_, quote, name) => 'from ' + source('src/' + name))
    .replace('renderer.setPixelRatio', `const render=renderer.render.bind(renderer);renderer.render=(scene,camera)=>{window.renders++;window.renderer=renderer;window.scene=scene;window.camera=camera;return render(scene,camera)};renderer.setPixelRatio`)
  await writeFile(resolve(temporary, 'world.ts'), worldSource)
  await writeFile(resolve(temporary, 'fixture.ts'), `
    import ${source('src/style.css')};
    import * as THREE from 'three';
    import {createWorld} from './world';
    window.renders=0;
    const world=createWorld(document.getElementById('world'));
    window.addBirds=()=>{for(let i=0;i<8;i++){world.add(new THREE.Mesh(new THREE.SphereGeometry(.25,8,6),new THREE.MeshStandardMaterial({color:0x888888})),{id:String(i),focus:false});world.say(String(i),'Pigeon '+i)}};
    window.hide=hidden=>Object.defineProperty(document,'hidden',{configurable:true,value:hidden});
    window.ready=true;
  `)
  await build({ configFile: false, root: temporary, publicDir: resolve('public'), logLevel: 'error', build: { outDir: resolve(temporary, 'site') } })
  const site = resolve(temporary, 'site')
  server = createServer(async (req, res) => {
    try {
      const path = new URL(req.url, 'http://fixture').pathname
      if (path === '/favicon.ico') { res.writeHead(204); res.end(); return }
      const file = resolve(site, '.' + (path === '/' ? '/index.html' : path))
      assert.ok(file.startsWith(site + sep))
      const types = { js: 'text/javascript', css: 'text/css', png: 'image/png', woff2: 'font/woff2' }
      res.setHeader('Content-Type', types[file.split('.').pop()] ?? 'text/html')
      res.end(await readFile(file))
    } catch { res.writeHead(404); res.end() }
  })
  await new Promise(done => server.listen(0, '127.0.0.1', done))
  const results = []
  for (const [name, engine, options] of [['Chrome', chromium, {}], ['Edge', chromium, { channel: 'msedge' }], ['Firefox', firefox, {}], ['WebKit', webkit, {}]]) {
    browser = await engine.launch({ headless: true, ...(engine === chromium ? { args: ['--enable-unsafe-swiftshader'] } : {}), ...options })
    for (const [device, viewport] of [['desktop', { width: 1440, height: 900 }], ['phone', { width: 390, height: 844 }], ['tablet', { width: 820, height: 1180 }]]) {
      const page = await browser.newPage({ viewport, hasTouch: device !== 'desktop', ...(name !== 'Firefox' ? { isMobile: device !== 'desktop' } : {}) })
      const errors = []
      page.on('pageerror', error => { errors.push(error.message); console.error(name, device, error.message) })
      await page.goto('http://127.0.0.1:' + server.address().port)
      await page.waitForFunction(() => window.ready && window.renders > 0)
      await page.waitForTimeout(500)
      const idle = await page.evaluate(() => window.renders)
      await page.waitForTimeout(300)
      assert.equal(await page.evaluate(() => window.renders), idle, name + ': empty plaza does not redraw continuously')
      await page.setViewportSize({ width: viewport.height, height: viewport.width })
      await page.waitForFunction(count => window.renders > count, idle)
      if (device === 'desktop') {
        const restored = await page.evaluate(async () => {
          const canvas = window.renderer.domElement, gl = window.renderer.getContext(), extension = gl.getExtension('WEBGL_lose_context')
          if (!extension) return 'unavailable'
          await new Promise(done => { canvas.addEventListener('webglcontextlost', done, { once: true }); extension.loseContext() })
          const count = window.renders
          await new Promise(done => { canvas.addEventListener('webglcontextrestored', done, { once: true }); setTimeout(() => extension.restoreContext(), 100) })
          await new Promise(done => setTimeout(done, 300))
          return window.renders > count && !gl.isContextLost()
        })
        assert.notEqual(restored, false, name + ': static plaza redraws after GPU context restoration')
      }
      await page.evaluate(() => window.addBirds())
      await page.waitForFunction(() => document.querySelectorAll('.speech-bubble').length === 8)
      const pose = await page.evaluate(() => window.camera.position.toArray())
      if (device === 'desktop') {
        await page.mouse.move(viewport.height / 2, viewport.width / 2)
        await page.mouse.wheel(0, -1800)
      } else {
        // Exercise the site's two-finger touch controls, including mobile WebKit.
        await page.evaluate(() => {
          const canvas=window.renderer.domElement, rect=canvas.getBoundingClientRect(), x=rect.width/2, y=rect.height/2
          const capture=canvas.setPointerCapture,release=canvas.releasePointerCapture
          canvas.setPointerCapture=canvas.releasePointerCapture=()=>{}
          const send=(type,id,offset)=>canvas.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerId:id,pointerType:'touch',clientX:x+offset,clientY:y,buttons:type==='pointerup'?0:1}))
          try { send('pointerdown',1,-20);send('pointerdown',2,20);for(let distance=25;distance<=150;distance+=5){send('pointermove',1,-distance);send('pointermove',2,distance)}send('pointerup',1,-150);send('pointerup',2,150) }
          finally { canvas.setPointerCapture=capture;canvas.releasePointerCapture=release }
        })
      }
      await page.waitForFunction(before => window.camera.position.toArray().some((value, i) => Math.abs(value - before[i]) > .01), pose)
      await page.waitForFunction(() => document.querySelectorAll('.speech-bubble:not([hidden])').length > 0)
      const canvasSize = await page.evaluate(() => ({ width: window.renderer.domElement.width, height: window.renderer.domElement.height }))
      assert.ok(canvasSize.width > 0 && canvasSize.height > 0)
      await page.evaluate(() => window.hide(true))
      await page.waitForTimeout(100)
      const hiddenCount = await page.evaluate(() => window.renders)
      await page.waitForTimeout(250)
      assert.equal(await page.evaluate(() => window.renders), hiddenCount, name + ': hidden document stops GPU rendering')
      await page.evaluate(() => window.hide(false))
      await page.waitForFunction(count => window.renders > count, hiddenCount)
      assert.deepEqual(errors, [], name + ': no JavaScript errors')
      results.push({ browser: name, device, viewport, status: 'passed' })
      console.log('PASS:', name, device, 'rendering, zoom, bubbles, orientation resize, idle/hidden rendering')
      await page.close()
    }
    await browser.close(); browser = undefined
  }
  await writeFile(resolve(artifacts, 'compatibility-results.json'), JSON.stringify(results, null, 2))
} finally {
  await browser?.close()
  if (server) await new Promise(done => server.close(done))
  assert.ok(temporary.startsWith(artifacts + sep))
  await rm(temporary, { recursive: true, force: true })
}
