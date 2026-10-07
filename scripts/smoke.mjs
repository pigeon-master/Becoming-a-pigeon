import { chromium } from '@playwright/test'
import { readFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import assert from 'node:assert/strict'
import { createApp } from '../server/index.ts'

// An isolated production test server; never starts Vite or touches the real database.
const artifacts = resolve('artifacts'); await mkdir(artifacts, { recursive: true })
const temporary = await mkdtemp(resolve(artifacts, 'smoke-db-'))
const server = createApp(resolve(temporary, 'pigeons.sqlite'))
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`
const serverMode = process.argv.includes('--server')
const portrait = process.argv[2] ? `data:image/jpeg;base64,${(await readFile(process.argv[2])).toString('base64')}` : null
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })
const page = await context.newPage()
const errors = []
let apiRequests = 0
if (!serverMode) await page.context().route('**/api/**', route => { apiRequests++; return route.abort() })
const savedSnapshot = async () => serverMode ? (await (await fetch(`${base}/api/pigeons`)).json()) : page.evaluate(() => new Promise((resolve, reject) => {
  const open = indexedDB.open('pigeon-local-v1', 1)
  open.onerror = () => reject(open.error)
  open.onsuccess = () => {
    const request = open.result.transaction('birds').objectStore('birds').getAll()
    request.onsuccess = () => { resolve({ birds: request.result.sort((a, b) => a.sequence - b.sequence) }); open.result.close() }
    request.onerror = () => reject(request.error)
  }
}))
page.on('pageerror', error => errors.push(error.message))
page.on('console', message => { if (message.type() === 'error' && message.text().includes('THREE.WebGLProgram')) errors.push(message.text()) })
await page.emulateMedia({ reducedMotion: 'reduce' })
await page.addInitScript(({ portrait }) => {
  window.cameraMode = 'blank'; window.cameraTracks = []
  Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: async () => {
    if (window.cameraMode === 'denied') throw new DOMException('Denied', 'NotAllowedError')
    const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ddd'; ctx.fillRect(0, 0, 640, 480)
    if (window.cameraMode === 'portrait' && portrait) {
      const image = new Image(); image.src = portrait; await image.decode()
      const scale = Math.min(640 / image.width, 480 / image.height)
      ctx.drawImage(image, (640 - image.width * scale) / 2, (480 - image.height * scale) / 2, image.width * scale, image.height * scale)
    }
    const stream = canvas.captureStream(10)
    window.cameraTracks.push(...stream.getTracks())
    return stream
  } })
}, { portrait })
try {
  await page.goto(base)
  await page.locator('#world canvas').waitFor()
  assert.equal(await page.locator('#world').getAttribute('data-pigeon-count'), '0')
  assert.equal((await page.locator('body').innerText()).trim(), 'Become a Pigeon')
  assert.equal(await page.locator('button:visible').count(), 1)
  const canvas = await page.locator('#world canvas').boundingBox()
  assert.deepEqual(canvas, { x: 0, y: 0, width: 1440, height: 900 })
  await mkdir('artifacts', { recursive: true })
  await page.screenshot({ path: 'artifacts/desktop.png' })
  await page.locator('#join').click()
  await page.locator('#snap:not([disabled])').waitFor()
  await page.locator('#snap').click()
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('얼굴을 찾지 못했어요'), undefined, { timeout: 60000 })
  assert.equal(await page.locator('#world').getAttribute('data-pigeon-count'), '0')
  assert.equal(await page.evaluate(() => window.cameraTracks.every(t => t.readyState === 'ended')), true)
  if (portrait) {
    await page.evaluate(() => { window.cameraMode = 'portrait' })
    await page.locator('#retry').click()
    await page.locator('#snap:not([disabled])').waitFor()
    await page.locator('#snap').click()
    await page.waitForFunction(() => document.getElementById('world').dataset.pigeonCount === '1', undefined, { timeout: 60000 })
    await page.locator('#capture-dialog').waitFor({ state: 'hidden' })
    assert.equal(await page.evaluate(() => window.cameraTracks.every(t => t.readyState === 'ended')), true)
    await page.screenshot({ path: 'artifacts/personalized.png' })
    await page.mouse.move(720, 450)
    await page.mouse.down()
    await page.mouse.move(945, 450, { steps: 20 })
    await page.mouse.up()
    await page.screenshot({ path: 'artifacts/personalized-side.png' })
    const savedIds = [(await savedSnapshot()).birds[0].id]
    // A separate browser context has no cookies, local storage or camera state.
    const visitor = await browser.newContext({ reducedMotion: 'reduce' })
    if (!serverMode) {
      const isolated = await visitor.newPage()
      await isolated.goto(base); await isolated.locator('#world canvas').waitFor()
      assert.equal(await isolated.locator('#world').getAttribute('data-pigeon-count'), '0')
      await isolated.close()
    }
    const visitorPage = await (serverMode ? visitor : page.context()).newPage()
    await visitorPage.goto(base)
    await visitorPage.waitForFunction(() => document.getElementById('world').dataset.pigeonCount === '1')
    assert.equal(await visitorPage.locator('#world').getAttribute('data-pigeon-ids'), savedIds[0])
    if (serverMode) assert.equal(await visitorPage.locator('#speak').isVisible(), false)
    await page.locator('#speak').waitFor()
    await page.locator('#speak').click()
    await page.locator('#speech-input').fill('Hello there 안녕하세요')
    let speechValue = await page.locator('#speech-input').inputValue()
    assert.ok(speechValue.includes('9') && speechValue.includes('.'))
    assert.ok(!/9{5}/.test(speechValue))
    assert.ok(speechValue.startsWith('Hello there 안녕하세요'))
    await page.waitForTimeout(2200)
    assert.equal(await page.locator('#speech-input').inputValue(), speechValue)
    // Deleting part of a generated group must re-arm the next typed character,
    // even when random sampling would otherwise suppress further interruptions.
    await page.evaluate(() => { window.originalRandom = Math.random; Math.random = () => .99 })
    await page.locator('#speech-input').fill('')
    await page.locator('#speech-input').pressSequentially('A')
    for (let i = 0; i < 3; i++) {
      const previous = await page.locator('#speech-input').inputValue()
      await page.locator('#speech-input').evaluate(input => {
        const index = input.value.lastIndexOf('9'); input.setSelectionRange(index, index + 1)
      })
      await page.locator('#speech-input').press('Backspace')
      const deleted = await page.locator('#speech-input').inputValue()
      assert.equal(deleted.length, previous.length - 1)
      await page.locator('#speech-input').press('End')
      await page.locator('#speech-input').pressSequentially('B')
      assert.equal(await page.locator('#speech-input').inputValue(), deleted + 'B..9999..')
      assert.equal(await page.locator('#speech-count').innerText(), `${i + 2} / 50`)
    }
    await page.evaluate(() => { Math.random = window.originalRandom; delete window.originalRandom })
    // Use Chromium's native IME path, not just synthetic DOM events.
    await page.locator('#speech-input').fill('')
    const ime = await page.context().newCDPSession(page)
    for (const [intermediate, final] of [['ㅎ', '한'], ['ㄱ', '글'], ['ㅇ', '이']]) {
      await ime.send('Input.imeSetComposition', { text: intermediate, selectionStart: 1, selectionEnd: 1 })
      await ime.send('Input.imeSetComposition', { text: final, selectionStart: 1, selectionEnd: 1 })
      await ime.send('Input.insertText', { text: final })
    }
    await page.waitForFunction(() => document.getElementById('speech-count').textContent === '3 / 50')
    assert.equal((await page.locator('#speech-input').inputValue()).replace(/[9.]/g, ''), '한글이')
    // One Enter must confirm the live native Hangul composition and submit it.
    await ime.send('Input.imeSetComposition', { text: '한', selectionStart: 1, selectionEnd: 1 })
    await page.locator('#speech-input').press('Enter')
    await page.waitForFunction(() => document.getElementById('speech-panel').hidden)
    assert.equal((await page.locator('#speech-input').inputValue()).replace(/[9.]/g, ''), '한글이한')
    assert.equal(await page.locator('#speech-count').innerText(), '4 / 50')
    await page.locator('#speak').click()
    await page.evaluate(() => { window.originalRandom = Math.random; Math.random = () => .5 })
    await page.locator('#speech-input').fill('')
    await page.locator('#speech-input').pressSequentially('a'.repeat(50))
    const englishNoise = ((await page.locator('#speech-input').inputValue()).match(/9+/g) ?? []).length
    await page.locator('#speech-input').press('Enter')
    await page.waitForFunction(() => document.getElementById('speech-panel').hidden)
    await page.locator('#speak').click()
    await page.locator('#speech-input').fill('')
    for (let i = 0; i < 50; i++) {
      await ime.send('Input.imeSetComposition', { text: 'ㄱ', selectionStart: 1, selectionEnd: 1 })
      await ime.send('Input.imeSetComposition', { text: '가', selectionStart: 1, selectionEnd: 1 })
      await ime.send('Input.insertText', { text: '가' })
    }
    await page.waitForFunction(() => document.getElementById('speech-count').textContent === '50 / 50')
    const koreanValue = await page.locator('#speech-input').inputValue()
    const koreanNoise = (koreanValue.match(/9+/g) ?? []).length
    assert.equal(koreanValue.replace(/[9.]/g, ''), '가'.repeat(50))
    assert.ok(Math.abs(englishNoise - koreanNoise) <= 1, `noise frequency differs: English ${englishNoise}, Hangul ${koreanNoise}`)
    assert.ok(englishNoise >= 5 && englishNoise <= 7)
    await page.evaluate(() => { Math.random = window.originalRandom; delete window.originalRandom })
    console.log('PASS: single Enter commits active Hangul and closes input; similar Latin/Hangul noise cadence.', { englishNoise, koreanNoise })
    await page.locator('#speech-input').fill('')
    await ime.send('Input.imeSetComposition', { text: '나나', selectionStart: 2, selectionEnd: 2 })
    await page.keyboard.down('Enter')
    assert.equal(await page.locator('#speech-input').evaluate(input => document.activeElement === input), true)
    await page.keyboard.up('Enter')
    await page.waitForFunction(() => document.getElementById('speech-panel').hidden)
    assert.equal((await page.locator('#speech-input').inputValue()).replace(/[9.]/g, ''), '나나')
    assert.equal(await page.locator('#speech-count').innerText(), '2 / 50')
    await page.locator('#speak').click()
    await ime.detach()
    // Reproduce compositionend immediately followed by a new composition in one task.
    await page.locator('#speech-input').fill('')
    await page.locator('#speech-input').evaluate(input => {
      const compose = text => {
        input.value = text; input.setSelectionRange(text.length, text.length)
        input.dispatchEvent(new InputEvent('input', { inputType: 'insertCompositionText', isComposing: true, bubbles: true }))
      }
      input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
      compose('한')
      input.dispatchEvent(new CompositionEvent('compositionend', { data: '한', bubbles: true }))
      input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
      compose('한ㄱ')
    })
    await page.waitForTimeout(100)
    assert.equal(await page.locator('#speech-input').inputValue(), '한ㄱ')
    await page.locator('#speech-input').evaluate(input => {
      input.value = '한글'; input.setSelectionRange(2, 2)
      input.dispatchEvent(new InputEvent('input', { inputType: 'insertCompositionText', isComposing: true, bubbles: true }))
      input.dispatchEvent(new CompositionEvent('compositionend', { data: '글', bubbles: true }))
    })
    await page.waitForFunction(() => document.getElementById('speech-count').textContent === '2 / 50')
    assert.equal((await page.locator('#speech-input').inputValue()).replace(/[9.]/g, ''), '한글')
    // A Hangul IME composition must remain untouched until compositionend.
    await page.locator('#speech-input').evaluate(input => {
      input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
      input.value = '한글 조합'
      input.dispatchEvent(new InputEvent('input', { inputType: 'insertCompositionText', data: '합', isComposing: true, bubbles: true }))
    })
    await page.waitForTimeout(150)
    assert.equal(await page.locator('#speech-input').inputValue(), '한글 조합')
    await page.locator('#speech-input').evaluate(input => input.dispatchEvent(new CompositionEvent('compositionend', { data: '합', bubbles: true })))
    await page.waitForFunction(() => document.getElementById('speech-input').value.includes('9'))
    await page.locator('#speech-input').fill('가 '.repeat(50))
    speechValue = await page.locator('#speech-input').inputValue()
    assert.ok(Array.from(speechValue).length > 50 && !/9{5}/.test(speechValue))
    assert.equal(await page.locator('#speech-count').innerText(), '50 / 50')
    await page.locator('#speech-input').press('Enter')
    await page.waitForFunction(() => document.getElementById('speech-panel').hidden)
    await page.locator('#speak').click()
    assert.equal(await page.locator('#speech-count').innerText(), '50 / 50')
    await page.locator('#speech-input').fill('ABCZ')
    assert.equal(await page.locator('#speech-count').innerText(), '4 / 50')
    await page.locator('#speech-input').press('End')
    await page.locator('#speech-input').press('Backspace')
    assert.equal(await page.locator('#speech-count').innerText(), '4 / 50')
    await page.locator('#speech-input').evaluate(input => { const end = input.value.indexOf('Z') + 1; input.setSelectionRange(end, end) })
    await page.locator('#speech-input').press('Backspace')
    assert.equal(await page.locator('#speech-count').innerText(), '3 / 50')
    const afterDelete = await page.locator('#speech-input').inputValue()
    await page.waitForTimeout(250)
    assert.equal(await page.locator('#speech-input').inputValue(), afterDelete)
    await page.locator('#speech-input').press('ControlOrMeta+a')
    await page.locator('#speech-input').press('Backspace')
    assert.equal(await page.locator('#speech-input').inputValue(), '')
    assert.equal(await page.locator('#speech-count').innerText(), '0 / 50')
    const panelStyle = await page.locator('#speech-panel').evaluate(panel => ({ outline: getComputedStyle(panel).outlineStyle, border: getComputedStyle(panel).borderTopWidth }))
    assert.deepEqual(panelStyle, { outline: 'none', border: '0px' })
    await page.locator('#speech-input').fill('오늘도 도시에 있어요. Hello pigeon!')
    await page.locator('#speech-input').press('Enter')
    speechValue = await page.locator('#speech-input').inputValue()
    await page.waitForFunction(text => document.querySelector('.speech-bubble')?.textContent === text, speechValue)
    await visitorPage.waitForFunction(text => document.querySelector('.speech-bubble')?.textContent === text, speechValue, { timeout: 15000 })
    const bubble = page.locator(`.speech-bubble[data-pigeon-id="${savedIds[0]}"]`)
    const beforeOrbit = await bubble.boundingBox()
    await page.mouse.move(720, 450); await page.mouse.down(); await page.mouse.move(790, 420, { steps: 10 }); await page.mouse.up()
    await page.waitForFunction(before => {
      const rect = document.querySelector('.speech-bubble')?.getBoundingClientRect()
      return before && rect && (Math.abs(before.x - rect.x) > 1 || Math.abs(before.y - rect.y) > 1)
    }, beforeOrbit)
    const afterOrbit = await bubble.boundingBox()
    assert.ok(beforeOrbit && afterOrbit && (Math.abs(beforeOrbit.x - afterOrbit.x) > 1 || Math.abs(beforeOrbit.y - afterOrbit.y) > 1))
    await page.screenshot({ path: 'artifacts/speech.png' })
    // Other visitors cannot overwrite the owner's words using the public pigeon id.
    if (serverMode) {
      const denied = await fetch(`${base}/api/pigeons/${savedIds[0]}/message`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${'f'.repeat(64)}` }, body: JSON.stringify({ message: 'wrong owner' }) })
      assert.equal(denied.status, 403)
    }
    console.log('PASS: IME, 50-character limit, random 9/dot interruptions, tracked bubble, cross-visitor speech and owner authorization.')
    if (process.argv.includes('--capacity')) {
      for (let total = 2; total <= 42; total++) {
        await page.locator('#join').click()
        await page.locator('#snap:not([disabled])').waitFor()
        await page.locator('#snap').click()
        await page.locator('#capture-dialog').waitFor({ state: 'hidden', timeout: 60000 })
        assert.equal(await page.locator('#world').getAttribute('data-pigeon-count'), String(Math.min(total, 40)))
        const saved = await savedSnapshot()
        savedIds.push(saved.birds.at(-1).id)
        assert.deepEqual(saved.birds.map(b => b.id), savedIds.slice(-40))
      }
      await visitorPage.waitForFunction(() => document.getElementById('world').dataset.pigeonCount === '40', undefined, { timeout: 60000 })
      const latest = savedIds.slice(-40)
      await visitorPage.waitForFunction(ids => document.getElementById('world').dataset.pigeonIds === ids.join(','), latest, { timeout: 60000 })
      console.log('PASS: 42 captures persisted; FIFO and another tab both retain the latest 40.')
    }
    await visitorPage.close(); await visitor.close()
  }
  await page.evaluate(() => { window.cameraMode = 'denied' })
  await page.locator('#join').click()
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('권한'))
  await page.locator('#close').click()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: 'artifacts/mobile.png' })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight), false)
  await page.reload()
  await page.locator('#world canvas').waitFor()
  const expected = portrait ? (process.argv.includes('--capacity') ? '40' : '1') : '0'
  await page.waitForFunction(count => document.getElementById('world').dataset.pigeonCount === count, expected, { timeout: 60000 })
  if (portrait) await page.locator('#speak').waitFor()
  if (portrait && !process.argv.includes('--capacity')) {
    await page.locator('#speak').click()
    assert.equal(await page.locator('#speech-count').innerText(), `${Array.from('오늘도 도시에 있어요. Hello pigeon!').length} / 50`)
    await page.locator('#speech-close').click()
  }
  if (portrait) {
    await page.locator('#remove-pigeon').waitFor()
    assert.equal(await page.locator('#world-error').isVisible(), false)
    const typography = await page.locator('#remove-pigeon').evaluate(async button => {
      await document.fonts.load('300 14px "Ubuntu Light"')
      const style = getComputedStyle(button)
      return { font: style.fontFamily, weight: style.fontWeight, border: style.borderTopWidth, stretch: getComputedStyle(button.firstElementChild).transform, loaded: document.fonts.check('300 14px "Ubuntu Light"') }
    })
    assert.ok(typography.font.includes('Ubuntu Light') && typography.loaded)
    assert.equal(typography.weight, '300'); assert.equal(typography.border, '0px')
    assert.equal(typography.stretch, 'matrix(1.1, 0, 0, 1, 0, 0)')
    if (!process.argv.includes('--capacity')) {
      // Keep an older pigeon to prove deletion targets only the most recent capture.
      await page.evaluate(() => { window.cameraMode = 'portrait' })
      await page.locator('#join').click()
      await page.locator('#snap:not([disabled])').waitFor()
      await page.locator('#snap').click()
      await page.locator('#capture-dialog').waitFor({ state: 'hidden', timeout: 60000 })
      assert.equal(await page.locator('#world').getAttribute('data-pigeon-count'), '2')
    }
    const before = (await savedSnapshot()).birds.map(b => b.id)
    if (process.argv.includes('--poodle')) {
      await page.setViewportSize({ width: 1440, height: 900 })
      const preserved = await savedSnapshot()
      await page.evaluate(() => {
        window.poodleStartles = []; window.poodleReturns = []
        document.getElementById('world').addEventListener('pigeonstartled', event => window.poodleStartles.push(event.detail))
        document.getElementById('world').addEventListener('pigeonreturning', event => window.poodleReturns.push(event.detail))
      })
      await page.locator('#poodle').click()
      await page.waitForFunction(() => document.getElementById('world').dataset.poodlePhase === 'running')
      assert.equal(await page.locator('#poodle').isDisabled(), true)
      assert.equal(await page.locator('#remove-pigeon').isDisabled(), true)
      // A newly started visit must not launch the flock while the dog is still offscreen.
      assert.equal(await page.evaluate(() => window.poodleStartles.length), 0)
      await page.waitForTimeout(1600)
      await page.screenshot({ path: 'artifacts/poodle-running.png' })
      await page.waitForFunction(() => document.getElementById('world').dataset.poodlePhase === 'waiting', undefined, { timeout: 30000 })
      assert.equal(await page.locator('#world').getAttribute('data-poodle-visible-birds'), '0')
      const departed = await page.evaluate(() => performance.now())
      const startles = await page.evaluate(() => window.poodleStartles)
      assert.ok(startles.some(entry => entry.upward) && startles.some(entry => !entry.upward), 'Flock mixes upward and sideways escapes')
      assert.equal(startles.length, before.length)
      assert.ok(startles.some(event => event.source === 'dog'))
      for (const event of startles) {
        assert.ok(event.distance < (event.source === 'dog' ? 5.94 : 5.2))
        assert.equal(event.dogVisible, true)
      }
      await page.screenshot({ path: 'artifacts/poodle-empty.png' })
      await page.waitForFunction(() => Number(document.getElementById('world').dataset.poodleVisibleBirds) > 0, undefined, { timeout: 15000 })
      assert.ok(await page.evaluate(start => performance.now() - start >= 3900, departed))
      await page.waitForFunction(() => document.getElementById('world').dataset.poodlePhase === 'returning' && !document.getElementById('join').disabled)
      const earlyUnlock = await page.evaluate(() => ({ phase: document.getElementById('world').dataset.poodlePhase, disabled: document.getElementById('join').disabled }))
      assert.equal(earlyUnlock.phase, 'returning'); assert.equal(earlyUnlock.disabled, false)
      await page.screenshot({ path: 'artifacts/poodle-returning.png' })
      assert.equal(await page.locator('#join').isDisabled(), false)
      assert.equal(await page.locator('#remove-pigeon').isDisabled(), false)
      assert.equal(await page.locator('#speak').isDisabled(), false)
      await page.locator('#remove-pigeon').click()
      await page.locator('#remove-close').click()
      await page.waitForFunction(() => document.getElementById('world').dataset.poodlePhase === 'idle', undefined, { timeout: 45000 })
      const returns = await page.evaluate(() => window.poodleReturns)
      assert.equal(returns.length, before.length)
      assert.ok(returns.some(event => event.mode === 'walk') && returns.some(event => event.mode === 'fly'))
      assert.equal(await page.locator('#poodle').isDisabled(), false)
      assert.equal(await page.locator('#world').getAttribute('data-pigeon-count'), String(before.length))
      assert.deepEqual(await savedSnapshot(), preserved)
      await page.screenshot({ path: 'artifacts/poodle-restored.png' })
      console.log('PASS: proximity-triggered takeoffs, four-second delay, mixed walking/flying returns, early button unlock and preserved data.', { startles, returns })
    }
    if (!serverMode) {
      // Simulate the previous release, which remembered only the latest owner.
      await page.evaluate(id => {
        const prefix = 'pigeon-owner-local-v1:'
        const latest = localStorage.getItem(prefix + id)
        for (const key of Object.keys(localStorage)) if (key.startsWith(prefix)) localStorage.removeItem(key)
        localStorage.setItem('pigeon-owner-local-v1', latest)
      }, before.at(-1))
    }
    await page.reload()
    await page.waitForFunction(count => document.getElementById('world').dataset.pigeonCount === String(count), before.length)
    await page.locator('#remove-pigeon').waitFor()
    await page.locator('#remove-pigeon').click()
    assert.equal(await page.locator('#remove-message').innerText(), 'Your pigeon will be permanently deleted.')
    await page.screenshot({ path: 'artifacts/remove-confirmation.png' })
    await page.keyboard.press('Escape')
    assert.deepEqual((await savedSnapshot()).birds.map(b => b.id), before)
    // Normal animation even though ambient movement was paused on initial load.
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.locator('#remove-pigeon').click()
    await page.locator('#remove-ok').click()
    await page.waitForFunction(id => document.getElementById('world').dataset.removingPigeon === id, before.at(-1))
    await page.waitForFunction(() => document.getElementById('world').dataset.removalPhase === 'waiting')
    const focusedAt = await page.evaluate(() => performance.now())
    await page.waitForFunction(() => document.getElementById('world').dataset.removalPhase === 'sinking')
    assert.ok(await page.evaluate(start => performance.now() - start >= 850, focusedAt))
    await page.waitForTimeout(400)
    await page.screenshot({ path: 'artifacts/black-hole.png' })
    await page.waitForFunction(() => document.getElementById('world').dataset.removalPhase === 'restoring')
    await page.waitForFunction(count => document.getElementById('world').dataset.pigeonCount === String(count) && !document.getElementById('world').dataset.removingPigeon, before.length - 1)
    await page.locator('#remove-pigeon:not([disabled])').waitFor()
    assert.equal(await page.locator('#remove-pigeon').isVisible(), true)
    assert.deepEqual((await savedSnapshot()).birds.map(b => b.id), before.slice(0, -1))
    await page.reload()
    await page.waitForFunction(count => document.getElementById('world').dataset.pigeonCount === String(count), before.length - 1)
    await page.locator('#remove-pigeon').waitFor()
    assert.equal(await page.locator('#speak').isVisible(), true)
    if (!process.argv.includes('--capacity')) {
      await page.locator('#speak').click()
      assert.equal(await page.locator('#speech-count').innerText(), `${Array.from('오늘도 도시에 있어요. Hello pigeon!').length} / 50`)
      await page.locator('#speech-close').click()
    }
    await page.emulateMedia({ reducedMotion: 'reduce' })
    for (let remaining = before.length - 1; remaining > 0; remaining--) {
      await page.locator('#remove-pigeon:not([disabled])').click()
      await page.locator('#remove-ok').click()
      await page.waitForFunction(count => document.getElementById('world').dataset.pigeonCount === String(count) && !document.getElementById('world').dataset.removingPigeon, remaining - 1)
      assert.deepEqual((await savedSnapshot()).birds.map(b => b.id), before.slice(0, remaining - 1))
      if (remaining > 1) assert.equal(await page.locator('#remove-pigeon').isVisible(), true)
    }
    await page.locator('#remove-pigeon').waitFor({ state: 'hidden' })
    assert.equal(await page.locator('#speak').isVisible(), false)
    await page.reload()
    await page.locator('#world canvas').waitFor()
    assert.deepEqual((await savedSnapshot()).birds, [])
    assert.equal(await page.locator('#remove-pigeon').isVisible(), false)
    assert.equal(await page.locator('#world-error').isVisible(), false)
    console.log('PASS: ownership migration, reload, newest-first repeated deletion, restored older speech and button hidden only after all owned pigeons are removed.')
  }
  assert.deepEqual(errors, [])
  if (!serverMode) assert.equal(apiRequests, 0)
  console.log(`PASS: fullscreen, camera, speech, mobile, ${serverMode ? 'server' : 'IndexedDB'} persistence and reload.${serverMode ? '' : ' Zero API requests; separate browsers stay independent.'}`)
} finally {
  await browser.close()
  await new Promise(resolve => server.close(resolve))
  if (!temporary.startsWith(artifacts + sep)) throw new Error('Unexpected test directory')
  await rm(temporary, { recursive: true, force: true })
}
