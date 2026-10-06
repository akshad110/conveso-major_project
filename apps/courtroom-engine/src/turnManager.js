/**
 * The turn manager — whose turn is it, and what are they here to do?
 *
 * The state machine says what is *legal*; this says what happens *next*. Those are
 * different questions. During direct examination it is legal for six roles to do
 * something; what should actually happen is that counsel asks and the witness
 * answers, alternately, until the examination has run its course.
 *
 * So each phase gets a small script: an ordered list of turns, a completion test,
 * and the phase to move to afterwards. The script is not a rail — an objection can
 * interrupt at any point and the phase stack puts things back — but it gives the
 * trial forward motion without an agent having to decide "should the trial move on
 * now?", which is not a judgement a language model should be making.
 *
 * No prompts, no events, no sockets. Given a state, it names a role and an intent.
 */
import { ACTIONS, ROLES } from './courtroomActions.js'
import { PHASES, EXAMINATION_PHASES } from './courtroomState.js'

/**
 * What each phase is for, expressed as turns.
 *
 * `turns` is consulted in order and cycles. `minTurns` is how much has to happen
 * before the phase can be considered finished, which is what stops a trial from
 * sprinting through examination in two questions.
 */
export const PHASE_SCRIPT = {
  [PHASES.PRE_SESSION]: {
    turns: [{ role: ROLES.CLERK, expect: ACTIONS.SPEAK, note: 'Call the court to order and announce the matter.' }],
    minTurns: 1,
    next: PHASES.COURT_OPENING,
  },
  [PHASES.COURT_OPENING]: {
    turns: [
      { role: ROLES.JUDGE, expect: ACTIONS.SPEAK, note: 'Open the session and state what is before the court.' },
      { role: ROLES.JUDGE, expect: ACTIONS.GAVEL, note: 'Bring the court to order.' },
    ],
    // Two, so the gavel actually falls. It is one of the few beats the 3D scene
    // has a distinct animation for, and skipping it would waste it.
    minTurns: 2,
    next: PHASES.CHARGES,
  },
  [PHASES.CHARGES]: {
    turns: [
      { role: ROLES.CLERK, expect: ACTIONS.SPEAK, note: 'Read the charges as framed.' },
      { role: ROLES.DEFENDANT, expect: ACTIONS.ANSWER, note: 'Enter your plea. One sentence.' },
    ],
    minTurns: 2,
    next: PHASES.PROSECUTION_OPENING,
  },
  // Openings run to two beats, not one. A single turn made counsel open a murder
  // case in one sentence, and it cost the trial its best moment: the second beat
  // is where the prosecution tenders the exhibit the court is going to argue
  // about, which is also what puts it on the courtroom monitor.
  [PHASES.PROSECUTION_OPENING]: {
    turns: [
      { role: ROLES.PROSECUTOR, expect: ACTIONS.SPEAK, note: 'Open the case for the prosecution.' },
      { role: ROLES.PROSECUTOR, expect: ACTIONS.SPEAK, note: 'Put the core of the case to the court. Tender an exhibit if it belongs here.' },
    ],
    minTurns: 2,
    next: PHASES.DEFENSE_OPENING,
  },
  [PHASES.DEFENSE_OPENING]: {
    turns: [
      { role: ROLES.DEFENSE, expect: ACTIONS.SPEAK, note: 'Open the case for the defence.' },
      { role: ROLES.DEFENSE, expect: ACTIONS.SPEAK, note: 'Put the defence case to the court in one more beat.' },
    ],
    minTurns: 2,
    next: PHASES.DIRECT_EXAMINATION,
  },
  [PHASES.DIRECT_EXAMINATION]: {
    // Examination alternates. `examiner` resolves to whichever side the state says
    // is conducting, so the same script serves direct and cross.
    turns: [
      { role: 'examiner', expect: ACTIONS.QUESTION_WITNESS, note: 'Put one question to the witness.' },
      { role: 'deponent', expect: ACTIONS.ANSWER, note: 'Answer only what was asked.' },
    ],
    minTurns: 6,
    next: PHASES.CROSS_EXAMINATION,
  },
  [PHASES.CROSS_EXAMINATION]: {
    turns: [
      { role: 'examiner', expect: ACTIONS.QUESTION_WITNESS, note: 'Put one question to the witness.' },
      { role: 'deponent', expect: ACTIONS.ANSWER, note: 'Answer only what was asked.' },
    ],
    minTurns: 6,
    next: PHASES.CLOSING_ARGUMENTS,
  },
  [PHASES.EVIDENCE]: {
    turns: [
      { role: 'proponent', expect: ACTIONS.PRESENT_EVIDENCE, note: 'Tender the exhibit and say what it proves.' },
      { role: ROLES.JUDGE, expect: ACTIONS.ADMIT_EVIDENCE, note: 'Rule on admissibility.' },
    ],
    minTurns: 2,
    next: null, // returns to whichever examination was interrupted
  },
  [PHASES.CLOSING_ARGUMENTS]: {
    turns: [
      { role: ROLES.PROSECUTOR, expect: ACTIONS.SPEAK, note: 'Close for the prosecution.' },
      { role: ROLES.DEFENSE, expect: ACTIONS.SPEAK, note: 'Close for the defence.' },
    ],
    minTurns: 2,
    next: PHASES.JUDGMENT,
  },
  [PHASES.JUDGMENT]: {
    turns: [
      { role: ROLES.JUDGE, expect: ACTIONS.SPEAK, note: 'Deliver the judgment on the evidence on record.' },
      { role: ROLES.JUDGE, expect: ACTIONS.SPEAK, note: 'Finish the judgment — the order, and any direction that follows from it.' },
      { role: ROLES.JUDGE, expect: ACTIONS.GAVEL, note: 'Close the matter.' },
    ],
    // Three, so the gavel actually falls. At two the bench was still mid-judgment
    // when the phase ran out, and the matter closed without the court ever rising.
    minTurns: 3,
    next: PHASES.CASE_CLOSED,
  },
  [PHASES.CASE_CLOSED]: { turns: [], minTurns: 0, next: null },
  // The interrupt phases have no script — the objection engine drives them start
  // to finish, which is why they are not stations on the ordinary path.
  [PHASES.OBJECTION]: { turns: [], minTurns: 0, next: null },
  [PHASES.JUDGE_RULING]: { turns: [], minTurns: 0, next: null },
}

/** Who conducts the examination in each examination phase. */
export const EXAMINER_FOR_PHASE = {
  [PHASES.DIRECT_EXAMINATION]: ROLES.PROSECUTOR,
  [PHASES.CROSS_EXAMINATION]: ROLES.DEFENSE,
}

export class TurnManager {
  constructor({ questionsPerExamination = 3 } = {}) {
    /** How many question-and-answer pairs each examination runs to. */
    this.questionsPerExamination = questionsPerExamination
    this.reset()
  }

  reset() {
    /** Turns taken in the current phase, reset on every phase change. */
    this.turnsInPhase = 0
    /** Index into the current phase's script. */
    this.cursor = 0
    this.phase = null
    this.turnCount = 0
    /** Which exhibit is being tendered, when an EVIDENCE detour is running. */
    this.pendingProponent = null
  }

  /** Notice a phase change and restart the script for the new phase. */
  syncPhase(phase) {
    if (phase === this.phase) return false
    this.phase = phase
    this.turnsInPhase = 0
    this.cursor = 0
    return true
  }

  /**
   * The next turn: `{ role, expect, note, phase }`, or null when the phase's work
   * is done and the caller should advance.
   *
   * An objection in flight always suspends the script — the bench has a question
   * in front of it and nothing else may happen until it is answered.
   */
  nextTurn(state) {
    if (!state) return null
    const phase = state.currentPhase
    this.syncPhase(phase)

    if (state.pendingObjection) {
      // The only turn available is the bench's.
      return { role: ROLES.JUDGE, expect: ACTIONS.RULE, note: 'Rule on the objection before the court.', phase }
    }

    const script = PHASE_SCRIPT[phase]
    if (!script || !script.turns.length) return null
    if (this.isPhaseComplete(state)) return null

    const slot = script.turns[this.cursor % script.turns.length]
    const role = this.#resolveRole(slot.role, state, phase)
    if (!role) return null

    return { role, expect: slot.expect, note: slot.note, phase }
  }

  /**
   * `examiner`, `proponent` and `deponent` are placeholders resolved against live
   * state, so one script covers both examinations and either side's evidence.
   */
  #resolveRole(role, state, phase) {
    if (role === 'examiner') {
      return state.examiningCounsel || EXAMINER_FOR_PHASE[phase] || ROLES.PROSECUTOR
    }
    if (role === 'proponent') {
      return this.pendingProponent || state.examiningCounsel || ROLES.PROSECUTOR
    }
    // Whoever is actually in the box answers. That is a witness almost always, and
    // the defendant when the accused elects to give evidence — asking the witness
    // to answer then would put words in the mouth of someone who is not there.
    if (role === 'deponent') {
      return state.activeWitnessRole || ROLES.WITNESS
    }
    return role
  }

  /** Record that a turn happened, whatever came of it, and move the cursor on. */
  completeTurn({ substantive = true } = {}) {
    this.turnCount += 1
    this.turnsInPhase += 1
    this.cursor += 1
    return { turnsInPhase: this.turnsInPhase, cursor: this.cursor, substantive }
  }

  /**
   * Has this phase done its job?
   *
   * Examinations end on a count of *answers*, not turns and not questions. Turns
   * would end a cross after two questions and four interruptions. Questions would
   * never end it at all: a sustained objection strikes the question, so the witness
   * never answers it, and any test of the form "every question answered" is left
   * permanently one short and the examination runs forever.
   *
   * What actually ends an examination is the witness having given the evidence
   * counsel came for, with nothing left hanging — so: enough answers, and no
   * question outstanding on the floor.
   *
   * Counted per witness, not per phase. A case calls several witnesses and each is
   * taken through the same two phases, so a count scoped only to the phase would
   * still be holding the first witness's answers when the second takes the stand,
   * and every examination after the first would end before a single question.
   */
  isPhaseComplete(state) {
    const phase = state?.currentPhase
    const script = PHASE_SCRIPT[phase]
    if (!script) return true
    if (!script.turns.length) return true

    if (EXAMINATION_PHASES.has(phase)) {
      const witness = state.activeWitness || null
      const exchange = (state.transcript || []).filter(
        (l) => l.phase === phase
          && (l.witness || null) === witness
          && (l.action === ACTIONS.QUESTION_WITNESS || l.action === ACTIONS.ANSWER),
      )
      const answered = exchange.filter((l) => l.action === ACTIONS.ANSWER).length
      const outstanding = exchange.at(-1)?.action === ACTIONS.QUESTION_WITNESS
      return answered >= this.questionsPerExamination && !outstanding
    }

    return this.turnsInPhase >= script.minTurns
  }

  /** Where this phase goes when it is finished. */
  nextPhaseAfter(phase) {
    return PHASE_SCRIPT[phase]?.next || null
  }

  /**
   * Which side should be conducting the examination in this phase. The orchestrator
   * sets `state.examiningCounsel` from this so the validator's "this is the other
   * side's examination" rule has something to check against.
   *
   * Direct belongs to the side that called the person in the box, and cross to the
   * other one. For a prosecution witness that is the table above; for the accused
   * giving evidence in his own defence it is the reverse, and getting it wrong is
   * not cosmetic — it would have the prosecution leading the defendant through his
   * own account and his own counsel cross-examining him.
   */
  examinerFor(phase, calledBy = null) {
    const standing = EXAMINER_FOR_PHASE[phase]
    if (!standing) return null
    if (!calledBy || calledBy === ROLES.PROSECUTOR) return standing
    return standing === ROLES.PROSECUTOR ? ROLES.DEFENSE : ROLES.PROSECUTOR
  }

  /**
   * Should the other side be offered the chance to object to what was just asked?
   *
   * Only a question by opposing counsel during an examination, and never while an
   * objection is already pending. Keeping this here rather than in the objection
   * engine means the expensive grounds analysis only runs at moments where an
   * objection could actually be made.
   */
  objectionWindow(state, lastDecision) {
    if (!state || state.pendingObjection) return null
    if (lastDecision?.action !== ACTIONS.QUESTION_WITNESS) return null
    if (!EXAMINATION_PHASES.has(state.currentPhase) && state.currentPhase !== PHASES.EVIDENCE) return null

    const asker = lastDecision.role
    const opponent = asker === ROLES.PROSECUTOR ? ROLES.DEFENSE
      : asker === ROLES.DEFENSE ? ROLES.PROSECUTOR
        : null
    if (!opponent) return null

    return { objector: opponent, askedBy: asker, question: lastDecision.speech }
  }

  snapshot() {
    return {
      phase: this.phase,
      turnsInPhase: this.turnsInPhase,
      cursor: this.cursor,
      turnCount: this.turnCount,
      questionsPerExamination: this.questionsPerExamination,
    }
  }
}
