/**
 * Local mock feed. Emits the same JSON the AI engine will send, so the animation,
 * camera and evidence path can be exercised end to end before the engine exists.
 * Press M to run it.
 */
import { applyCourtEvent, setEngineDriven } from './courtEvents'
import { useCourtStore } from './useCourtStore'

/** [delayMs, event] */
export const MOCK_SCRIPT = [
  [0, { type: 'STATE', state: 'PRE_SESSION' }],
  [400, { type: 'EVENT', event: 'ESCORT_DEFENDANT', agent: 'police' }],
  [5200, { type: 'EVENT', event: 'GAVEL', agent: 'judge', camera: 'CAMERA_JUDGE' }],
  [5400, { type: 'DIALOGUE', agent: 'judge', text: 'This court is now in session.' }],
  [7600, { type: 'STATE', state: 'OPENING_STATEMENTS' }],
  [7700, {
    type: 'ANIMATION', event: 'PROSECUTOR_OPENING', agent: 'prosecutor',
    animation: 'STAND', camera: 'CAMERA_PROSECUTOR',
  }],
  [8900, {
    type: 'DIALOGUE', agent: 'prosecutor', animation: 'SPEAK_GESTURE',
    text: 'Your honour, the state will show the defendant was present that night.',
  }],
  [12000, {
    type: 'EVENT', event: 'SHOW_EVIDENCE', agent: 'prosecutor',
    evidence: 'EXHIBIT_A', camera: 'CAMERA_EVIDENCE',
  }],
  [18000, {
    type: 'EVENT', event: 'OBJECTION', agent: 'defense',
    text: 'Objection — speculation.',
    // The ruling belongs to whoever is playing the engine, and here that is this
    // script. courtEvents.js will not invent one.
    ruling: 'Sustained. The jury will disregard that.',
  }],
  [24000, { type: 'EVENT', event: 'HIDE_EVIDENCE' }],
  [24200, { type: 'EVENT', event: 'CALL_WITNESS', agent: 'clerk' }],
  [28000, { type: 'STATE', state: 'CROSS_EXAMINATION' }],
  [28100, {
    type: 'ANIMATION', event: 'WITNESS_ANSWERS', agent: 'witness',
    animation: 'NOD', camera: 'CAMERA_WITNESS',
  }],
  [30500, {
    type: 'ANIMATION', event: 'DEFENDANT_REACTS', agent: 'defendant',
    animation: 'NERVOUS', camera: 'CAMERA_DEFENDANT',
  }],
  [33500, { type: 'CAMERA', camera: 'CAMERA_WIDE' }],
  [33700, { type: 'STATE', state: 'IN_SESSION' }],
]

let timers = []
let running = false

export function startMockFeed(script = MOCK_SCRIPT) {
  stopMockFeed()
  running = true
  // The mock script speaks the coarse EVENT vocabulary, where one name stands for
  // a whole passage of action, so hand the floor back to the local composites.
  setEngineDriven(false)
  useCourtStore.getState().setConnection('mock')
  timers = script.map(([at, event]) =>
    setTimeout(() => {
      if (running) applyCourtEvent(event)
    }, at),
  )
  const last = script.length ? script[script.length - 1][0] : 0
  timers.push(
    setTimeout(() => {
      running = false
      useCourtStore.getState().setConnection('offline')
    }, last + 500),
  )
  return true
}

export function stopMockFeed() {
  running = false
  for (const t of timers) clearTimeout(t)
  timers = []
}

export function isMockRunning() {
  return running
}

/** Emit a single event by hand — handy from the console. */
export function emit(event) {
  return applyCourtEvent(event)
}

if (typeof window !== 'undefined') {
  window.courtMock = { startMockFeed, stopMockFeed, emit, MOCK_SCRIPT }
}
