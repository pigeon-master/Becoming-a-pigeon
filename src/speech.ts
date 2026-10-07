import { addNoise, automaticIndices, editSpeech, humanCount, restoreSpeech, speechValue, SPEECH_LIMIT } from './speech-text'
import type { SpeechChar, SpeechEdit } from './speech-text'
import type { connectFlock } from './shared-flock'
import type { FlockSnapshot, PigeonOwner } from './pigeon-data'
import { readOwners, rememberOwners } from './ownership'
import { SUPABASE_STORAGE } from './storage-mode'

export function createSpeech(shared: ReturnType<typeof connectFlock>) {
  const button = document.getElementById('speak') as HTMLButtonElement
  const removeButton = document.getElementById('remove-pigeon') as HTMLButtonElement
  const panel = document.getElementById('speech-panel')!
  const input = document.getElementById('speech-input') as HTMLInputElement
  const counter = document.getElementById('speech-count')!
  const error = document.getElementById('speech-error')!
  let owner: PigeonOwner | undefined
  let composing = false, endingComposition = false, dirty = false, lastSaved = ''
  let chars: SpeechChar[] = [], edit: SpeechEdit | undefined
  let resumeNoise = false
  let noiseProgress = 0, noiseInterval = 7 + Math.floor(Math.random() * 4), noiseDue = false
  let submitPending = false
  let enterHeld = false
  let compositionTimer: ReturnType<typeof setTimeout>, saveTimer: ReturnType<typeof setTimeout>, submitTimer: ReturnType<typeof setTimeout>
  let saves = Promise.resolve()
  const count = () => { counter.textContent = `${humanCount(chars)} / ${SPEECH_LIMIT}` }
  const persist = () => {
    clearTimeout(saveTimer)
    if (!owner || composing || endingComposition) return
    const target = { ...owner }, message = input.value, automatic = automaticIndices(chars)
    if (!dirty && message === lastSaved) return
    saves = saves.catch(() => {}).then(async () => {
      try {
        await shared.say(target, message, automatic)
        if (owner?.id === target.id && input.value === message) {
          dirty = false; lastSaved = message; error.hidden = true
        }
      } catch (reason) {
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
    if (owner) shared.previewSpeech(owner.id, input.value, automaticIndices(chars))
    clearTimeout(saveTimer)
    // Supabase publishes submitted text; typing remains a preview in this browser.
    if (!SUPABASE_STORAGE) saveTimer = setTimeout(persist, 650)
  }
  const distort = (caret: number) => {
    const before = automaticIndices(chars).length
    const result = addNoise(chars, caret)
    if (automaticIndices(result.chars).length > before) {
      resumeNoise = false; noiseDue = false; noiseProgress = 0; noiseInterval = 7 + Math.floor(Math.random() * 4)
    }
    chars = result.chars; input.value = speechValue(chars); input.setSelectionRange(result.cursor, result.cursor); changed()
  }
  const commitInput = (inputType = '', modelOnly = false) => {
    if (input.value === speechValue(chars)) {
      edit = undefined
      if (!modelOnly && noiseDue && input.value.trim()) distort(input.selectionStart ?? input.value.length)
      return
    }
    const caret = input.selectionStart ?? input.value.length
    const result = editSpeech(chars, input.value, caret, edit); edit = undefined
    // Removing even part of an automatic group re-arms noise for the next insertion.
    // Backspace itself must never create replacement noise.
    if (automaticIndices(result.chars).length < automaticIndices(chars).length) resumeNoise = true
    chars = result.chars
    const insertion = !inputType || inputType.startsWith('insert')
    if (insertion && result.inserted > 0) {
      // Count committed characters equally for Latin input and completed Hangul syllables.
      // Carry the count through rapid IME transitions without changing its live DOM.
      noiseProgress += result.inserted
      noiseDue ||= resumeNoise || !chars.some(c => c.automatic && c.char === '9') || noiseProgress >= noiseInterval
    }
    if (!chars.length) { noiseProgress = 0; noiseDue = false }
    // Assigning value/selection during a Korean IME transition can recommit a syllable.
    // A new composition may consume the previous result into the model without touching DOM.
    if (modelOnly) { changed(); return }
    const next = speechValue(chars)
    if (input.value !== next) {
      input.value = next; input.setSelectionRange(result.cursor, result.cursor)
    }
    if (insertion && result.inserted > 0 && input.value.trim() && noiseDue) distort(result.cursor)
    else changed()
  }
  input.addEventListener('beforeinput', event => {
    const type = (event as InputEvent).inputType
    if (endingComposition && type !== 'insertFromComposition' && type !== 'insertCompositionText') {
      clearTimeout(compositionTimer); endingComposition = false; commitInput('insertFromComposition', true)
    }
    if (!composing && !endingComposition) edit = { start: input.selectionStart ?? 0, end: input.selectionEnd ?? 0, type }
  })
  input.addEventListener('compositionstart', () => {
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
    }, 0)
  })
  input.addEventListener('input', event => { if (!composing && !endingComposition && !(event as InputEvent).isComposing) commitInput((event as InputEvent).inputType) })
  const close = () => { panel.hidden = true; persist(); button.setAttribute('aria-expanded', 'false') }
  const scheduleSubmit = () => {
    clearTimeout(submitTimer)
    submitTimer = setTimeout(() => {
      if (!submitPending || enterHeld) return
      // Never blur or rewrite the value during Enter's native IME default action.
      // Some browsers finish composition on blur; defer that fallback until keyup.
      if (composing) { input.blur(); return }
      clearTimeout(compositionTimer); endingComposition = false
      commitInput('insertFromComposition'); submitPending = false
      close(); button.focus()
    }, 0)
  }
  button.onclick = () => {
    if (!owner) return
    panel.hidden = !panel.hidden; button.setAttribute('aria-expanded', String(!panel.hidden))
    if (!panel.hidden) { count(); input.focus() } else close()
  }
  document.getElementById('speech-close')!.onclick = close
  input.addEventListener('blur', () => { if (!SUPABASE_STORAGE) persist() })
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.code === 'Enter' || event.code === 'NumpadEnter') {
      if (!event.isComposing && !composing && event.keyCode !== 229) event.preventDefault()
      enterHeld = true; submitPending = true; return
    }
    if (event.isComposing || composing || endingComposition || event.keyCode === 229) return
    if (event.key === 'Escape') { event.preventDefault(); close(); button.focus() }
  })
  input.addEventListener('keyup', event => {
    if (event.key === 'Enter' || event.code === 'Enter' || event.code === 'NumpadEnter') {
      enterHeld = false
      if (!panel.hidden) { submitPending = true; scheduleSubmit() }
    }
  })
  return {
    close,
    get owner() { return owner ? { ...owner } : undefined },
    setOwner(next: PigeonOwner) {
      close(); clearTimeout(compositionTimer); composing = false; endingComposition = false
      clearTimeout(submitTimer); submitPending = false; enterHeld = false; noiseProgress = 0; noiseDue = false
      owner = next; chars = []; input.value = ''; dirty = false; lastSaved = ''; error.hidden = true; resumeNoise = false
      rememberOwners([next])
      button.hidden = false; removeButton.hidden = false; count()
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
        clearTimeout(submitTimer); submitPending = false; enterHeld = false; noiseProgress = 0; noiseDue = false
        owner = next; panel.hidden = true; button.setAttribute('aria-expanded', 'false')
        chars = []; input.value = ''; dirty = false; lastSaved = ''; edit = undefined; error.hidden = true; resumeNoise = false
        count()
      }
      button.hidden = !next; removeButton.hidden = !next
      if (!bird) return
      if (!dirty && !composing && !endingComposition && panel.hidden) { chars = restoreSpeech(bird.message, bird.automatic); input.value = speechValue(chars); lastSaved = input.value; count() }
    },
  }
}
