/**
 * COURT_EVENT construction — the only place a validated action becomes wire JSON.
 *
 * By the time anything reaches this file it has already passed the validator, so
 * there is no rejection logic here. This is purely translation: a courtroom
 * decision on one side, the message the renderer consumes on the other.
 *
 * The shape is fixed by the spec:
 *
 *   { type, event, agent, action, animation, camera, speech, target, ... }
 *
 * `animation` is a *semantic* action name from courtroomActions (OBJECTION,
 * PRESENT_EVIDENCE, SPEAK...), never a GLB clip name. The frontend's
 * animationMap.js resolves it against the clips each character actually has and
 * falls back on its own. That boundary is deliberate and load-bearing: the engine
 * has no idea what is inside the GLBs and must not pretend to.
 */
import {
  ACTIONS, SPEAKING_ACTIONS, animationFor, cameraForAction, semanticCamera, eventNameFor,
  estimatedDuration,
} from './courtroomActions.js'

export const MESSAGE_TYPES = {
  STATE: 'STATE',
  EVENT: 'EVENT',
  COURT_EVENT: 'COURT_EVENT',
  ANIMATION: 'ANIMATION',
  DIALOGUE: 'DIALOGUE',
  CAMERA: 'CAMERA',
  STREAM_START: 'STREAM_START',
  STREAM_TOKEN: 'STREAM_TOKEN',
  STREAM_PAUSE: 'STREAM_PAUSE',
  STREAM_RESUME: 'STREAM_RESUME',
  STREAM_END: 'STREAM_END',
  ERROR: 'ERROR',
}

let sequence = 0
const nextId = () => `ev-${(++sequence).toString(36)}-${Date.now().toString(36)}`

/**
 * Build a COURT_EVENT from a decision the validator has already approved.
 *
 * @param {object} decision  { role, action, speech, reason, target, evidence, ruling, objection }
 * @param {object} context   { phase, camera, animation, interrupt }
 */
export function buildCourtEvent(decision, context = {}) {
  const role = decision.role || decision.agent
  const action = decision.action

  const animation = context.animation || animationFor(role, action)
  const camera = semanticCamera(context.camera) || cameraForAction(role, action)
  const speech = typeof decision.speech === 'string' ? decision.speech.trim() : ''

  const event = {
    type: MESSAGE_TYPES.COURT_EVENT,
    id: nextId(),
    event: context.eventName || eventNameFor(role, action),
    agent: role,
    action,
    animation,
    camera,
    speech: speech || null,
    // Who the line is addressed to. The bench for an objection, the witness for a
    // question. Carried through so a future TTS/gaze layer has it available.
    target: decision.target || defaultTarget(role, action),
    phase: context.phase || null,
    reason: decision.reason || null,
    duration: estimatedDuration(action, speech),
    speaks: SPEAKING_ACTIONS.has(action) && Boolean(speech),
    interrupt: Boolean(context.interrupt),
    at: new Date().toISOString(),
  }

  if (decision.evidence) event.evidence = decision.evidence
  if (decision.ruling) event.ruling = decision.ruling
  if (decision.objection) event.objection = decision.objection
  if (decision.fallbackFrom) event.fallbackFrom = decision.fallbackFrom
  if (decision.validation) event.validation = decision.validation
  // Whether a person or a model authored the beat. Presentation only — the
  // transcript marks it, and nothing about how the event is handled depends on it.
  if (decision.played) event.played = true

  return event
}

/** Who an action is naturally addressed to, when the AI does not say. */
function defaultTarget(role, action) {
  if (action === ACTIONS.OBJECT) return 'judge'
  if (action === ACTIONS.QUESTION_WITNESS) return 'witness'
  if (action === ACTIONS.ANSWER) return 'court'
  if (action === ACTIONS.RULE) return 'counsel'
  return null
}

/**
 * The evidence-monitor event. The existing frontend already keys the monitor off
 * `{ type: 'EVENT', event: 'SHOW_EVIDENCE' }`, so this emits exactly that
 * alongside the COURT_EVENT rather than inventing a second protocol for it.
 */
export function buildShowEvidenceEvent({ agent, evidenceId, camera }) {
  return {
    type: MESSAGE_TYPES.EVENT,
    id: nextId(),
    event: 'SHOW_EVIDENCE',
    agent,
    action: ACTIONS.PRESENT_EVIDENCE,
    evidence: evidenceId,
    animation: 'PRESENT_EVIDENCE',
    camera: semanticCamera(camera) || 'CAMERA_EVIDENCE',
    at: new Date().toISOString(),
  }
}

export function buildHideEvidenceEvent() {
  return {
    type: MESSAGE_TYPES.EVENT,
    id: nextId(),
    event: 'HIDE_EVIDENCE',
    camera: 'CAMERA_WIDE',
    at: new Date().toISOString(),
  }
}

/** A bare state announcement, so the renderer's HUD tracks the phase. */
export function buildStateEvent(phase, extra = {}) {
  return {
    type: MESSAGE_TYPES.STATE,
    id: nextId(),
    state: phase,
    ...extra,
    at: new Date().toISOString(),
  }
}

export function buildCameraEvent(camera) {
  return {
    type: MESSAGE_TYPES.CAMERA,
    id: nextId(),
    camera: semanticCamera(camera) || 'CAMERA_WIDE',
    at: new Date().toISOString(),
  }
}

// --- stream control ----------------------------------------------------------

export function buildStreamStart(agent, { text, action, camera, streaming = true } = {}) {
  return {
    type: MESSAGE_TYPES.STREAM_START,
    id: nextId(),
    agent,
    action: action || null,
    camera: semanticCamera(camera) || null,
    // The full line is included so a client that does not want token-by-token
    // rendering (or a TTS engine that needs the whole sentence) has it at once.
    text: text || '',
    // Whether STREAM_TOKENs will follow. Without this the client cannot tell a
    // line that is about to be revealed word by word from one that has already
    // arrived whole, and would either flash the full text or show nothing.
    streaming: streaming !== false,
    at: new Date().toISOString(),
  }
}

export function buildStreamToken(agent, token) {
  return { type: MESSAGE_TYPES.STREAM_TOKEN, agent, token }
}

export function buildStreamPause(agent, { reason, by } = {}) {
  return {
    type: MESSAGE_TYPES.STREAM_PAUSE,
    id: nextId(),
    agent,
    reason: reason || 'INTERRUPTED',
    by: by || null,
    at: new Date().toISOString(),
  }
}

export function buildStreamResume(agent, { from } = {}) {
  return {
    type: MESSAGE_TYPES.STREAM_RESUME,
    id: nextId(),
    agent,
    // Character offset the speaker got to before being cut off, so the client can
    // resume mid-sentence rather than restarting the line.
    from: typeof from === 'number' ? from : 0,
    at: new Date().toISOString(),
  }
}

export function buildStreamEnd(agent, { text, interrupted = false } = {}) {
  return {
    type: MESSAGE_TYPES.STREAM_END,
    id: nextId(),
    agent,
    text: text || '',
    interrupted,
    at: new Date().toISOString(),
  }
}

export function buildError(message, extra = {}) {
  return { type: MESSAGE_TYPES.ERROR, message: String(message), ...extra }
}
