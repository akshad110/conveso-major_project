/**
 * The validation chain — the engine's answer to "may that happen?"
 *
 * An AI agent proposes; nothing it proposes reaches the wire until it has passed
 * through here. Four gates in a fixed order, cheapest and most fundamental first:
 *
 *   1. shape      — is this even a well-formed decision naming a known action?
 *   2. role       — does this role have standing for that action, ever?
 *   3. phase      — does the current phase permit it, from this role, right now?
 *   4. evidence   — if it touches an exhibit, is that reference honest?
 *
 * The important design choice is that a failure is rarely fatal. A courtroom that
 * freezes because a language model proposed something silly is useless, so the
 * default outcome of a rejection is *substitution*: the agent falls silent with a
 * LISTEN or WAIT and the reason is recorded on the event for the debug panel.
 * Only genuinely unsafe proposals — a witness trying to rule, a party trying to
 * pass off excluded evidence as admitted — are hard-rejected, and even then the
 * caller receives a safe replacement rather than an exception.
 *
 * Nothing in this file calls a model, and nothing in it knows what a GLB is.
 */
import {
  ACTIONS, ACTION_LIST, ROLE_LIST, isActionAllowedForRole, allowedActionsFor,
  EVIDENCE_ACTIONS,
} from './courtroomActions.js'
import { PHASES, phaseAllows, EXAMINATION_PHASES } from './courtroomState.js'

/** Why a decision was refused. Surfaced on the event so failures are visible. */
export const REJECTION = {
  MALFORMED: 'MALFORMED',
  UNKNOWN_ACTION: 'UNKNOWN_ACTION',
  UNKNOWN_ROLE: 'UNKNOWN_ROLE',
  ROLE_NOT_PERMITTED: 'ROLE_NOT_PERMITTED',
  PHASE_NOT_PERMITTED: 'PHASE_NOT_PERMITTED',
  NOT_YOUR_EXAMINATION: 'NOT_YOUR_EXAMINATION',
  NO_WITNESS_ON_STAND: 'NO_WITNESS_ON_STAND',
  NO_PENDING_OBJECTION: 'NO_PENDING_OBJECTION',
  OBJECTION_ALREADY_PENDING: 'OBJECTION_ALREADY_PENDING',
  NOT_QUESTIONED: 'NOT_QUESTIONED',
  EVIDENCE_UNKNOWN: 'EVIDENCE_UNKNOWN',
  EVIDENCE_NOT_YOURS: 'EVIDENCE_NOT_YOURS',
  EVIDENCE_NOT_ADMITTED: 'EVIDENCE_NOT_ADMITTED',
  EVIDENCE_GONE: 'EVIDENCE_GONE',
  EVIDENCE_MISSING_ID: 'EVIDENCE_MISSING_ID',
  NOTHING_TO_SAY: 'NOTHING_TO_SAY',
}

/** The silent actions. Always legal, never put words in anyone's mouth. */
function quietActionFor(role) {
  const allowed = allowedActionsFor(role)
  if (allowed.includes(ACTIONS.LISTEN)) return ACTIONS.LISTEN
  if (allowed.includes(ACTIONS.WAIT)) return ACTIONS.WAIT
  return allowed[0] || ACTIONS.WAIT
}

/**
 * Build the substitute decision for a rejected proposal.
 *
 * The agent's own speech is dropped on purpose. If the prosecutor tried to
 * question a witness during the defence's cross, the words they had prepared were
 * written for a turn they are not having; carrying them onto a LISTEN would put a
 * line into the transcript that nobody was entitled to say. The text survives on
 * `suppressedSpeech` so it is inspectable without being spoken.
 */
function substitute(decision, { code, message, phase }) {
  const role = decision.role
  return {
    ...decision,
    action: quietActionFor(role),
    speech: '',
    suppressedSpeech: decision.speech || null,
    evidence: null,
    ruling: null,
    fallbackFrom: decision.action,
    validation: { ok: false, replaced: true, code, message },
    phase: phase || decision.phase || null,
  }
}

function pass(decision, notes = []) {
  return {
    ok: true,
    decision: notes.length
      ? { ...decision, validation: { ok: true, replaced: false, notes } }
      : decision,
    rejections: [],
    notes,
  }
}

function replaced(decision, rejection, phase, notes = []) {
  return {
    ok: false,
    decision: substitute(decision, { ...rejection, phase }),
    rejections: [rejection],
    notes,
  }
}

// --- gate 1: shape -----------------------------------------------------------

function checkShape(decision) {
  if (!decision || typeof decision !== 'object') {
    return { code: REJECTION.MALFORMED, message: 'Decision was not an object.' }
  }
  if (!decision.role || !ROLE_LIST.includes(decision.role)) {
    return { code: REJECTION.UNKNOWN_ROLE, message: `Unknown role "${decision.role}".` }
  }
  if (!decision.action || !ACTION_LIST.includes(decision.action)) {
    return { code: REJECTION.UNKNOWN_ACTION, message: `Unknown action "${decision.action}".` }
  }
  return null
}

// --- gate 2: role standing ---------------------------------------------------

function checkRole(decision) {
  const { role, action } = decision
  if (isActionAllowedForRole(role, action)) return null
  return {
    code: REJECTION.ROLE_NOT_PERMITTED,
    // Worth naming the real-world reason: these read as courtroom rules in the
    // debug log rather than as schema violations.
    message: `A ${role} has no standing to ${action}.`,
  }
}

// --- gate 3: phase and live context -----------------------------------------

/**
 * Phase legality, then the handful of context rules that a static table cannot
 * express. These are the ones the spec calls out by name, and each is a real
 * procedural rule rather than a programming convenience.
 */
function checkPhase(decision, state) {
  const { role, action } = decision
  const phase = state?.currentPhase || PHASES.PRE_SESSION

  // The bench cannot rule into a vacuum. Nothing is pending, so there is nothing
  // to sustain or overrule.
  if (action === ACTIONS.RULE && !state?.pendingObjection) {
    return { code: REJECTION.NO_PENDING_OBJECTION, message: 'There is no objection before the court to rule on.' }
  }

  // One objection at a time. A second one while the first is undecided would
  // leave the bench with two questions and one answer.
  if (action === ACTIONS.OBJECT && state?.pendingObjection) {
    return {
      code: REJECTION.OBJECTION_ALREADY_PENDING,
      message: `An objection by the ${state.pendingObjection.by} is already before the court.`,
    }
  }

  if (!phaseAllows(phase, role, action, state?.activeWitnessRole || null)) {
    return {
      code: REJECTION.PHASE_NOT_PERMITTED,
      message: `${action} is not available to the ${role} during ${phase}.`,
    }
  }

  if (action === ACTIONS.QUESTION_WITNESS) {
    if (!EXAMINATION_PHASES.has(phase) && phase !== PHASES.EVIDENCE) {
      return {
        code: REJECTION.PHASE_NOT_PERMITTED,
        message: `Questioning happens in examination, not during ${phase}.`,
      }
    }
    if (!state?.activeWitness) {
      return { code: REJECTION.NO_WITNESS_ON_STAND, message: 'There is no witness on the stand.' }
    }
    // Only the counsel conducting this examination may question. The other side
    // gets its turn when the phase turns over — this is the rule that stops both
    // lawyers questioning the same witness at once. The bench is exempt: a judge
    // may always put a question to a witness.
    const examining = state.examiningCounsel
    if (role !== 'judge' && examining && examining !== role) {
      return {
        code: REJECTION.NOT_YOUR_EXAMINATION,
        message: `This is the ${examining}'s examination.`,
      }
    }
  }

  // A witness speaks when spoken to. Answering with no question outstanding is
  // volunteering, which is exactly what the spec's scoping rules exist to stop.
  // Confined to examination: a plea in CHARGES answers the reading of the charges,
  // not a question, and the defendant must be able to enter it.
  const inExamination = EXAMINATION_PHASES.has(phase) || phase === PHASES.EVIDENCE
  if (action === ACTIONS.ANSWER && inExamination && !state?.lastQuestion && !state?.pendingObjection) {
    return { code: REJECTION.NOT_QUESTIONED, message: 'No question is outstanding to answer.' }
  }

  return null
}

// --- gate 4: evidence --------------------------------------------------------

/**
 * Evidence honesty. The engine's evidence register is the only authority on what
 * has been admitted, so a decision that refers to an exhibit is checked against
 * it rather than against whatever the agent believes.
 */
function checkEvidence(decision, state, evidenceEngine) {
  const { role, action } = decision
  if (!EVIDENCE_ACTIONS.has(action)) return null

  const id = decision.evidence
  if (!id) {
    return { code: REJECTION.EVIDENCE_MISSING_ID, message: `${action} named no exhibit.` }
  }
  if (!evidenceEngine) return null

  const item = evidenceEngine.get?.(id)
  if (!item) {
    return { code: REJECTION.EVIDENCE_UNKNOWN, message: `No exhibit "${id}" in the register.` }
  }

  // What the action is actually claiming about the exhibit decides which test
  // applies.
  //
  //   PRESENT_EVIDENCE  tendering it. Needs party standing and ownership.
  //   SHOW_EVIDENCE     publishing it to the room on the evidence monitor, which
  //                     is an assertion that the court may rely on it. That is
  //                     exactly the reference admission exists to gate, so it is
  //                     checked as 'admitted' — counsel who wants a marked
  //                     exhibit on screen has to move it in first.
  //   ADMIT / EXCLUDE   the bench's own rulings, checked as mentions: a judge is
  //                     not a party, so 'introduce' would refuse them, and the
  //                     real gate runs inside EvidenceEngine.admit()/exclude(),
  //                     which already refuses anyone off the bench and any illegal
  //                     status transition. What this catches early is the case
  //                     worth catching: ruling on something already gone.
  const as = action === ACTIONS.PRESENT_EVIDENCE
    ? 'introduce'
    : action === ACTIONS.SHOW_EVIDENCE
      ? 'admitted'
      : 'mention'

  const verdict = evidenceEngine.canReference?.(id, role, { as })
  if (verdict && verdict.ok === false) {
    const code = /excluded|withdrawn/i.test(verdict.reason || '')
      ? REJECTION.EVIDENCE_GONE
      : /admitted/i.test(verdict.reason || '')
        ? REJECTION.EVIDENCE_NOT_ADMITTED
        : REJECTION.EVIDENCE_NOT_YOURS
    return { code, message: verdict.reason || `${role} may not reference ${id}.` }
  }

  return null
}

/**
 * A speaking action with nothing to say is not an error, but it is not an event
 * either — emitting it would animate a character mouthing silence. Downgrade it.
 */
function checkSubstance(decision) {
  const speaks = [
    ACTIONS.SPEAK, ACTIONS.QUESTION_WITNESS, ACTIONS.ANSWER, ACTIONS.OBJECT, ACTIONS.RULE,
  ].includes(decision.action)
  if (!speaks) return null
  const text = typeof decision.speech === 'string' ? decision.speech.trim() : ''
  if (text) return null
  return { code: REJECTION.NOTHING_TO_SAY, message: `${decision.action} carried no speech.` }
}

/**
 * Run a proposed decision through every gate.
 *
 * Always returns `{ ok, decision, rejections, notes }` and never throws. When
 * `ok` is false the returned `decision` is a safe substitute that the caller can
 * emit as-is, so there is no branch where the engine is left with nothing to do.
 */
export function validateDecision(decision, { state, evidenceEngine = null } = {}) {
  const phase = state?.currentPhase || PHASES.PRE_SESSION

  try {
    const shape = checkShape(decision)
    if (shape) {
      // A malformed decision has no trustworthy role, so there is no sensible
      // per-role substitute. Hand back a bare WAIT attributed to whatever role
      // was claimed, and let the caller decide whether to emit it at all.
      return {
        ok: false,
        decision: {
          role: ROLE_LIST.includes(decision?.role) ? decision.role : 'clerk',
          action: ACTIONS.WAIT,
          speech: '',
          phase,
          fallbackFrom: decision?.action ?? null,
          validation: { ok: false, replaced: true, ...shape },
        },
        rejections: [shape],
        notes: [],
      }
    }

    for (const gate of [
      () => checkRole(decision),
      () => checkPhase(decision, state),
      () => checkEvidence(decision, state, evidenceEngine),
      () => checkSubstance(decision),
    ]) {
      const failure = gate()
      if (failure) return replaced(decision, failure, phase)
    }

    return pass(decision)
  } catch (error) {
    // A bug in a gate must not be able to stop the trial.
    return replaced(
      decision || { role: 'clerk', action: ACTIONS.WAIT },
      { code: REJECTION.MALFORMED, message: `Validator error: ${String(error?.message || error)}` },
      phase,
    )
  }
}

/**
 * Would this action be legal, without producing a substitute? Used by the turn
 * manager and the objection engine to look before they leap, so they never ask an
 * agent for a decision the validator is certain to refuse.
 */
export function isLegalNow(role, action, { state, evidenceEngine = null, evidence = null } = {}) {
  const probe = { role, action, speech: '.', evidence }
  const shape = checkShape(probe)
  if (shape) return { ok: false, ...shape }
  for (const failure of [
    checkRole(probe),
    checkPhase(probe, state),
    checkEvidence(probe, state, evidenceEngine),
  ]) {
    if (failure) return { ok: false, ...failure }
  }
  return { ok: true }
}

/** Every action this role could legally take right now. Drives prompt hints. */
export function legalActionsNow(role, { state, evidenceEngine = null } = {}) {
  return allowedActionsFor(role).filter(
    (action) => isLegalNow(role, action, { state, evidenceEngine }).ok,
  )
}
