export const SPEECH_LIMIT = 50
export const DISPLAY_LIMIT = 250
export interface SpeechChar { char: string; automatic: boolean }
export interface SpeechEdit { start: number; end: number; type: string }
const userChars = (value: string): SpeechChar[] => Array.from(value.normalize('NFC').replace(/[\u0000-\u001f\u007f]/g, ' ')).map(char => ({ char, automatic: false }))
export const speechValue = (chars: SpeechChar[]) => chars.map(c => c.char).join('')
export const humanCount = (chars: SpeechChar[]) => chars.filter(c => !c.automatic).length
export const automaticIndices = (chars: SpeechChar[]) => chars.flatMap((c, i) => c.automatic ? [i] : [])

function limitChars(chars: SpeechChar[]) {
  let human = 0, noise = 0, nines = 0
  const result: SpeechChar[] = []
  for (const c of chars) {
    if (c.automatic ? ++noise > 75 : ++human > SPEECH_LIMIT) continue
    if (c.char === '9' && nines === 4) { result.push({ char: '.', automatic: true }, { char: '.', automatic: true }); nines = 0 }
    result.push(c); nines = c.char === '9' ? nines + 1 : 0
  }
  return result
}
export function restoreSpeech(value: string, automatic: number[] = []) {
  const indices = new Set(automatic)
  return limitChars(Array.from(value).map((char, i) => ({ char, automatic: indices.has(i) && (char === '9' || char === '.') })))
}
// Kept for legacy plain messages. User-typed digits and periods still count.
export function normalizeSpeech(value: string) { return speechValue(limitChars(userChars(value))) }

export function editSpeech(previous: SpeechChar[], next: string, cursor: number, edit?: SpeechEdit) {
  const old = speechValue(previous)
  let prefix = 0, suffix = 0
  const before = Array.from(old), after = Array.from(next)
  if (edit) {
    let start = Array.from(old.slice(0, edit.start)).length, end = Array.from(old.slice(0, edit.end)).length
    if (start === end && edit.type === 'deleteContentBackward') start = Math.max(0, start - 1)
    if (start === end && edit.type === 'deleteContentForward') end = Math.min(before.length, end + 1)
    const left = before.slice(0, start).join(''), right = before.slice(end).join('')
    if (next.startsWith(left) && next.endsWith(right) && after.length >= start + before.length - end) {
      prefix = start; suffix = before.length - end
    } else edit = undefined
  }
  if (!edit) {
    while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++
    while (suffix < before.length - prefix && suffix < after.length - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++
  }
  const keptLeft = previous.slice(0, prefix), keptRight = previous.slice(before.length - suffix)
  const incoming = userChars(after.slice(prefix, after.length - suffix).join(''))
  const inserted = incoming.slice(0, Math.max(0, SPEECH_LIMIT - humanCount([...keptLeft, ...keptRight])))
  const chars = limitChars([...keptLeft, ...inserted, ...keptRight])
  const omitted = speechValue(incoming).length - speechValue(inserted).length
  return { chars, inserted: inserted.length, cursor: Math.max(0, Math.min(cursor - omitted, speechValue(chars).length)) }
}

export function addNoise(previous: SpeechChar[], cursor: number, random = Math.random) {
  const room = 75 - previous.filter(c => c.automatic).length
  if (!previous.some(c => !c.automatic && c.char.trim()) || room <= 0) return { chars: previous, cursor }
  // Append immediately after the newly committed text, never at a random old position.
  const position = Array.from(speechValue(previous).slice(0, cursor)).length
  // Allocate whole dot groups instead of truncating one to a single dot at the limit.
  const leading = room >= 5 ? 2 : 0
  const trailing = room >= 3 ? 2 : 0
  const nines = 1 + Math.floor(random() * Math.min(4, room - leading - trailing))
  const noise = '.'.repeat(leading) + '9'.repeat(nines) + '.'.repeat(trailing)
  const chars = limitChars([...previous.slice(0, position), ...Array.from(noise).map(char => ({ char, automatic: true })), ...previous.slice(position)])
  const insertionOffset = speechValue(previous.slice(0, position)).length
  return { chars, cursor: Math.min(speechValue(chars).length, cursor + (insertionOffset <= cursor ? noise.length : 0)) }
}
export function validSpeech(value: unknown, automatic: unknown = []): automatic is number[] {
  if (typeof value !== 'string' || !Array.isArray(automatic) || Array.from(value).length > DISPLAY_LIMIT || automatic.length > DISPLAY_LIMIT) return false
  const chars = Array.from(value)
  if (automatic.some(i => !Number.isInteger(i) || i < 0 || i >= chars.length || !['9', '.'].includes(chars[i]))) return false
  return new Set(automatic).size === automatic.length && chars.length - automatic.length <= SPEECH_LIMIT && !/9{5}|[\u0000-\u001f\u007f]/.test(value)
}
