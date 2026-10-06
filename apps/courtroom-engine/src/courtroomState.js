/**
 * The Courtroom State Machine — the authority on what is legal right now.
 *
 * Deterministic on purpose. No LLM call happens in this file and none ever
 * should: the AI proposes, this machine disposes. Given the same state and the
 * same proposed action it always reaches the same verdict, which is what makes
 * the simulation reproducible and debuggable.
 *
 * Two things live here:
 *
 *   1. PHASES — the trial's shape, and which actions each phase permits.
 *   2. CourtroomState — the mutable record of the session: who is speaking, which
 *      witness is on the stand, whether an objection is pending, the transcript,
 *      and the event history.
 *
 * Phase legality is separate from role permission (courtroomActions.ROLE_ACTIONS).
 * A prosecutor is always *capable* of QUESTION_WITNESS; whether they may do it
 * right now depends on the phase and on whose examination it is. Keeping the two
 * gates apart means a rejection can say which rule was broken.
 */
import { ACTIONS, ROLES } from './courtroomActions.js'

export const PHASES = {
  PRE_SESSION: 'PRE_SESSION',
  COURT_OPENING: 'COURT_OPENING',
  CHARGES: 'CHARGES',
  PROSECUTION_OPENING: 'PROSECUTION_OPENING',
  DEFENSE_OPENING: 'DEFENSE_OPENING',
  DIRECT_EXAMINATION: 'DIRECT_EXAMINATION',
  CROSS_EXAMINATION: 'CROSS_EXAMINATION',
  EVIDENCE: 'EVIDENCE',
  OBJECTION: 'OBJECTION',
  JUDGE_RULING: 'JUDGE_RULING',
  CLOSING_ARGUMENTS: 'CLOSING_ARGUMENTS',
  JUDGMENT: 'JUDGMENT',
  CASE_CLOSED: 'CASE_CLOSED',
}

export const PHASE_LIST = Object.keys(PHASES)

/**
 * The ordinary forward path through a trial. OBJECTION and JUDGE_RULING are
 * deliberately absent — they are interrupts, pushed and popped around whatever
 * phase was running, which is why the state keeps a `phaseStack`.
 */
export const PHASE_ORDER = [
  PHASES.PRE_SESSION,
  PHASES.COURT_OPENING,
  PHASES.CHARGES,
  PHASES.PROSECUTION_OPENING,
  PHASES.DEFENSE_OPENING,
  PHASES.DIRECT_EXAMINATION,
  PHASES.CROSS_EXAMINATION,
  PHASES.CLOSING_ARGUMENTS,
  PHASES.JUDGMENT,
  PHASES.CASE_CLOSED,
]

/**
 * Which transitions are legal. Anything not listed is refused, so a buggy caller
 * cannot teleport the trial from opening statements to judgment.
 */
export const PHASE_TRANSITIONS = {
  [PHASES.PRE_SESSION]: [PHASES.COURT_OPENING],
  [PHASES.COURT_OPENING]: [PHASES.CHARGES, PHASES.PRE_SESSION],
  [PHASES.CHARGES]: [PHASES.PROSECUTION_OPENING],
  [PHASES.PROSECUTION_OPENING]: [PHASES.DEFENSE_OPENING, PHASES.DIRECT_EXAMINATION],
  [PHASES.DEFENSE_OPENING]: [PHASES.DIRECT_EXAMINATION],
  [PHASES.DIRECT_EXAMINATION]: [
    PHASES.CROSS_EXAMINATION, PHASES.EVIDENCE, PHASES.OBJECTION, PHASES.CLOSING_ARGUMENTS,
  ],
  [PHASES.CROSS_EXAMINATION]: [
    PHASES.DIRECT_EXAMINATION, PHASES.EVIDENCE, PHASES.OBJECTION, PHASES.CLOSING_ARGUMENTS,
  ],
  [PHASES.EVIDENCE]: [
    PHASES.DIRECT_EXAMINATION, PHASES.CROSS_EXAMINATION, PHASES.OBJECTION, PHASES.CLOSING_ARGUMENTS,
  ],
  // An objection can only resolve into a ruling.
  [PHASES.OBJECTION]: [PHASES.JUDGE_RULING],
  // A ruling returns to whatever was interrupted — the stack decides which.
  [PHASES.JUDGE_RULING]: [
    PHASES.DIRECT_EXAMINATION, PHASES.CROSS_EXAMINATION, PHASES.EVIDENCE,
    PHASES.PROSECUTION_OPENING, PHASES.DEFENSE_OPENING, PHASES.CLOSING_ARGUMENTS,
  ],
  [PHASES.CLOSING_ARGUMENTS]: [PHASES.JUDGMENT, PHASES.OBJECTION],
  [PHASES.JUDGMENT]: [PHASES.CASE_CLOSED],
  [PHASES.CASE_CLOSED]: [PHASES.PRE_SESSION],
}

/**
 * Which actions each phase permits, and for whom.
 *
 * `always` actions are permitted to any role that has standing for them (the
 * role gate still applies). `byRole` narrows further. Reading a phase entry tells
 * you the whole story of what can happen in it.
 */
const ALWAYS_QUIET = [ACTIONS.LISTEN, ACTIONS.WAIT, ACTIONS.REACT]

export const PHASE_RULES = {
  [PHASES.PRE_SESSION]: {
    always: [...ALWAYS_QUIET, ACTIONS.STAND, ACTIONS.SIT],
    byRole: { clerk: [ACTIONS.SPEAK], judge: [ACTIONS.SPEAK, ACTIONS.GAVEL] },
  },
  [PHASES.COURT_OPENING]: {
    always: [...ALWAYS_QUIET, ACTIONS.STAND, ACTIONS.SIT],
    byRole: {
      judge: [ACTIONS.SPEAK, ACTIONS.GAVEL],
      clerk: [ACTIONS.SPEAK],
    },
  },
  [PHASES.CHARGES]: {
    always: [...ALWAYS_QUIET, ACTIONS.STAND, ACTIONS.SIT],
    byRole: {
      clerk: [ACTIONS.SPEAK],
      judge: [ACTIONS.SPEAK, ACTIONS.GAVEL],
      defendant: [ACTIONS.ANSWER],
    },
  },
  [PHASES.PROSECUTION_OPENING]: {
    always: [...ALWAYS_QUIET, ACTIONS.STAND, ACTIONS.SIT],
    byRole: {
      prosecutor: [ACTIONS.SPEAK, ACTIONS.POINT, ACTIONS.PRESENT_EVIDENCE, ACTIONS.SHOW_EVIDENCE],
      // The defense may object during an opening — it happens.
      defense: [ACTIONS.OBJECT],
      judge: [ACTIONS.SPEAK, ACTIONS.GAVEL, ACTIONS.RULE],
    },
  },
  [PHASES.DEFENSE_OPENING]: {
    always: [...ALWAYS_QUIET, ACTIONS.STAND, ACTIONS.SIT],
    byRole: {
      defense: [ACTIONS.SPEAK, ACTIONS.POINT, ACTIONS.PRESENT_EVIDENCE, ACTIONS.SHOW_EVIDENCE],
      prosecutor: [ACTIONS.OBJECT],
      judge: [ACTIONS.SPEAK, ACTIONS.GAVEL, ACTIONS.RULE],
    },
  },
  [PHASES.DIRECT_EXAMINATION]: {
    always: [...ALWAYS_QUIET, ACTIONS.STAND, ACTIONS.SIT],
    byRole: {
      // examiningCounsel decides which of the two may question; see
      // canQuestionInPhase(). Both are listed so the phase gate defers to it.
      prosecutor: [
        ACTIONS.QUESTION_WITNESS, ACTIONS.SPEAK, ACTIONS.OBJECT,
        ACTIONS.PRESENT_EVIDENCE, ACTIONS.SHOW_EVIDENCE, ACTIONS.POINT,
      ],
      defense: [
        ACTIONS.QUESTION_WITNESS, ACTIONS.SPEAK, ACTIONS.OBJECT,
        ACTIONS.PRESENT_EVIDENCE, ACTIONS.SHOW_EVIDENCE, ACTIONS.POINT,
      ],
      witness: [ACTIONS.ANSWER, ACTIONS.SPEAK],
      defendant: [ACTIONS.ANSWER],
      judge: [ACTIONS.SPEAK, ACTIONS.GAVEL, ACTIONS.RULE, ACTIONS.QUESTION_WITNESS],
    },
  },
  [PHASES.CROSS_EXAMINATION]: {
    always: [...ALWAYS_QUIET, ACTIONS.STAND, ACTIONS.SIT],
    byRole: {
      prosecutor: [
        ACTIONS.QUESTION_WITNESS, ACTIONS.SPEAK, ACTIONS.OBJECT,
        ACTIONS.PRESENT_EVIDENCE, ACTIONS.SHOW_EVIDENCE, ACTIONS.POINT,
      ],
      defense: [
        ACTIONS.QUESTION_WITNESS, ACTIONS.SPEAK, ACTIONS.OBJECT,
        ACTIONS.PRESENT_EVIDENCE, ACTIONS.SHOW_EVIDENCE, ACTIONS.POINT,
      ],
      witness: [ACTIONS.ANSWER, ACTIONS.SPEAK],
      defendant: [ACTIONS.ANSWER],
      judge: [ACTIONS.SPEAK, ACTIONS.GAVEL, ACTIONS.RULE, ACTIONS.QUESTION_WITNESS],
    },
  },
  [PHASES.EVIDENCE]: {
    always: [...ALWAYS_QUIET, ACTIONS.STAND, ACTIONS.SIT],
    byRole: {
      prosecutor: [ACTIONS.PRESENT_EVIDENCE, ACTIONS.SHOW_EVIDENCE, ACTIONS.SPEAK, ACTIONS.OBJECT, ACTIONS.POINT],
      defense: [ACTIONS.PRESENT_EVIDENCE, ACTIONS.SHOW_EVIDENCE, ACTIONS.SPEAK, ACTIONS.OBJECT, ACTIONS.POINT],
      judge: [ACTIONS.ADMIT_EVIDENCE, ACTIONS.EXCLUDE_EVIDENCE, ACTIONS.SPEAK, ACTIONS.GAVEL, ACTIONS.RULE],
      clerk: [ACTIONS.SPEAK],
      witness: [ACTIONS.ANSWER],
    },
  },
  [PHASES.OBJECTION]: {
    // Once an objection is on the floor, the only thing that may happen is the
    // objection itself being stated and the bench responding. Everyone else
    // waits — that is the entire point of the phase.
    always: [ACTIONS.LISTEN, ACTIONS.WAIT, ACTIONS.REACT],
    byRole: {
      prosecutor: [ACTIONS.OBJECT, ACTIONS.SPEAK, ACTIONS.STAND],
      defense: [ACTIONS.OBJECT, ACTIONS.SPEAK, ACTIONS.STAND],
      judge: [ACTIONS.RULE, ACTIONS.GAVEL, ACTIONS.SPEAK],
    },
  },
  [PHASES.JUDGE_RULING]: {
    always: [ACTIONS.LISTEN, ACTIONS.WAIT, ACTIONS.REACT],
    byRole: {
      judge: [ACTIONS.RULE, ACTIONS.GAVEL, ACTIONS.SPEAK, ACTIONS.ADMIT_EVIDENCE, ACTIONS.EXCLUDE_EVIDENCE],
      prosecutor: [ACTIONS.SIT, ACTIONS.STAND],
      defense: [ACTIONS.SIT, ACTIONS.STAND],
    },
  },
  [PHASES.CLOSING_ARGUMENTS]: {
    always: [...ALWAYS_QUIET, ACTIONS.STAND, ACTIONS.SIT],
    byRole: {
      prosecutor: [ACTIONS.SPEAK, ACTIONS.POINT, ACTIONS.SHOW_EVIDENCE, ACTIONS.OBJECT],
      defense: [ACTIONS.SPEAK, ACTIONS.POINT, ACTIONS.SHOW_EVIDENCE, ACTIONS.OBJECT],
      judge: [ACTIONS.SPEAK, ACTIONS.GAVEL, ACTIONS.RULE],
    },
  },
  [PHASES.JUDGMENT]: {
    always: [ACTIONS.LISTEN, ACTIONS.WAIT, ACTIONS.REACT, ACTIONS.STAND],
    byRole: { judge: [ACTIONS.SPEAK, ACTIONS.GAVEL, ACTIONS.RULE] },
  },
  [PHASES.CASE_CLOSED]: {
    always: [ACTIONS.LISTEN, ACTIONS.WAIT],
    byRole: { judge: [ACTIONS.SPEAK, ACTIONS.GAVEL] },
  },
}

/** Phases in which a witness is on the stand and questioning is the business. */
export const EXAMINATION_PHASES = new Set([PHASES.DIRECT_EXAMINATION, PHASES.CROSS_EXAMINATION])

export function isPhase(name) {
  return PHASE_LIST.includes(name)
}

export function canTransition(from, to) {
  return (PHASE_TRANSITIONS[from] || []).includes(to)
}

/**
 * Does this phase permit this role to take this action, ignoring live context?
 *
 * `deponent` is the role the court has actually seated in the box, and it is the
 * one piece of live context this gate cannot do without. The table is keyed by
 * role because standing is a property of the role — but "may answer" is not: it
 * belongs to whoever is in the box, and a case whose investigating officer gives
 * evidence puts a `police` there. Without this the officer's answer was refused
 * as not available to her, the examination banked no answers, and the phase
 * never ended.
 *
 * It is deliberately narrow. The deponent inherits the box's permissions and
 * nothing else, only while the court has her seated, and only for the phase in
 * question — so an officer standing behind the dock is still refused, which is
 * the rule this is meant to express rather than a side effect of it.
 */
export function phaseAllows(phase, role, action, deponent = null) {
  const rules = PHASE_RULES[phase]
  if (!rules) return false
  if ((rules.always || []).includes(action)) return true
  if ((rules.byRole?.[role] || []).includes(action)) return true
  if (deponent && role === deponent && role !== ROLES.WITNESS) {
    return (rules.byRole?.[ROLES.WITNESS] || []).includes(action)
  }
  return false
}

/**
 * The session record.
 *
 * Everything the spec asks to be tracked lives here, and nothing else does. It
 * holds no LLM state, no sockets and no renderer concepts — an instance of this
 * can be serialised straight into a session store.
 */
export class CourtroomState {
  constructor({ caseId = null, sessionId = null } = {}) {
    this.sessionId = sessionId || `session-${Date.now().toString(36)}`
    this.caseId = caseId
    this.reset()
  }

  reset() {
    this.currentPhase = PHASES.PRE_SESSION
    /** Phases interrupted by an objection, innermost last. */
    this.phaseStack = []
    this.currentSpeaker = null
    this.activeWitness = null
    /**
     * The seated person's own role. Usually `witness`, but the accused may give
     * evidence in his own defence, and then it is the defendant answering. Kept
     * beside the id so callers do not have to go back to the case file to find
     * out who is actually in the box.
     */
    this.activeWitnessRole = null
    /** Which side is conducting the current examination. */
    this.examiningCounsel = null
    this.activeEvidence = null
    this.pendingObjection = null
    this.lastEvent = null
    this.lastQuestion = null
    this.lastAnswer = null
    /** Ordered record of everything said, for transcript and prompt context. */
    this.transcript = []
    this.admittedEvidence = []
    this.excludedEvidence = []
    this.eventHistory = []
    this.rulings = []
    this.objectionCount = 0
    this.startedAt = new Date().toISOString()
    /** Consecutive turns without anything of substance — the stall detector. */
    this.idleTurns = 0
  }

  // --- phase -----------------------------------------------------------------

  /**
   * Move to a phase, refusing illegal jumps. Returns whether it happened, rather
   * than throwing: a rejected transition is a normal outcome the caller decides
   * about, not an exception.
   */
  setPhase(next, { force = false } = {}) {
    if (!isPhase(next)) return false
    if (next === this.currentPhase) return true
    if (!force && !canTransition(this.currentPhase, next)) return false
    this.currentPhase = next
    return true
  }

  /** Push an interrupt phase (OBJECTION), remembering what to come back to. */
  pushPhase(next) {
    if (!isPhase(next)) return false
    this.phaseStack.push(this.currentPhase)
    this.currentPhase = next
    return true
  }

  /** Return to the interrupted phase. Falls back to examination, never to null. */
  popPhase() {
    const back = this.phaseStack.pop()
    if (back) {
      this.currentPhase = back
      return back
    }
    this.currentPhase = this.activeWitness ? PHASES.CROSS_EXAMINATION : PHASES.DIRECT_EXAMINATION
    return this.currentPhase
  }

  /** The next phase along the ordinary path, skipping the interrupt phases. */
  nextPhase() {
    const i = PHASE_ORDER.indexOf(this.currentPhase)
    if (i === -1 || i === PHASE_ORDER.length - 1) return null
    return PHASE_ORDER[i + 1]
  }

  advancePhase() {
    const next = this.nextPhase()
    if (!next) return null
    return this.setPhase(next) ? next : null
  }

  // --- objections ------------------------------------------------------------

  openObjection({ by, category, reason, targetQuestion }) {
    this.pendingObjection = {
      id: `obj-${++this.objectionCount}`,
      by,
      category: category || 'RELEVANCE',
      reason: reason || 'Improper question.',
      targetQuestion: targetQuestion || this.lastQuestion?.text || null,
      raisedAt: new Date().toISOString(),
      ruling: null,
    }
    this.pushPhase(PHASES.OBJECTION)
    return this.pendingObjection
  }

  /** Record the bench's decision and leave the interrupt phases behind. */
  resolveObjection(ruling) {
    if (!this.pendingObjection) return null
    const decided = { ...this.pendingObjection, ruling, decidedAt: new Date().toISOString() }
    this.rulings.push(decided)
    this.pendingObjection = null
    // The OBJECTION frame was pushed on top of the real phase; drop it and
    // return to what was interrupted.
    this.popPhase()
    return decided
  }

  // --- record ----------------------------------------------------------------

  recordEvent(event) {
    this.lastEvent = event
    this.eventHistory.push(event)
    if (this.eventHistory.length > 500) this.eventHistory.shift()
  }

  /**
   * Append to the transcript. Questions and answers are also cached on their own
   * fields because the objection engine needs the live question and the previous
   * answer far more often than it needs the whole transcript.
   */
  recordSpeech({ role, action, text, phase, played = false }) {
    if (!text) return null
    const at = phase || this.currentPhase
    const line = {
      index: this.transcript.length,
      role,
      action,
      text,
      phase: at,
      // Who was in the box when this was said, and only while the box is in use —
      // `activeWitness` outlives the examination, so tagging every line with it
      // would put the defendant's plea down as evidence from a witness who was not
      // yet sworn. The court needs this for a harder reason than tidiness: several
      // witnesses are examined in the same phase, so "how far has this examination
      // got" is only answerable per witness.
      witness: EXAMINATION_PHASES.has(at) ? this.activeWitness || null : null,
      // Whether a person spoke this line or an agent did. The court record does not
      // care, but a reader of it does.
      played: Boolean(played),
      at: new Date().toISOString(),
    }
    this.transcript.push(line)
    if (action === ACTIONS.QUESTION_WITNESS) this.lastQuestion = line
    if (action === ACTIONS.ANSWER) this.lastAnswer = line
    return line
  }

  /** The last n transcript lines, for prompt context. */
  recentTranscript(n = 8) {
    return this.transcript.slice(-n)
  }

  /** Everything this witness has already said, so answers stay consistent. */
  testimonyFor(role = ROLES.WITNESS) {
    return this.transcript.filter((l) => l.role === role && l.action === ACTIONS.ANSWER)
  }

  isAdmitted(evidenceId) {
    return this.admittedEvidence.includes(evidenceId)
  }

  // --- serialisation ---------------------------------------------------------

  /** The snapshot the frontend and the session store both consume. */
  snapshot() {
    return {
      sessionId: this.sessionId,
      caseId: this.caseId,
      currentPhase: this.currentPhase,
      phaseStack: [...this.phaseStack],
      currentSpeaker: this.currentSpeaker,
      activeWitness: this.activeWitness,
      activeWitnessRole: this.activeWitnessRole,
      examiningCounsel: this.examiningCounsel,
      activeEvidence: this.activeEvidence,
      pendingObjection: this.pendingObjection,
      lastEvent: this.lastEvent,
      lastQuestion: this.lastQuestion,
      lastAnswer: this.lastAnswer,
      transcript: this.transcript,
      admittedEvidence: [...this.admittedEvidence],
      excludedEvidence: [...this.excludedEvidence],
      rulings: this.rulings,
      eventHistory: this.eventHistory.slice(-50),
      startedAt: this.startedAt,
    }
  }
}
