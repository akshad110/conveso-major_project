/**
 * The action vocabulary — the only language an AI agent is allowed to speak.
 *
 * This module is the contract at the centre of the whole engine. An LLM returns
 * one of these action names plus some speech; it never returns a GLB clip name,
 * a camera position, a character coordinate or anything else that belongs to the
 * renderer. That separation is what lets the 3D frontend change freely without
 * touching a single prompt, and it is why every table below is expressed in
 * courtroom terms rather than Three.js terms.
 *
 *   AI decides WHAT      -> this file names the possibilities
 *   State engine decides WHETHER -> ROLE_ACTIONS + courtroomState guards
 *   Event system decides WHEN    -> eventQueue
 *   WebSocket transports
 *   Frontend decides HOW it looks
 */

/** Every action the engine understands. Anything else is rejected outright. */
export const ACTIONS = {
  SPEAK: 'SPEAK',
  STAND: 'STAND',
  SIT: 'SIT',
  QUESTION_WITNESS: 'QUESTION_WITNESS',
  ANSWER: 'ANSWER',
  OBJECT: 'OBJECT',
  RULE: 'RULE',
  PRESENT_EVIDENCE: 'PRESENT_EVIDENCE',
  SHOW_EVIDENCE: 'SHOW_EVIDENCE',
  GAVEL: 'GAVEL',
  POINT: 'POINT',
  REACT: 'REACT',
  ADMIT_EVIDENCE: 'ADMIT_EVIDENCE',
  EXCLUDE_EVIDENCE: 'EXCLUDE_EVIDENCE',
  LISTEN: 'LISTEN',
  WAIT: 'WAIT',
}

export const ACTION_LIST = Object.keys(ACTIONS)

/** Court roles. Matches the frontend's AGENTS list exactly. */
export const ROLES = {
  JUDGE: 'judge',
  PROSECUTOR: 'prosecutor',
  DEFENSE: 'defense',
  WITNESS: 'witness',
  DEFENDANT: 'defendant',
  CLERK: 'clerk',
  POLICE: 'police',
}

export const ROLE_LIST = Object.values(ROLES)

/**
 * The roles that can be put in the box and asked questions.
 *
 * Everything that follows from "this person is giving evidence" keys off this
 * one set rather than testing for two named roles in a dozen places: the
 * knowledge fence in the prompts, the answering brain in the offline provider,
 * the witness memory on the agent, the record of what they have already said.
 *
 * The police are on it because an investigating officer is a witness — usually
 * the prosecution's first. Being on the list is not the same as being in the
 * box: the turn manager only ever puts the question to whoever the court has
 * actually seated, so an officer standing behind the dock is asked nothing.
 */
export const EVIDENCE_GIVING_ROLES = new Set([ROLES.WITNESS, ROLES.DEFENDANT, ROLES.POLICE])

/** True if this role can be called to give evidence. */
export function givesEvidence(role) {
  return EVIDENCE_GIVING_ROLES.has(role)
}

/**
 * What each role is permitted to do, ever — before phase or context is even
 * considered. This is the first gate in the validator and it encodes real
 * courtroom standing: a witness has no standing to object, only the bench can
 * rule or admit evidence, and the police and clerk are not advocates.
 */
export const ROLE_ACTIONS = {
  judge: [
    ACTIONS.SPEAK, ACTIONS.RULE, ACTIONS.GAVEL, ACTIONS.ADMIT_EVIDENCE,
    ACTIONS.EXCLUDE_EVIDENCE, ACTIONS.LISTEN, ACTIONS.WAIT, ACTIONS.REACT,
    ACTIONS.POINT, ACTIONS.QUESTION_WITNESS,
  ],
  prosecutor: [
    ACTIONS.SPEAK, ACTIONS.STAND, ACTIONS.SIT, ACTIONS.QUESTION_WITNESS,
    ACTIONS.OBJECT, ACTIONS.PRESENT_EVIDENCE, ACTIONS.SHOW_EVIDENCE,
    ACTIONS.POINT, ACTIONS.REACT, ACTIONS.LISTEN, ACTIONS.WAIT,
  ],
  defense: [
    ACTIONS.SPEAK, ACTIONS.STAND, ACTIONS.SIT, ACTIONS.QUESTION_WITNESS,
    ACTIONS.OBJECT, ACTIONS.PRESENT_EVIDENCE, ACTIONS.SHOW_EVIDENCE,
    ACTIONS.POINT, ACTIONS.REACT, ACTIONS.LISTEN, ACTIONS.WAIT,
  ],
  // A witness answers what is asked and nothing more. No objecting, no
  // volunteering evidence, no addressing the court unprompted.
  witness: [ACTIONS.ANSWER, ACTIONS.SPEAK, ACTIONS.REACT, ACTIONS.LISTEN, ACTIONS.WAIT],
  // The defendant may answer if called, and may react. Counsel speaks for them.
  defendant: [ACTIONS.ANSWER, ACTIONS.REACT, ACTIONS.STAND, ACTIONS.SIT, ACTIONS.LISTEN, ACTIONS.WAIT],
  // Administrative only — announces, logs, reads. Never argues merits.
  clerk: [ACTIONS.SPEAK, ACTIONS.LISTEN, ACTIONS.WAIT, ACTIONS.STAND, ACTIONS.SIT],
  // A police officer is in court for two different reasons, and the list has to
  // cover both. Standing behind the accused she does nothing but watch. Called
  // to the box as the investigating officer — which is what the prosecution's
  // first witness usually is — she answers what is put to her, on exactly the
  // same terms as any other witness. She still cannot object, tender evidence
  // or address the court: those are counsel's, and are not on this list.
  //
  // Standing alone does not let her speak out of turn. The turn manager only
  // gives the answering turn to whoever the court has actually seated.
  police: [
    ACTIONS.ANSWER, ACTIONS.SPEAK, ACTIONS.REACT,
    ACTIONS.LISTEN, ACTIONS.WAIT, ACTIONS.STAND,
  ],
}

/**
 * Actions that carry spoken dialogue. Used to decide whether an event opens a
 * STREAM_START/TOKEN/END cycle, and later where TTS attaches.
 */
export const SPEAKING_ACTIONS = new Set([
  ACTIONS.SPEAK, ACTIONS.QUESTION_WITNESS, ACTIONS.ANSWER, ACTIONS.OBJECT,
  ACTIONS.RULE, ACTIONS.PRESENT_EVIDENCE, ACTIONS.ADMIT_EVIDENCE,
  ACTIONS.EXCLUDE_EVIDENCE,
])

/**
 * Actions that may interrupt another agent mid-sentence. Only these can cause a
 * STREAM_PAUSE; everything else has to wait its turn in the queue.
 */
export const INTERRUPTING_ACTIONS = new Set([ACTIONS.OBJECT, ACTIONS.GAVEL])

/** Actions that reference an evidence item and so must pass the evidence gate. */
export const EVIDENCE_ACTIONS = new Set([
  ACTIONS.PRESENT_EVIDENCE, ACTIONS.SHOW_EVIDENCE,
  ACTIONS.ADMIT_EVIDENCE, ACTIONS.EXCLUDE_EVIDENCE,
])

/**
 * Semantic animation per action — still not a clip name.
 *
 * These are the logical action names the frontend's animationMap.js already
 * understands (it resolves them against the clips actually present on each GLB,
 * with its own fallback chain). So the engine names an intent like OBJECTION and
 * the renderer decides which authored clip that becomes. If a role has no clip
 * for it, the frontend degrades rather than breaking — that behaviour lives
 * there, on purpose, because only the frontend knows what each GLB contains.
 */
export const ACTION_ANIMATION = {
  [ACTIONS.SPEAK]: 'SPEAK',
  [ACTIONS.STAND]: 'STAND',
  [ACTIONS.SIT]: 'SIT',
  [ACTIONS.QUESTION_WITNESS]: 'SPEAK_GESTURE',
  [ACTIONS.ANSWER]: 'SPEAK',
  [ACTIONS.OBJECT]: 'OBJECTION',
  [ACTIONS.RULE]: 'GAVEL',
  [ACTIONS.PRESENT_EVIDENCE]: 'PRESENT_EVIDENCE',
  [ACTIONS.SHOW_EVIDENCE]: 'PRESENT_EVIDENCE',
  [ACTIONS.GAVEL]: 'GAVEL',
  [ACTIONS.POINT]: 'POINT',
  [ACTIONS.REACT]: 'REACT',
  [ACTIONS.ADMIT_EVIDENCE]: 'SPEAK',
  [ACTIONS.EXCLUDE_EVIDENCE]: 'SPEAK',
  [ACTIONS.LISTEN]: 'LISTEN',
  [ACTIONS.WAIT]: 'LISTEN',
}

/**
 * Per-role animation overrides, for roles whose GLB genuinely lacks the general
 * choice. The witness has no speaking clip, so an ANSWER reads better as a NOD
 * than as a fallback the frontend has to guess at; the judge is seated, so a
 * REACT is a seated beat. These are hints, not commands — the frontend still has
 * the final say through resolveAction().
 */
export const ROLE_ACTION_ANIMATION = {
  witness: {
    [ACTIONS.ANSWER]: 'SPEAK',
    [ACTIONS.REACT]: 'NERVOUS',
  },
  defendant: {
    [ACTIONS.ANSWER]: 'SPEAK',
    [ACTIONS.REACT]: 'NERVOUS',
  },
  judge: {
    [ACTIONS.RULE]: 'GAVEL',
    [ACTIONS.SPEAK]: 'SPEAK',
  },
  clerk: {
    [ACTIONS.SPEAK]: 'SPEAK',
  },
}

export function animationFor(role, action) {
  return ROLE_ACTION_ANIMATION[role]?.[action] || ACTION_ANIMATION[action] || 'LISTEN'
}

/**
 * Semantic camera names. The spec asks for these bare names; the frontend maps
 * them onto its own cameraPresets.js. We emit the CAMERA_ prefixed form because
 * that is what the existing renderer already keys on, and `semanticCamera()`
 * accepts either spelling so the AI can say "JUDGE" and mean CAMERA_JUDGE.
 */
export const CAMERAS = {
  JUDGE: 'CAMERA_JUDGE',
  PROSECUTOR: 'CAMERA_PROSECUTOR',
  DEFENSE: 'CAMERA_DEFENSE',
  WITNESS: 'CAMERA_WITNESS',
  DEFENDANT: 'CAMERA_DEFENDANT',
  CLERK: 'CAMERA_CLERK',
  POLICE: 'CAMERA_POLICE',
  EVIDENCE: 'CAMERA_EVIDENCE',
  OBJECTION: 'CAMERA_PROSECUTOR',
  WIDE: 'CAMERA_WIDE',
  CLOSEUP: 'CAMERA_BENCH_REVERSE',
}

const ROLE_CAMERA = {
  judge: CAMERAS.JUDGE,
  prosecutor: CAMERAS.PROSECUTOR,
  defense: CAMERAS.DEFENSE,
  witness: CAMERAS.WITNESS,
  defendant: CAMERAS.DEFENDANT,
  clerk: CAMERAS.CLERK,
  police: CAMERAS.POLICE,
}

/** Accepts 'JUDGE', 'CAMERA_JUDGE' or a role name; always returns a real preset. */
export function semanticCamera(name) {
  if (!name) return null
  const key = String(name).toUpperCase().replace(/^CAMERA_/, '')
  return CAMERAS[key] || ROLE_CAMERA[String(name).toLowerCase()] || null
}

export function cameraForRole(role) {
  return ROLE_CAMERA[role] || CAMERAS.WIDE
}

/** Which camera an action wants, before the state machine gets an opinion. */
export function cameraForAction(role, action) {
  if (action === ACTIONS.SHOW_EVIDENCE || action === ACTIONS.PRESENT_EVIDENCE) {
    return CAMERAS.EVIDENCE
  }
  if (action === ACTIONS.RULE || action === ACTIONS.GAVEL) return CAMERAS.JUDGE
  return cameraForRole(role)
}

/**
 * Event name for the wire — a readable, greppable label like PROSECUTOR_OBJECTS
 * that the frontend logs and a human can follow in the debug panel.
 */
const EVENT_VERB = {
  [ACTIONS.OBJECT]: 'OBJECTS',
  [ACTIONS.RULE]: 'RULES',
  [ACTIONS.SPEAK]: 'SPEAKS',
  [ACTIONS.ANSWER]: 'ANSWERS',
  [ACTIONS.QUESTION_WITNESS]: 'QUESTIONS_WITNESS',
  [ACTIONS.PRESENT_EVIDENCE]: 'PRESENTS_EVIDENCE',
  [ACTIONS.SHOW_EVIDENCE]: 'SHOWS_EVIDENCE',
  [ACTIONS.ADMIT_EVIDENCE]: 'ADMITS_EVIDENCE',
  [ACTIONS.EXCLUDE_EVIDENCE]: 'EXCLUDES_EVIDENCE',
  [ACTIONS.GAVEL]: 'GAVELS',
  [ACTIONS.STAND]: 'STANDS',
  [ACTIONS.SIT]: 'SITS',
  [ACTIONS.POINT]: 'POINTS',
  [ACTIONS.REACT]: 'REACTS',
  [ACTIONS.LISTEN]: 'LISTENS',
  [ACTIONS.WAIT]: 'WAITS',
}

export function eventNameFor(role, action) {
  const verb = EVENT_VERB[action] || String(action)
  return `${String(role).toUpperCase()}_${verb}`
}

/** Rough beat length in ms, so the queue can pace events without a renderer. */
export function estimatedDuration(action, speech = '') {
  const words = speech ? speech.trim().split(/\s+/).length : 0
  // ~2.6 words/second reads as measured courtroom delivery rather than a rush.
  const speaking = words ? Math.round((words / 2.6) * 1000) : 0
  const floor = {
    [ACTIONS.OBJECT]: 1800,
    [ACTIONS.RULE]: 1800,
    [ACTIONS.GAVEL]: 1200,
    [ACTIONS.STAND]: 900,
    [ACTIONS.SIT]: 900,
    [ACTIONS.PRESENT_EVIDENCE]: 2200,
    [ACTIONS.SHOW_EVIDENCE]: 2200,
    [ACTIONS.LISTEN]: 600,
    [ACTIONS.WAIT]: 400,
  }[action] ?? 1200
  return Math.max(floor, speaking)
}

export function isActionAllowedForRole(role, action) {
  return (ROLE_ACTIONS[role] || []).includes(action)
}

export function allowedActionsFor(role) {
  return [...(ROLE_ACTIONS[role] || [])]
}
