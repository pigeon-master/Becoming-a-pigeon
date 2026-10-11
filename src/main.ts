import './style.css'
import { createWorld } from './world'
import { connectFlock } from './shared-flock'
import { createSpeech } from './speech'
import { SUPABASE_STORAGE } from './storage-mode'
import { createFace } from './face'

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
<p id="copyright"><span class="wide-text">ⓒ2026. CRAPPYROOM. All rights reserved.</span></p>
<main id="world" aria-label="비둘기 광장"></main><div id="action-bar" data-participation="loading"><button id="join">Become a Pigeon</button><button id="speak" aria-controls="speech-panel" aria-expanded="false" hidden>Wanna Say Something?</button></div><p id="world-error" role="alert" hidden></p>
<section id="speech-panel" aria-label="비둘기 말풍선 입력" hidden><div class="speech-input-row"><input id="speech-input" type="text" aria-label="말풍선 내용, 직접 입력한 문자와 공백 50자. 자동 문자는 제외" placeholder="Say something…" autocomplete="off" spellcheck="false"><output id="speech-count" for="speech-input">0 / 50</output><button id="speech-close" aria-label="말풍선 저장하고 입력 닫기"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20V4m-7 7 7-7 7 7"/></svg></button></div><p id="speech-error" role="status" hidden></p></section>
<button id="remove-pigeon" class="text-button" hidden><span class="wide-text">Remove Your Pigeon</span></button>
<button id="poodle" aria-label="치와와 뛰어놀기"><svg viewBox="0 0 88 64" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path fill="currentColor" d="M28 30C25 22 40 20 51 21C66 19 77 25 74 33C77 40 60 44 48 41C34 44 25 38 28 29"/><path fill="currentColor" d="M29 29C33 24 30 18 26 17L27 10L21 15Q15 14 13 21L7 23L9 28Q12 31 18 30Q22 34 28 31"/><path d="M73 30Q81 27 79 19M17 22 18 22M7 25l4 1M35 40 33 55M44 42 44 56M59 42 57 56M69 39 70 54"/></svg></button>
<dialog id="remove-dialog" aria-labelledby="remove-message"><p id="remove-message"><span class="wide-text">Your pigeon will be permanently deleted.</span></p><p id="remove-error" role="alert" hidden></p><div class="remove-actions"><button id="remove-close" autofocus><span class="wide-text">Cancel</span></button><button id="remove-ok"><span class="wide-text">Ok</span></button></div></dialog>
<dialog id="capture-dialog" aria-label="얼굴 촬영"><button id="close" class="icon close" aria-label="닫기"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button><div class="camera-frame"><video id="video" autoplay playsinline muted></video><canvas id="photo" hidden></canvas><div id="face-guide"></div><div id="loading" class="spinner" role="status" aria-label="처리 중" hidden></div></div><p id="status" role="alert" hidden></p><div class="actions"><button id="retry" class="icon" aria-label="카메라 다시 켜기" hidden><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 8a8 8 0 1 0 1 7M19 3v5h-5"/></svg></button><button id="snap" aria-label="촬영하고 비둘기 되기" disabled><span></span></button></div></dialog>`
const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
el('poodle').insertAdjacentHTML('afterend', `<button id="human" aria-label="인간의 포즈로 비둘기 날려 보내기"><svg viewBox="0 0 169 309" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="7.1" stroke-linecap="round" stroke-linejoin="round"><path d="M77 11C57 16 45 36 43 62c-3 31 10 49 39 51 27 2 44-14 47-43 3-26-9-47-27-56-8-4-17-4-25-3Z"/><path d="M88 114 85 149 83 244M49 184 85 149 130 184M48 287 83 244 124 284"/></svg></button>`)
const dialog = el<HTMLDialogElement>('capture-dialog'), video = el<HTMLVideoElement>('video')
el('human').insertAdjacentHTML('beforebegin', `<button id="car" aria-label="경차 왕복 주행"><svg viewBox="0 0 100 70" aria-hidden="true" fill="currentColor" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path fill-rule="evenodd" d="M8 54Q4 51 6 38C7 26 10 15 16 12Q30 8 46 10C57 10 66 20 75 27Q92 30 95 43Q98 52 92 55H91Q92 43 79 42Q65 41 64 56Q50 57 35 55Q35 42 21 42Q9 42 8 54ZM22 16Q19 19 19 27Q38 28 65 29Q58 20 49 16Q37 13 22 16Z"/><path fill="none" d="M11 56C10 48 15 44 21 45C28 44 32 50 31 57C31 64 25 67 19 66C13 66 10 62 11 56ZM68 57C67 50 72 44 79 45C86 45 90 50 88 58C88 64 82 67 76 66C70 66 67 62 68 57Z"/><path d="M51 10Q40 5 27 2" fill="none"/></svg></button>`)
const photo = el<HTMLCanvasElement>('photo'), snap = el<HTMLButtonElement>('snap')
const status = el('status'), loading = el('loading'), retry = el<HTMLButtonElement>('retry')
let world: ReturnType<typeof createWorld> | undefined
try { world = createWorld(el('world')) }
catch { el('world-error').hidden = false; el('world-error').textContent = '3D 화면을 열 수 없습니다. 브라우저의 하드웨어 가속을 확인해 주세요.'; el<HTMLButtonElement>('join').disabled = true }
let stream: MediaStream | undefined, requestId = 0, busy = false
let speech: ReturnType<typeof createSpeech> | undefined
const shared = world ? connectFlock(world, error => {
  el('world-error').hidden = !error; el('world-error').textContent = error ?? ''
}, snapshot => speech?.refresh(snapshot)) : undefined
if (shared) speech = createSpeech(shared, id => world?.focusSpeech(id))
for (const id of ['join', 'speak']) {
  const label = document.createElement('span'); label.className = 'wide-text'
  label.textContent = el(id).textContent; el(id).replaceChildren(label)
}
const removalDialog = el<HTMLDialogElement>('remove-dialog')
let deleting = false
let poodleRunning = false
for (const visitor of ['poodle', 'human', 'car']) el(visitor).onclick = async () => {
  if (!world || deleting || poodleRunning) return
  poodleRunning = true; speech?.close()
  for (const id of ['poodle', 'human', 'car', 'join', 'speak', 'remove-pigeon']) el<HTMLButtonElement>(id).disabled = true
  try { await (visitor === 'human' ? world.releaseHuman() : visitor === 'car' ? world.releaseCar() : world.releasePoodle()) }
  catch (error) { el('world-error').textContent = error instanceof Error ? error.message : '방문자를 불러오지 못했어요.'; el('world-error').hidden = false }
  finally {
    poodleRunning = false
    for (const id of ['poodle', 'human', 'car', 'join', 'speak', 'remove-pigeon']) el<HTMLButtonElement>(id).disabled = false
    for (const id of ['poodle', 'human', 'car']) el<HTMLButtonElement>(id).disabled = world.poodleActive
  }
}
el('world').addEventListener('poodleend', () => { for (const id of ['poodle', 'human', 'car']) el<HTMLButtonElement>(id).disabled = false })
el('remove-pigeon').onclick = () => {
  if (!speech?.owner || deleting || poodleRunning) return
  speech.close(); el('remove-error').hidden = true; removalDialog.showModal()
}
el('remove-close').onclick = () => removalDialog.close()
el('remove-ok').onclick = async () => {
  const owner = speech?.owner
  if (!owner || !shared || deleting) { removalDialog.close(); return }
  deleting = true
  el<HTMLButtonElement>('remove-ok').disabled = true
  el<HTMLButtonElement>('remove-pigeon').disabled = true
  el<HTMLButtonElement>('join').disabled = true
  removalDialog.close()
  try { await shared.remove(owner) }
  catch (error) {
    el('remove-error').textContent = error instanceof Error ? error.message : '삭제하지 못했어요. 다시 시도해 주세요.'
    el('remove-error').hidden = false; removalDialog.showModal()
  } finally {
    deleting = false
    for (const id of ['remove-ok', 'remove-pigeon', 'join']) el<HTMLButtonElement>(id).disabled = false
  }
}
function stopCamera() { stream?.getTracks().forEach(track => track.stop()); stream = undefined; video.srcObject = null; snap.disabled = true }
function showError(message: string) { status.textContent = message; status.hidden = false; retry.hidden = false }
function clearPhoto() { photo.width = photo.height = 1; photo.hidden = true }
async function startCamera() {
  const request = ++requestId
  stopCamera(); clearPhoto(); status.hidden = true; retry.hidden = true; loading.hidden = false
  video.hidden = false; el('face-guide').hidden = false
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('카메라는 localhost 또는 HTTPS에서 사용할 수 있어요.')
    const next = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false })
    if (request !== requestId || !dialog.open) { next.getTracks().forEach(track => track.stop()); return }
    stream = next; video.srcObject = next; await video.play()
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) await new Promise<void>(resolve => video.addEventListener('loadeddata', () => resolve(), { once: true }))
    if (request !== requestId || !dialog.open) return
    if (!video.videoWidth || !video.videoHeight) throw new Error('카메라 화면을 읽지 못했어요. 다시 시도해 주세요.')
    snap.disabled = false
  } catch (error) {
    if (request !== requestId || !dialog.open) return
    stopCamera()
    showError(error instanceof DOMException && error.name === 'NotAllowedError' ? '카메라 권한을 허용한 뒤 다시 시도해 주세요.' : error instanceof Error && !(error instanceof DOMException) ? error.message : '카메라를 연결하지 못했어요. 연결 상태를 확인하고 다시 시도해 주세요.')
  } finally { if (request === requestId) loading.hidden = true }
}
el('join').onclick = () => { speech?.close(); dialog.showModal(); void startCamera() }
retry.onclick = () => { void startCamera() }
el('close').onclick = () => dialog.close()
dialog.addEventListener('close', () => { requestId++; stopCamera(); clearPhoto(); loading.hidden = true; busy = false })
snap.onclick = async () => {
  if (busy || !world || !video.videoWidth || snap.disabled) return
  busy = true; snap.disabled = true; retry.hidden = true; status.hidden = true
  const request = requestId
  const scale = Math.min(1, 1280 / Math.max(video.videoWidth, video.videoHeight))
  photo.width = Math.round(video.videoWidth * scale); photo.height = Math.round(video.videoHeight * scale)
  photo.getContext('2d')!.drawImage(video, 0, 0, photo.width, photo.height)
  // This independent image survives dialog cleanup and remains the face texture.
  const snapshot = document.createElement('canvas'); snapshot.width = photo.width; snapshot.height = photo.height
  snapshot.getContext('2d')!.drawImage(photo, 0, 0)
  photo.hidden = false; video.hidden = true; el('face-guide').hidden = true
  stopCamera(); loading.hidden = false
  await new Promise<void>(resolve => requestAnimationFrame(() => { setTimeout(resolve, 0) }))
  try {
    if (request !== requestId || !dialog.open) return
    // Raise the minimum and increase the previous .56 maximum by 10%.
    const face = await createFace(snapshot, .30 + Math.random() * .316)
    if (request !== requestId || !dialog.open) { face.geometry.dispose(); face.material.map?.dispose(); face.material.dispose(); return }
    try { speech?.setOwner(await shared!.publish(face)) }
    finally { face.geometry.dispose(); face.material.map?.dispose(); face.material.dispose() }
    if (request === requestId && dialog.open) dialog.close()
  } catch (error) {
    if (request !== requestId || !dialog.open) return
    console.error('Pigeon creation failed:', error)
    showError(error instanceof Error && (SUPABASE_STORAGE || error.message.includes('얼굴') || error.message.includes('광장') || error.message.includes('서버') || error.message.includes('브라우저')) ? error.message : '얼굴 변환 또는 저장을 완료하지 못했어요. 다시 시도해 주세요.')
  } finally { if (request === requestId) { busy = false; loading.hidden = true } }
}
document.addEventListener('visibilitychange', () => { if (document.hidden && stream) { requestId++; stopCamera(); loading.hidden = true; showError('카메라가 꺼졌어요. 다시 켜서 촬영해 주세요.') } })
window.addEventListener('pagehide', () => { requestId++; stopCamera() })
