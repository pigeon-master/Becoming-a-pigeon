import test from 'node:test'
import assert from 'node:assert/strict'
import { analyticsError, bindExampleAnalytics, track, trackOperation } from '../src/analytics.ts'

function fixture() {
  const events: { name: string; parameters: Record<string, string | number> }[] = []
  const browser = new EventTarget() as EventTarget & { gtag?: (...args: unknown[]) => void }
  browser.gtag = (_command, name, parameters) => events.push({ name: name as string, parameters: parameters as Record<string, string | number> })
  Object.defineProperty(globalThis, 'window', { value: browser, configurable: true })
  const container = new EventTarget()
  const tracker = bindExampleAnalytics(container as HTMLElement, () => 40)
  const emit = (name: string, detail = {}) => container.dispatchEvent(new CustomEvent(name, { detail }))
  const find = (name: string) => events.filter(event => event.name === name)
  return { events, browser, tracker, emit, find }
}

test('all four examples distinguish request, actual start and full recovery end exactly once', () => {
  for (const type of ['dog', 'car', 'human', 'wizard'] as const) {
    const { tracker, emit, find } = fixture()
    tracker.request(type)
    assert.equal(find('example_request').length, 1)
    assert.equal(find('example_start').length, 0)
    emit('visitorstart', { exampleType: type }); emit('visitorstart', { exampleType: type })
    tracker.finishPending() // UI may unlock before every pigeon returns.
    assert.equal(find('example_end').length, 0)
    emit('visitorend', { exampleType: type }); emit('visitorend', { exampleType: type })
    assert.equal(find('example_start').length, 1)
    assert.equal(find('example_end').length, 1)
    assert.equal(find('example_end')[0].parameters.example_type, type)
    assert.equal(find('example_end')[0].parameters.outcome, 'completed')
    assert.equal(find('example_end')[0].parameters.started, 1)
  }
})

test('wizard control starts only once both the landed wizard and tracking are ready', () => {
  for (const readyFirst of [true, false]) {
    const { tracker, emit, find } = fixture()
    tracker.request('wizard'); emit('visitorstart', { exampleType: 'wizard' })
    if (readyFirst) tracker.trackingReady(); else emit('wizardcontrolstart')
    assert.equal(find('wizard_control_start').length, 0)
    if (readyFirst) emit('wizardcontrolstart'); else tracker.trackingReady()
    tracker.trackingReady(); emit('wizardcontrolstart')
    assert.equal(find('wizard_control_start').length, 1)
    for (let i = 0; i < 100; i++) for (const pattern of ['walking', 'flying', 'ribbon', 'vortex']) emit('wizardpattern', { pattern })
    assert.deepEqual(find('wizard_pattern').map(event => event.parameters.pattern), ['flying', 'ribbon', 'vortex'])
    tracker.stopControl('user_close'); emit('wizardtrackingend'); emit('wizardtrackingend')
    emit('visitorend', { exampleType: 'wizard' })
    assert.equal(find('wizard_control_end').length, 1)
    assert.equal(find('wizard_control_end')[0].parameters.end_reason, 'user_close')
    assert.equal(find('example_end')[0].parameters.outcome, 'cancelled')
  }
})

test('permission denial ends an unstarted attempt as failed and never sends error text', () => {
  const { tracker, find, events } = fixture()
  tracker.request('wizard')
  const error = new DOMException('private URL or device name', 'NotAllowedError')
  tracker.fail(error); tracker.fail(error); tracker.cancel('cancelled'); tracker.finishPending()
  assert.equal(find('example_error').length, 1)
  assert.equal(find('example_error')[0].parameters.error_code, 'permission_denied')
  assert.equal(find('example_end')[0].parameters.started, 0)
  assert.equal(find('example_end')[0].parameters.outcome, 'failed')
  assert.ok(!JSON.stringify(events).includes(error.message))
})

test('runtime failure stays failed through camera abort, rope exit and duplicate cleanup', () => {
  const { tracker, emit, find } = fixture()
  tracker.request('wizard'); emit('visitorstart', { exampleType: 'wizard' }); tracker.trackingReady(); emit('wizardcontrolstart')
  tracker.fail(new Error('private content')); tracker.cancel('cancelled'); emit('wizardtrackingend')
  assert.equal(find('example_end').length, 0)
  emit('visitorend', { exampleType: 'wizard' })
  assert.equal(find('example_end')[0].parameters.outcome, 'failed')
  assert.equal(find('wizard_control_end').length, 1)
})

test('car impacts are aggregated while milestones and return start are sent once', () => {
  const { tracker, emit, find, events } = fixture()
  tracker.request('car'); emit('visitorstart', { exampleType: 'car' })
  for (let i = 0; i < 80; i++) emit('carimpact', { id: 'private-bird-id', velocity: [1, 2, 3] })
  emit('carreturnstart'); for (let i = 0; i < 40; i++) emit('pigeonreturning', { id: 'private-bird-id' })
  emit('visitorend', { exampleType: 'car' })
  assert.deepEqual(find('example_milestone').map(event => event.parameters.milestone), ['first_collision', 'return_started'])
  assert.equal(find('example_end')[0].parameters.hit_count, 80)
  assert.ok(!JSON.stringify(events).includes('private-bird-id'))
})

test('page leave terminates active measurement once, including an unstarted request', () => {
  for (const started of [true, false]) {
    const { tracker, emit, find, browser } = fixture()
    tracker.request('human'); if (started) emit('visitorstart', { exampleType: 'human' })
    browser.dispatchEvent(new Event('pagehide')); browser.dispatchEvent(new Event('pagehide')); emit('visitorend', { exampleType: 'human' })
    assert.equal(find('example_end').length, 1)
    assert.equal(find('example_end')[0].parameters.end_reason, 'page_leave')
  }
})

test('operation completion is deduplicated and analytics failures never break actions', () => {
  const { find, browser } = fixture()
  const end = trackOperation('pigeon_create', { pigeon_count: 4 })
  end('completed'); end('cancelled'); end('failed', new Error('private'))
  assert.equal(find('pigeon_create_end').length, 1)
  assert.equal(find('pigeon_create_end')[0].parameters.outcome, 'completed')
  browser.gtag = () => { throw new Error('blocked') }
  assert.doesNotThrow(() => track('speech_open'))
  assert.doesNotThrow(() => trackOperation('pigeon_delete')('completed'))
  delete browser.gtag
  assert.doesNotThrow(() => track('speech_open'))
  assert.equal(analyticsError(new Error('private details')), 'operation_failed')
})
