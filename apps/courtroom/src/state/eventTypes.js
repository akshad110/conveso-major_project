/**
 * Court event contract — the wire format between the AI engine and the renderer.
 *
 *   AI agent -> Courtroom State Engine -> Event Queue -> WebSocket -> this file
 *                                                                    |-> character animation
 *                                                                    |-> camera move
 *                                                                    |-> evidence monitor
 *                                                                    |-> dialogue / TTS
 *
 * Two producers speak this contract and both are supported here on purpose:
 *
 *   The AI trial (src/trialEngine.js) sends COURT_EVENT plus STREAM_* and STATE.
 *   The legacy rule-based engine (src/engine.js) — which is what Developer Mode's
 *   keyboard DISPATCH still goes through — sends ANIMATION / EVENT / STATE and
 *   spells the speaker `speaker` (sometimes as an agent *object*) rather than
 *   `agent`. Normalising both here is what lets the rest of the app stay ignorant
 *   of which engine is talking.
 *
 * The one rule that matters: `animation` on the wire is a *semantic action*
 * (OBJECTION, SPEAK_GESTURE, PRESENT_EVIDENCE), never a GLB clip name. The engine
 * has no idea what is inside the GLBs. Turning a semantic action into a clip is
 * this side's job, and it happens in two steps: `logicalAction()` below picks the
 * closest action this role actually advertises, then animationMap's
 * `resolveAction()` picks a clip that exists on the character.
 *
 * Examples:
 *
 *   { "type": "COURT_EVENT", "event": "PROSECUTOR_OBJECTS", "agent": "prosecutor",
 *     "action": "OBJECT", "animation": "OBJECTION", "camera": "CAMERA_PROSECUTOR",
 *     "speech": "Objection, Your Honour.", "phase": "CROSS_EXAMINATION",
 *     "speaks": true, "interrupt": true, "duration": 1800 }
 *
 *   { "type": "STREAM_START", "agent": "witness", "text": "I received the link..." }
 *   { "type": "STREAM_TOKEN", "agent": "witness", "token": "I " }
 *   { "type": "STREAM_PAUSE", "agent": "witness", "reason": "INTERRUPTED", "by": "prosecutor" }
 *   { "type": "STREAM_RESUME", "agent": "witness", "from": 42 }
 *   { "type": "STREAM_END", "agent": "witness", "text": "...", "interrupted": true }
 *
 *   { "type": "EVENT", "event": "SHOW_EVIDENCE", "agent": "prosecutor",
 *     "evidence": "EXHIBIT_A", "camera": "CAMERA_EVIDENCE" }
 *   { "type": "STATE", "state": "CROSS_EXAMINATION", "court": { ... } }
 *   { "type": "CAMERA", "camera": "CAMERA_WIDE" }
 */
import { actionsForRole } from '../config/animationMap'

export const EVENT_TYPES = {
  // The AI engine's primary message: one validated courtroom action.
  COURT_EVENT: 'COURT_EVENT',
  ANIMATION: 'ANIMATION',
  EVENT: 'EVENT',
  DIALOGUE: 'DIALOGUE',
  STATE: 'STATE',
  CAMERA: 'CAMERA',
  // Dialogue delivery. A spoken line is a span of time, not a moment, and an
  // objection can land in the middle of one — hence pause/resume.
  STREAM_START: 'STREAM_START',
  STREAM_TOKEN: 'STREAM_TOKEN',
  STREAM_PAUSE: 'STREAM_PAUSE',
  STREAM_RESUME: 'STREAM_RESUME',
  STREAM_END: 'STREAM_END',
  // The human seat. HUMAN_ROLE confirms who the person is playing; YOUR_TURN is
  // the court asking them for something and lists what it will accept;
  // YOUR_TURN_END says the question is closed and how (answered, handed to the
  // AI, passed, or cancelled because the trial stopped).
  HUMAN_ROLE: 'HUMAN_ROLE',
  YOUR_TURN: 'YOUR_TURN',
  YOUR_TURN_END: 'YOUR_TURN_END',
  ERROR: 'ERROR',
}

/**
 * The three seats a person may take, for the opening screen.
 *
 * Presentation only. The engine has the same list in humanSeat.js and refuses
 * anything outside it, so this cannot widen what is actually playable — a seat
 * added here and not there would simply come back as an ERROR.
 */
export const PLAYABLE_SEATS = [
  {
    role: 'judge',
    label: 'Judge',
    bench: 'The bench',
    duty: 'Rule on objections, admit or exclude evidence, and deliver the judgment.',
  },
  {
    role: 'prosecutor',
    label: 'Prosecutor',
    bench: 'For the State',
    duty: 'Open the case, examine the witness, put the exhibits in, and object when procedure slips.',
  },
  {
    role: 'defense',
    label: 'Defense lawyer',
    bench: 'For the accused',
    duty: 'Test the prosecution case, cross-examine, and object to improper questions.',
  },
]

/** Message types that only the AI engine emits. Their arrival flips engine mode. */
export const ENGINE_TYPES = new Set([
  EVENT_TYPES.COURT_EVENT,
  EVENT_TYPES.STREAM_START,
  EVENT_TYPES.STREAM_TOKEN,
  EVENT_TYPES.STREAM_PAUSE,
  EVENT_TYPES.STREAM_RESUME,
  EVENT_TYPES.STREAM_END,
  EVENT_TYPES.HUMAN_ROLE,
  EVENT_TYPES.YOUR_TURN,
  EVENT_TYPES.YOUR_TURN_END,
])

/** Named events handled by the EVENT type. */
export const NAMED_EVENTS = {
  SHOW_EVIDENCE: 'SHOW_EVIDENCE',
  HIDE_EVIDENCE: 'HIDE_EVIDENCE',
  OBJECTION: 'OBJECTION',
  SUSTAINED: 'SUSTAINED',
  OVERRULED: 'OVERRULED',
  CALL_WITNESS: 'CALL_WITNESS',
  SWEAR_IN_WITNESS: 'SWEAR_IN_WITNESS',
  ESCORT_DEFENDANT: 'ESCORT_DEFENDANT',
  GAVEL: 'GAVEL',
  RECESS: 'RECESS',
  VERDICT: 'VERDICT',
  RESET: 'RESET',
}

/**
 * The AI engine's thirteen phases, in the order a trial passes through them.
 * OBJECTION and JUDGE_RULING are interrupts rather than stations — the engine
 * pushes and pops them around whatever phase was running — so they sit at the end.
 */
export const COURT_PHASES = [
  'PRE_SESSION',
  'COURT_OPENING',
  'CHARGES',
  'PROSECUTION_OPENING',
  'DEFENSE_OPENING',
  'DIRECT_EXAMINATION',
  'EVIDENCE',
  'CROSS_EXAMINATION',
  'CLOSING_ARGUMENTS',
  'JUDGMENT',
  'CASE_CLOSED',
  'OBJECTION',
  'JUDGE_RULING',
]

/**
 * Court states the older rule-based engine and the mock feed report. Kept because
 * Developer Mode and mockEventFeed.js still use these names; the HUD only ever
 * displays whatever it is given, so the two vocabularies coexist harmlessly.
 */
export const COURT_STATES = [
  ...COURT_PHASES,
  'IN_SESSION',
  'OPENING_STATEMENTS',
  'EVIDENCE_PRESENTATION',
  'DELIBERATION',
  'VERDICT',
  'RECESS',
  'ADJOURNED',
]

/** Roles the engine may address. Anything else is ignored with a warning. */
export const AGENTS = ['judge', 'prosecutor', 'defense', 'witness', 'defendant', 'clerk', 'police']

/**
 * Semantic action -> the logical actions this side knows about, best first.
 *
 * The engine names an intent; not every role has a matching action in
 * animationMap's table (the judge has no SPEAK_GESTURE, counsel has no POINT,
 * the witness has no SIT). Rather than let those land on the role's idle, walk a
 * short chain of near-equivalents first. Anything still unmatched is passed
 * through untouched so `resolveAction()` can apply its own fallback and report it.
 */
const ANIMATION_ALIASES = {
  SPEAK: ['SPEAK', 'SPEAK_GESTURE', 'NOD', 'REACT'],
  SPEAK_GESTURE: ['SPEAK_GESTURE', 'SPEAK', 'POINT', 'NOD'],
  OBJECTION: ['OBJECTION', 'REACT', 'POINT', 'SPEAK_GESTURE'],
  GAVEL: ['GAVEL', 'REACT', 'POINT', 'SPEAK'],
  PRESENT_EVIDENCE: ['PRESENT_EVIDENCE', 'POINT', 'SPEAK_GESTURE'],
  POINT: ['POINT', 'PRESENT_EVIDENCE', 'SPEAK_GESTURE', 'REACT'],
  REACT: ['REACT', 'NERVOUS', 'SHAKE_HEAD', 'SPEAK_GESTURE'],
  NERVOUS: ['NERVOUS', 'REACT', 'SHAKE_HEAD'],
  NOD: ['NOD', 'REACT', 'SPEAK'],
  SHAKE_HEAD: ['SHAKE_HEAD', 'REACT', 'NERVOUS'],
  LISTEN: ['LISTEN'],
  STAND: ['STAND'],
  SIT: ['SIT'],
  WRITE: ['WRITE'],
  ESCORT: ['ESCORT', 'WALK'],
}

/** '__IDLE__' asks the controller for the resting pose in the current posture. */
export const REST = '__IDLE__'

/**
 * Map a semantic action from the wire onto a logical action this role advertises.
 * Never returns a GLB clip name — that decision stays inside animationMap.
 */
export function logicalAction(role, animation) {
  const name = String(animation || '').toUpperCase()
  if (!name) return null
  if (name === 'IDLE' || name === REST) return REST

  const advertised = new Set(actionsForRole(role))
  if (advertised.has(name)) return name
  for (const candidate of ANIMATION_ALIASES[name] || []) {
    if (advertised.has(candidate)) return candidate
  }
  return name
}

/**
 * Coerce whatever arrives on the socket into a predictable shape. Never throws —
 * a malformed event should be visible in the log, not fatal.
 */
export function normalizeEvent(raw) {
  let data = raw
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw)
    } catch {
      return { type: 'UNKNOWN', event: 'PARSE_ERROR', raw: String(raw).slice(0, 400) }
    }
  }
  if (!data || typeof data !== 'object') {
    return { type: 'UNKNOWN', event: 'EMPTY' }
  }

  // The legacy engine sends `event` as an object ({id, type, actor, ...}) and
  // `state` as a whole snapshot. Both are strings in the AI engine's contract, so
  // reduce them to the name and keep the payload alongside.
  const eventName = typeof data.event === 'object' && data.event
    ? data.event.type
    : data.event
  const stateIsSnapshot = data.state && typeof data.state === 'object'
  const stateName = stateIsSnapshot
    ? data.state.phase || data.state.currentPhase || null
    : data.state

  // `speaker` may be a role string or an agent object, depending on the producer.
  const speaker = typeof data.speaker === 'object' && data.speaker
    ? data.speaker.id || data.speaker.role
    : data.speaker
  const agent = data.agent || speaker || (typeof data.event === 'object' ? data.event?.actor : null)

  const speech = typeof data.speech === 'string' ? data.speech : null

  return {
    type: String(data.type || 'UNKNOWN').toUpperCase(),
    id: data.id || null,
    event: eventName ? String(eventName).toUpperCase() : null,
    agent: agent ? String(agent).toLowerCase() : null,
    /** The seat a human-seat message concerns. Null on everything else. */
    role: data.role ? String(data.role).toLowerCase() : null,
    // The courtroom action the engine validated — SPEAK, OBJECT, RULE, ANSWER...
    action: data.action ? String(data.action).toUpperCase() : null,
    animation: data.animation ? String(data.animation).toUpperCase() : null,
    camera: data.camera ? String(data.camera).toUpperCase() : null,
    evidence: data.evidence || null,
    state: stateName ? String(stateName).toUpperCase() : null,
    /**
     * True when the producer named a phase directly. The legacy engine sends a
     * whole snapshot as `state`, and its internal phase names ("idle") are not
     * courtroom phases, so the HUD should not adopt them.
     */
    stateIsPhase: typeof data.state === 'string',
    phase: data.phase ? String(data.phase).toUpperCase() : null,
    /** Full court snapshot, when one rode along. */
    court: data.court || (stateIsSnapshot ? data.state : null) || null,
    speech,
    text: typeof data.text === 'string' ? data.text : speech,
    token: typeof data.token === 'string' ? data.token : null,
    ruling: data.ruling ? String(data.ruling).toUpperCase() : null,
    objection: data.objection || null,
    reason: typeof data.reason === 'string' ? data.reason : null,
    target: data.target || null,
    by: data.by || null,
    from: typeof data.from === 'number' ? data.from : null,
    duration: typeof data.duration === 'number' ? data.duration : null,
    speaks: Boolean(data.speaks),
    /** STREAM_START only: false when the whole line arrives at once. */
    streaming: data.streaming !== false,
    interrupt: Boolean(data.interrupt),
    interrupted: Boolean(data.interrupted),
    validation: data.validation || null,
    fallbackFrom: data.fallbackFrom || null,
    message: typeof data.message === 'string' ? data.message : null,
    raw: data,
  }
}

export function isKnownAgent(agent) {
  return AGENTS.includes(agent)
}

/** Is this a phase the AI engine's state machine reports? */
export function isCourtPhase(name) {
  return COURT_PHASES.includes(String(name || '').toUpperCase())
}
