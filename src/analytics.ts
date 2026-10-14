export type ExampleType = 'dog' | 'car' | 'human' | 'wizard'
type Parameters = Record<string, string | number>
type Outcome = 'completed' | 'failed' | 'cancelled'
type EventName = 'example_request' | 'example_start' | 'example_end' | 'example_error'
  | 'example_milestone' | 'wizard_control_start' | 'wizard_control_end' | 'wizard_pattern'
  | 'camera_open' | 'camera_ready' | 'camera_close' | 'camera_error'
  | 'pigeon_create_start' | 'pigeon_create_end' | 'pigeon_delete_start' | 'pigeon_delete_end'
  | 'speech_open' | 'speech_saved' | 'speech_error'

// Analytics must never block or interrupt the experience, including with blockers.
export function track(event: EventName, parameters: Parameters = {}) {
  try {
    const tag = (window as Window & { gtag?: (command: string, event: string, parameters: Parameters) => void }).gtag
    tag?.('event', event, { ...parameters, send_to: 'G-Q0DH99MGN0' })
  } catch { /* Measurement is optional for running the site. */ }
}

export function analyticsError(error: unknown) {
  const name = error instanceof Error ? error.name : ''
  return ({ NotAllowedError: 'permission_denied', NotFoundError: 'device_missing',
    NotReadableError: 'device_busy', SecurityError: 'security_error', AbortError: 'aborted',
    TimeoutError: 'timeout', TypeError: 'network_or_unsupported' } as Record<string, string>)[name] ?? 'operation_failed'
}

const elapsed = (since: number) => Math.max(0, Math.round(performance.now() - since))

export function trackOperation(operation: 'pigeon_create' | 'pigeon_delete', parameters: Parameters = {}) {
  const since = performance.now()
  let ended = false
  track(`${operation}_start`, parameters)
  return (outcome: Outcome, error?: unknown, extra: Parameters = {}) => {
    if (ended) return
    ended = true
    track(`${operation}_end`, { ...parameters, ...extra, outcome, duration_ms: elapsed(since),
      ...(error === undefined ? {} : { error_code: analyticsError(error) }) })
  }
}

interface Attempt {
  type: ExampleType
  requestedAt: number
  startedAt?: number
  controlAt?: number
  controlReady: boolean
  trackingReady: boolean
  controlEnded: boolean
  outcome: Outcome
  reason: string
  errorSent: boolean
  hitCount: number
  milestones: Set<string>
  patterns: Set<string>
}

export function bindExampleAnalytics(container: HTMLElement, pigeonCount: () => number) {
  let active: Attempt | undefined
  const parameters = (): Parameters => ({ example_type: active!.type, pigeon_count: pigeonCount() })
  const stopControl = (reason = 'completed') => {
    if (!active) return
    if (reason !== 'completed' && active.outcome !== 'failed') {
      active.reason = reason
      active.outcome = reason === 'timeout' ? 'completed' : 'cancelled'
    }
    if (active.controlAt === undefined || active.controlEnded) return
    active.controlEnded = true
    track('wizard_control_end', { ...parameters(), end_reason: active.reason, duration_ms: elapsed(active.controlAt) })
  }
  const finish = () => {
    if (!active) return
    stopControl()
    track('example_end', { ...parameters(), outcome: active.outcome, end_reason: active.reason,
      started: Number(active.startedAt !== undefined), duration_ms: active.startedAt === undefined ? 0 : elapsed(active.startedAt),
      total_duration_ms: elapsed(active.requestedAt), ...(active.type === 'car' ? { hit_count: active.hitCount } : {}) })
    active = undefined
  }
  const controlReady = () => {
    if (!active || active.type !== 'wizard' || !active.controlReady || !active.trackingReady
      || active.startedAt === undefined || active.controlAt !== undefined || active.outcome !== 'completed') return
    active.controlAt = performance.now()
    track('wizard_control_start', parameters())
  }
  const milestone = (value: string) => {
    if (!active || active.startedAt === undefined || active.milestones.has(value)) return
    active.milestones.add(value)
    track('example_milestone', { ...parameters(), milestone: value })
  }
  container.addEventListener('visitorstart', event => {
    const type = (event as CustomEvent<{ exampleType: ExampleType }>).detail.exampleType
    if (!active || active.type !== type || active.startedAt !== undefined) return
    active.startedAt = performance.now()
    track('example_start', { ...parameters(), load_duration_ms: elapsed(active.requestedAt) })
    controlReady()
  })
  container.addEventListener('visitorend', event => {
    if (active?.type === (event as CustomEvent<{ exampleType: ExampleType }>).detail.exampleType) finish()
  })
  container.addEventListener('wizardcontrolstart', () => { if (active?.type === 'wizard') { active.controlReady = true; controlReady() } })
  container.addEventListener('wizardtrackingend', () => { if (active?.type === 'wizard') stopControl() })
  container.addEventListener('wizardpattern', event => {
    const pattern = (event as CustomEvent<{ pattern: string }>).detail.pattern
    if (!active || active.type !== 'wizard' || active.controlAt === undefined || active.controlEnded
      || !['flying', 'ribbon', 'vortex'].includes(pattern) || active.patterns.has(pattern)) return
    active.patterns.add(pattern)
    track('wizard_pattern', { ...parameters(), pattern })
  })
  container.addEventListener('carimpact', () => { if (active?.type === 'car') { active.hitCount++; milestone('first_collision') } })
  container.addEventListener('humangesture', () => { if (active?.type === 'human') milestone('scare_gesture') })
  container.addEventListener('pigeonstartled', () => { if (active?.type === 'dog') milestone('first_scare') })
  container.addEventListener('carreturnstart', () => { if (active?.type === 'car') milestone('return_started') })
  container.addEventListener('pigeonreturning', () => milestone('return_started'))
  window.addEventListener('pagehide', () => {
    if (!active) return
    if (active.outcome !== 'failed') { active.outcome = 'cancelled'; active.reason = 'page_leave' }
    finish()
  })
  return {
    request(type: ExampleType) {
      if (active) return
      active = { type, requestedAt: performance.now(), controlReady: false, trackingReady: false, controlEnded: false,
        outcome: 'completed', reason: 'completed', errorSent: false, hitCount: 0, milestones: new Set(), patterns: new Set() }
      track('example_request', parameters())
    },
    trackingReady() { if (active?.type === 'wizard') { active.trackingReady = true; controlReady() } },
    stopControl,
    cancel(reason: string) {
      if (!active) return
      stopControl(reason)
      if (active.startedAt === undefined) finish()
    },
    fail(error: unknown) {
      if (!active || active.errorSent) return
      active.errorSent = true; active.outcome = 'failed'; active.reason = 'error'
      track('example_error', { ...parameters(), error_code: analyticsError(error), stage: active.startedAt === undefined ? 'preparing' : 'running' })
      stopControl()
      if (active.startedAt === undefined) finish()
    },
    finishPending() { if (active && active.startedAt === undefined) { active.outcome = 'cancelled'; active.reason = 'not_started'; finish() } },
  }
}
