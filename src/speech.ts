import { addNoise, automaticIndices, editSpeech, humanCount, restoreSpeech, speechValue, SPEECH_LIMIT } from './speech-text'
import type { SpeechChar, SpeechEdit } from './speech-text'
import type { connectFlock } from './shared-flock'
import type { FlockSnapshot, PigeonOwner } from './pigeon-data'
import { readOwners, rememberOwners } from './ownership'
import { SUPABASE_STORAGE } from './storage-mode'
import { analyticsError, track } from './analytics'

export function createSpeech(shared: ReturnType<typeof connectFlock>, focusPigeon?: (id: string) => void) {
  const button = document.getElementById('speak') as HTMLButtonElement
  const actionBar = document.getElementById('action-bar')
  if (actionBar) actionBar.dataset.participation = 'loading'
  const removeButton = document.getElementById('remove-pigeon') as HTMLButtonElement
  const panel = document.getElementById('speech-panel')!
  const input = document.getElementById('speech-input') as HTMLInputElement
  const touchInput = matchMedia('(any-pointer: coarse)').matches
  input.setAttribute('autocorrect', 'off'); input.setAttribute('autocapitalize', 'off')
  const counter = document.getElementById('speech-count')!
  const error = document.getElementById('speech-error')!
  let owner: PigeonOwner | undefined
  let composing = false, endingComposition = false, dirty = false, lastSaved = ''
  let chars: SpeechChar[] = [], edit: SpeechEdit | undefined
  let resumeNoise = false
  let noiseStarted = false
  const nextNoiseInterval=()=>touchInput?6+Math.floor(Math.random()*3):7+Math.floor(Math.random()*4)
  let noiseProgress = 0, noiseInterval = nextNoiseInterval(), noiseDue = false
  let submitPending = false
  let focusAfterSubmit = false
  let enterHeld = false
  let compositionTimer: ReturnType<typeof setTimeout>, saveTimer: ReturnType<typeof setTimeout>, submitTimer: ReturnType<typeof setTimeout>
  let noiseTimer: ReturnType<typeof setTimeout>, previewTimer: ReturnType<typeof setTimeout> | undefined
  let saves = Promise.resolve()
  let lastMeasuredSave: { id: string; message: string } | undefined
  const count = () => { counter.textContent = `${humanCount(chars)} / ${SPEECH_LIMIT}` }
  const persist = () => {
    clearTimeout(saveTimer)
    if (!owner || composing || endingComposition) return
    const target = { ...owner }, message = speechValue(chars), automatic = automaticIndices(chars)
    const characterCount=humanCount(chars)
    if (!dirty && message === lastSaved) return
    saves = saves.catch(() => {}).then(async () => {
      try {
        await shared.say(target, message, automatic)
        if(lastMeasuredSave?.id!==target.id||lastMeasuredSave.message!==message){
          track('speech_saved',{character_count:characterCount});lastMeasuredSave={id:target.id,message}
        }
        if (owner?.id === target.id && speechValue(chars) === message) {
          dirty = false; lastSaved = message; error.hidden = true
        }
      } catch (reason) {
        track('speech_error',{error_code:analyticsError(reason)})
        if (owner?.id !== target.id) return
        error.textContent = reason instanceof Error ? reason.message : '말풍선을 저장하지 못했어요. 다시 시도해 주세요.'
        error.hidden = false
        if (SUPABASE_STORAGE && panel.hidden) {
          panel.hidden = false; button.setAttribute('aria-expanded', 'true')
          input.focus()
        }
      }
    })
  }
  const changed = () => {
    count(); dirty = true
    if (owner) {
      if(touchInput){
        // Coalesce keyboard revisions without repeatedly moving the 3D camera.
        previewTimer??=setTimeout(()=>{previewTimer=undefined;if(owner)shared.previewSpeech(owner.id,speechValue(chars),automaticIndices(chars))},100)
      }else{shared.previewSpeech(owner.id, input.value, automaticIndices(chars)); focusPigeon?.(owner.id)}
    }
    clearTimeout(saveTimer)
    // Supabase publishes submitted text; typing remains a preview in this browser.
    if (!SUPABASE_STORAGE) saveTimer = setTimeout(persist, 650)
  }
  const distort = (caret: number) => {
    const before = automaticIndices(chars).length
    const result = addNoise(chars, caret)
    if (automaticIndices(result.chars).length === before) return
    if (automaticIndices(result.chars).length > before) {
      noiseStarted = true
      resumeNoise = false; noiseDue = false; noiseProgress = 0; noiseInterval = nextNoiseInterval()
    }
    chars = result.chars; input.value = speechValue(chars); input.setSelectionRange(result.cursor, result.cursor); changed()
  }
  const applyNoise = (caret: number) => {
    if (!touchInput) distort(caret)
  }
  const commitInput = (inputType = '', modelOnly = false) => {
    if (input.value === speechValue(chars)) {
      edit = undefined
      if (!modelOnly && noiseDue && input.value.trim()) applyNoise(input.selectionStart ?? input.value.length)
      return
    }
    const caret = input.selectionStart ?? input.value.length
    const previousCount = humanCount(chars)
    // Touch keyboards may replace an entire marked word, even when most of it
    // is unchanged. Diff the actual value to preserve automatic provenance.
    const result = editSpeech(chars, input.value, caret, touchInput?undefined:edit); edit = undefined
    // Removing even part of an automatic group re-arms noise for the next insertion.
    // Backspace itself must never create replacement noise.
    if (!touchInput && inputType.startsWith('delete') && automaticIndices(result.chars).length < automaticIndices(chars).length) resumeNoise = true
    chars = result.chars
    const insertion = !inputType || inputType.startsWith('insert')
    if(touchInput){
      // Replacing/deleting/retyping the same syllable must not earn noise again.
      noiseProgress=Math.max(0,noiseProgress+humanCount(chars)-previousCount)
      noiseDue=noiseStarted?noiseProgress>=noiseInterval:humanCount(chars)>=3
    }
    if (insertion && result.inserted > 0) {
      // Count committed characters equally for Latin input and completed Hangul syllables.
      // Carry the count through rapid IME transitions without changing its live DOM.
      // Mobile keyboards replace whole words and repeatedly revise a syllable.
      // Count only growth, not all characters reported by each replacement event.
      if(!touchInput){noiseProgress += Math.max(0, humanCount(chars) - previousCount)
      noiseDue ||= resumeNoise || !noiseStarted || noiseProgress >= noiseInterval}
    }
    if (!chars.length) { noiseProgress = 0; noiseDue = false; noiseStarted = false }
    // Assigning value/selection during a Korean IME transition can recommit a syllable.
    // A new composition may consume the previous result into the model without touching DOM.
    if (modelOnly || touchInput) { changed(); return }
    const next = speechValue(chars)
    if (input.value !== next) {
      input.value = next; input.setSelectionRange(result.cursor, result.cursor)
    }
    if (insertion && result.inserted > 0 && input.value.trim() && noiseDue) { applyNoise(result.cursor); if (touchInput) changed() }
    else changed()
  }
  const flushTouchInput=()=>{
    if(!touchInput||composing||endingComposition)return
    const caret=input.selectionStart??input.value.length,next=speechValue(chars)
    if(input.value!==next){input.value=next;input.setSelectionRange(Math.min(caret,next.length),Math.min(caret,next.length))}
    if(noiseDue&&input.value.trim())distort(input.selectionStart??input.value.length)
  }
  input.addEventListener('beforeinput', event => {
    clearTimeout(noiseTimer)
    const type = (event as InputEvent).inputType
    if(touchInput&&(type==='insertLineBreak'||type==='insertParagraph')){event.preventDefault();submit(true);return}
    if (endingComposition && type !== 'insertFromComposition' && type !== 'insertCompositionText') {
      clearTimeout(compositionTimer); endingComposition = false; commitInput('insertFromComposition', true)
    }
    if (!composing && !endingComposition) edit = { start: input.selectionStart ?? 0, end: input.selectionEnd ?? 0, type }
  })
  input.addEventListener('compositionstart', () => {
    clearTimeout(noiseTimer)
    clearTimeout(compositionTimer)
    if (endingComposition) { endingComposition = false; commitInput('insertFromComposition', true) }
    edit = { start: input.selectionStart ?? 0, end: input.selectionEnd ?? 0, type: 'insertCompositionText' }
    composing = true; clearTimeout(saveTimer)
  })
  input.addEventListener('compositionend', () => {
    composing = false; endingComposition = true
    // Wait until native final-input events settle. A following composition cancels this.
    clearTimeout(compositionTimer)
    compositionTimer = setTimeout(() => {
      if (composing || !endingComposition) return
      endingComposition = false; commitInput('insertFromComposition', submitPending)
      if (submitPending) scheduleSubmit()
      else if(touchInput)flushTouchInput()
    }, touchInput?50:0)
  })
  input.addEventListener('input', event => {
    clearTimeout(noiseTimer)
    const native=event as InputEvent
    if (!composing && !endingComposition && !native.isComposing) commitInput(native.inputType)
    // iOS Korean can omit composition events entirely. An idle timeout is NOT
    // proof of Hangul commitment: use explicit composition end or a boundary.
    // Plain Latin keystrokes can also flush after a short typing pause.
    const boundary=/[\s!?.,;:。！？]$/.test(native.data??'')
    const latin=/^[a-zA-Z0-9]+$/.test(native.data??'')
    if(touchInput&&!native.isComposing&&native.inputType==='insertText'&&(boundary||latin)){
      const value=input.value,caret=input.selectionStart
      noiseTimer=setTimeout(()=>{
        if(panel.hidden||submitPending||composing||endingComposition||input.value!==value||input.selectionStart!==caret||caret!==input.selectionEnd)return
        commitInput('insertText',true);flushTouchInput()
      },boundary?0:250)
    }
  })
  const finishClose = () => { clearTimeout(noiseTimer);clearTimeout(previewTimer);previewTimer=undefined;panel.hidden = true; persist(); button.setAttribute('aria-expanded', 'false') }
  const scheduleSubmit = () => {
    clearTimeout(submitTimer)
    submitTimer = setTimeout(() => {
      if (!submitPending || enterHeld) return
      // Never blur or rewrite the value during Enter's native IME default action.
      // Some browsers finish composition on blur; defer that fallback until keyup.
      if (composing) {
        if(touchInput&&document.activeElement!==input)composing=false
        else{input.blur();return}
      }
      clearTimeout(compositionTimer); endingComposition = false
      commitInput('insertFromComposition');flushTouchInput(); submitPending = false
      finishClose()
      if (focusAfterSubmit) button.focus()
      focusAfterSubmit = false
    }, touchInput?32:0)
  }
  const submit = (returnFocus = false) => {
    submitPending = true; focusAfterSubmit = returnFocus
    if(touchInput&&!enterHeld&&document.activeElement===input)input.blur()
    scheduleSubmit()
  }
  const close = () => { if (panel.hidden) persist(); else submit() }
  button.onclick = () => {
    if (!owner) return
    if (!panel.hidden) { submit(true); return }
    focusPigeon?.(owner.id)
    panel.hidden = false; button.setAttribute('aria-expanded', 'true'); count(); input.focus()
    track('speech_open')
  }
  document.getElementById('speech-close')!.onclick = () => submit(true)
  document.addEventListener('click', event => {
    const target = event.target
    if (!panel.hidden && target instanceof Node && !panel.contains(target) && !button.contains(target)) close()
  })
  input.addEventListener('blur', () => { if (!SUPABASE_STORAGE) persist() })
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.code === 'Enter' || event.code === 'NumpadEnter') {
      if (!event.isComposing && !composing && event.keyCode !== 229) event.preventDefault()
      enterHeld = true; submitPending = true; focusAfterSubmit = true; return
    }
    if (event.isComposing || composing || endingComposition || event.keyCode === 229) return
    if (event.key === 'Escape') { event.preventDefault(); submit(true) }
  })
  input.addEventListener('keyup', event => {
    if (event.key === 'Enter' || event.code === 'Enter' || event.code === 'NumpadEnter') {
      enterHeld = false
      if (!panel.hidden) submit(true)
    }
  })
  return {
    close,
    get owner() { return owner ? { ...owner } : undefined },
    setOwner(next: PigeonOwner) {
      finishClose(); clearTimeout(compositionTimer); composing = false; endingComposition = false
      clearTimeout(submitTimer); submitPending = false; enterHeld = false; noiseProgress = 0; noiseDue = false
      owner = next; chars = []; input.value = ''; dirty = false; lastSaved = ''; error.hidden = true; resumeNoise = false; noiseStarted = false
      rememberOwners([next])
      button.hidden = false; removeButton.hidden = false; count()
      if (actionBar) actionBar.dataset.participation = 'owned'
    },
    refresh(snapshot: FlockSnapshot) {
      const owned = readOwners()
      // Snapshots are ordered oldest-first; skip deleted/evicted and other users' pigeons.
      const bird = snapshot.birds.filter(b => owned.has(b.id) && (!SUPABASE_STORAGE || b.owned)).at(-1)
      const next = bird ? owned.get(bird.id) : undefined
      if (owner?.id !== next?.id) {
        // Save a surviving bird's draft before switching to a newer capture from another tab.
        if (owner && snapshot.birds.some(b => b.id === owner!.id)) persist()
        clearTimeout(compositionTimer); clearTimeout(saveTimer); composing = false; endingComposition = false
        clearTimeout(previewTimer);previewTimer=undefined
        clearTimeout(submitTimer); submitPending = false; enterHeld = false; noiseProgress = 0; noiseDue = false
        clearTimeout(noiseTimer); owner = next; panel.hidden = true; button.setAttribute('aria-expanded', 'false')
        chars = []; input.value = ''; dirty = false; lastSaved = ''; edit = undefined; error.hidden = true; resumeNoise = false; noiseStarted = false
        count()
      }
      button.hidden = !next; removeButton.hidden = !next
      if (actionBar) actionBar.dataset.participation = next ? 'owned' : 'empty'
      if (!bird) return
      if (!dirty && !composing && !endingComposition && panel.hidden) { chars = restoreSpeech(bird.message, bird.automatic); noiseStarted = chars.some(c => c.automatic); input.value = speechValue(chars); lastSaved = input.value; count() }
    },
  }
}
