import './style.css'
import { createWorld } from './world'
import { connectFlock } from './shared-flock'
import { createSpeech } from './speech'
import { SUPABASE_STORAGE } from './storage-mode'

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
<p id="copyright"><span class="wide-text">ⓒ2026. CRAPPYROOM. All rights reserved.</span></p>
<main id="world" aria-label="비둘기 광장"></main><div id="action-bar"><button id="join">Become a Pigeon</button><button id="speak" aria-controls="speech-panel" aria-expanded="false" hidden>Wanna Say Something?</button></div><p id="world-error" role="alert" hidden></p>
<section id="speech-panel" aria-label="비둘기 말풍선 입력" hidden><div class="speech-input-row"><input id="speech-input" type="text" aria-label="말풍선 내용, 직접 입력한 문자와 공백 50자. 자동 문자는 제외" placeholder="Say something…" autocomplete="off" spellcheck="false"><output id="speech-count" for="speech-input">0 / 50</output><button id="speech-close" aria-label="말풍선 입력 닫기">×</button></div><p id="speech-error" role="status" hidden></p></section>
<button id="remove-pigeon" class="text-button" hidden><span class="wide-text">Remove Your Pigeon</span></button>
<button id="poodle" aria-label="검정 푸들 뛰어놀기"><svg viewBox="0 0 88 64" aria-hidden="true" fill="currentColor"><ellipse cx="40" cy="31" rx="21" ry="10"/><circle cx="57" cy="27" r="12"/><circle cx="66" cy="15" r="10"/><circle cx="62" cy="8" r="6"/><ellipse cx="61" cy="22" rx="6" ry="11"/><path d="M71 14h12q5 5-1 8H70zM27 31 13 46 5 46 4 51 17 51 34 36M34 35 29 51 20 56 23 60 35 55 42 36M52 32 59 47 72 47 74 42 64 41 61 29M61 29 73 33 80 27 83 30 75 40 60 37M24 27 15 20 12 11 8 12 10 23 21 33"/><circle cx="11" cy="10" r="7"/><circle cx="17" cy="47" r="5"/><circle cx="31" cy="52" r="5"/><circle cx="63" cy="43" r="5"/><circle cx="75" cy="35" r="5"/></svg></button>
<dialog id="remove-dialog" aria-labelledby="remove-message"><p id="remove-message"><span class="wide-text">Your pigeon will be permanently deleted.</span></p><p id="remove-error" role="alert" hidden></p><div class="remove-actions"><button id="remove-close" autofocus><span class="wide-text">Cancel</span></button><button id="remove-ok"><span class="wide-text">Ok</span></button></div></dialog>
<dialog id="capture-dialog" aria-label="얼굴 촬영"><button id="close" class="icon close" aria-label="닫기"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button><div class="camera-frame"><video id="video" autoplay playsinline muted></video><canvas id="photo" hidden></canvas><div id="face-guide"></div><div id="loading" class="spinner" role="status" aria-label="처리 중" hidden></div></div><p id="status" role="alert" hidden></p><div class="actions"><button id="retry" class="icon" aria-label="카메라 다시 켜기" hidden><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 8a8 8 0 1 0 1 7M19 3v5h-5"/></svg></button><button id="snap" aria-label="촬영하고 비둘기 되기" disabled><span></span></button></div></dialog>`
const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const dialog = el<HTMLDialogElement>('capture-dialog'), video = el<HTMLVideoElement>('video')
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
if (shared) speech = createSpeech(shared)
for (const id of ['join', 'speak']) {
  const label = document.createElement('span'); label.className = 'wide-text'
  label.textContent = el(id).textContent; el(id).replaceChildren(label)
}
const removalDialog = el<HTMLDialogElement>('remove-dialog')
let deleting = false
let poodleRunning = false
el('poodle').onclick = async () => {
  if (!world || deleting || poodleRunning) return
  poodleRunning = true; speech?.close()
  for (const id of ['poodle', 'join', 'speak', 'remove-pigeon']) el<HTMLButtonElement>(id).disabled = true
  try { await world.releasePoodle() }
  finally {
    poodleRunning = false
    for (const id of ['poodle', 'join', 'speak', 'remove-pigeon']) el<HTMLButtonElement>(id).disabled = false
    el<HTMLButtonElement>('poodle').disabled = world.poodleActive
  }
}
el('world').addEventListener('poodleend', () => { el<HTMLButtonElement>('poodle').disabled = false })
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
    const { createFace } = await import('./face')
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
