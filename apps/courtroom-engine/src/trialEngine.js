/**
 * The trial orchestrator — the thing that actually runs a session.
 *
 * Every other module in this engine answers one question. This one asks them in
 * the right order and does nothing else:
 *
 *   TurnManager      whose turn is it, and what for?
 *   Agent            what would this character like to do?
 *   actionValidator  is that allowed?
 *   CourtroomState   record it, move the phase
 *   EvidenceEngine   move the exhibit
 *   ObjectionEngine  does the other side want to interrupt, and how does the bench rule?
 *   courtroomEvents  turn it into wire JSON
 *   EventQueue       play it out, one beat at a time
 *
 * So the pipeline the spec asks for is literally the shape of `#takeTurn()`:
 * AI decision -> action validator -> court state validator -> evidence validator ->
 * event queue -> WebSocket. Nothing here knows a GLB clip name, a camera coordinate
 * or a Three.js object, and nothing in the frontend has to know a courtroom rule.
 *
 * Everything is `await`ed through the queue, so events leave in order and a beat
 * finishes before the next one starts. Nothing throws out of a public method: a
 * failed turn becomes a character standing quietly, which is a courtroom beat,
 * while an exception would be a dead trial.
 */
import { EventEmitter } from 'node:events'

import {
  ACTIONS, ROLES, SPEAKING_ACTIONS, EVIDENCE_ACTIONS, allowedActionsFor,
  semanticCamera,
} from './courtroomActions.js'
import { CourtroomState, PHASES, EXAMINATION_PHASES } from './courtroomState.js'
import {
  MESSAGE_TYPES, buildCourtEvent, buildStateEvent, buildCameraEvent,
  buildShowEvidenceEvent, buildError,
} from './courtroomEvents.js'
import { validateDecision, isLegalNow, legalActionsNow } from './actionValidator.js'
import { EvidenceEngine, EVIDENCE_STATUS } from './evidenceEngine.js'
import { CaseManager, loadCase } from './caseManager.js'
import { createAgents } from './agents.js'
import { createProvider } from './llm/provider.js'
import { attachScript } from './llm/scriptedProvider.js'
import { EventQueue } from './eventQueue.js'
import { TurnManager } from './turnManager.js'
import {
  considerObjection, decideRuling, buildObjectionEvents, buildRulingEvents,
  detectGrounds, caseVocabulary, OBJECTION_CATEGORIES, RULINGS,
} from './objectionEngine.js'
import { HumanSeat, HUMAN_TYPES, PLAYABLE_ROLES, ANSWER_KINDS, SUBMIT_RESULTS } from './humanSeat.js'

/** Which witness takes the stand first. The complainant, as in an actual trial. */
/**
 * Who takes the stand first, when the case file does not say otherwise: the
 * first person in the witness list who is actually going to give evidence.
 * This used to be the string 'W_IYER', which silently meant "this engine can
 * only run the one case that happens to contain a witness of that id" — any
 * other case seated nobody, and the examination phases then had no one to
 * examine and stalled.
 *
 * It then read `role === WITNESS`, which was the same mistake wearing a
 * different hat: a case whose first witness is the investigating officer got
 * skipped over, the court opened on the second witness instead, and the officer
 * was never called at all. What decides is the case file's own `testifies`
 * flag — the same one #nextUnexaminedWitness() uses, so the first witness and
 * the running order cannot disagree.
 */
function firstWitnessOf(caseManager) {
  const roster = caseManager?.data?.witnesses || []
  const giving = roster.filter((w) => w.testifies !== false && w.role !== ROLES.CLERK)
  return (giving[0] || roster[0])?.id || null
}

/** Wrong answers a client may give on one turn before the court moves on. */
const MAX_HUMAN_REFUSALS = 8

/**
 * The words of a transcript line. `lastQuestion` and `lastAnswer` are cached
 * transcript entries, but older callers set them to bare strings, so anything
 * shown to a person is normalised on the way out.
 */
function lineText(entry) {
  if (!entry) return null
  return typeof entry === 'string' ? entry : entry.text || null
}

export class TrialEngine {
  /**
   * @param {object} opts
   * @param {string|CaseManager} [opts.caseId]  case id, path, or a ready CaseManager
   * @param {number} [opts.speed]               1 = real time, 0 = instant (tests)
   * @param {object} [opts.provider]            an LLM provider, or built from env
   * @param {boolean} [opts.stream]             stream dialogue token by token
   */
  constructor({
    caseId = undefined, speed = 1, provider = null, stream = true,
    questionsPerExamination = 3, log = null,
  } = {}) {
    this.emitter = new EventEmitter()
    this.speed = speed
    this.streamDialogue = stream
    this.questionsPerExamination = questionsPerExamination
    this.log = typeof log === 'function' ? log : () => {}

    this.caseManager = caseId instanceof CaseManager ? caseId : loadCase(caseId)
    // A case may have a performance written for it in a companion script file.
    // attachScript returns the provider untouched when there is none, so an
    // unscripted case still argues itself exactly as before.
    this.provider = attachScript(provider || createProvider({ log: false }), this.caseManager, this.log)
    this.vocabulary = caseVocabulary(this.caseManager)

    /**
     * The one seat a person can occupy. Built before reset() because reset()
     * clears it, and it broadcasts through the same emitter as everything else so
     * a client learns about it over the socket it already has.
     */
    this.seat = new HumanSeat({ broadcast: (message) => this.broadcast(message) })

    this.reset()
  }

  // --- lifecycle ---------------------------------------------------------------

  /**
   * Swap the matter before anyone has taken a seat.
   * Both shipped cases live on disk: state-v-malhotra and state-v-rane.
   */
  loadMatter(caseId) {
    if (this.running || this.driving || this.turnsTaken > 0) {
      this.broadcast(buildError('The hearing has already started.', { command: 'SET_CASE' }))
      return this.snapshot()
    }
    const id = String(caseId || '').trim()
    if (!id) {
      this.broadcast(buildError('Name a case.', { command: 'SET_CASE' }))
      return this.snapshot()
    }
    if (this.caseManager.data?.caseId === id) return this.snapshot()
    this.caseManager = loadCase(id)
    this.provider = attachScript(createProvider({ log: false }), this.caseManager, this.log)
    this.vocabulary = caseVocabulary(this.caseManager)
    this.reset()
    this.#emitState('case selected')
    return this.snapshot()
  }

  reset() {
    this.queue?.stop()
    // A person waiting on a turn that belongs to a trial being torn down is
    // waiting on nothing, and the seat itself goes back so the role screen is
    // honest about the court starting over.
    this.seat?.release('trial reset')
    this.state = new CourtroomState({ caseId: this.caseManager.id || null })
    this.evidence = new EvidenceEngine(this.caseManager.evidenceList())
    this.agents = createAgents({ caseManager: this.caseManager })
    this.turns = new TurnManager({ questionsPerExamination: this.questionsPerExamination })

    this.queue = new EventQueue({
      emit: (message) => this.broadcast(message),
      speed: this.speed,
      stream: this.streamDialogue,
    })

    this.running = false
    this.paused = false
    /** True while a driving loop is alive, so two of them can never interleave. */
    this.driving = false
    /**
     * Bumped by every reset and stop. A loop that was waiting on a person when the
     * court was torn down carries the old era and retires instead of taking a turn
     * against state that no longer belongs to it.
     */
    this.era = (this.era || 0) + 1
    this.turnsTaken = 0
    /** Rejections, degraded turns and repairs, for the debug panel. */
    this.diagnostics = []
    /** Questions already ruled on, so the same one is not objected to twice. */
    this.objectedQuestions = new Set()
    this.objectionsThisPhase = 0
    this.maxObjectionsPerPhase = 3
    /** The question an objection was just sustained against, if any. */
    this.struckQuestion = null
    /** Has the prosecution's exhibit already been tendered? Drives the detour. */
    this.evidenceTendered = false
    this.evidenceProponent = null
    this.resumeAfterEvidence = null

    this.#seatWitness(firstWitnessOf(this.caseManager))
    /** Witnesses already taken through direct and cross, so the court does not
     *  recall the same person forever. */
    this.examined = new Set()
    return this.snapshot()
  }

  onBroadcast(listener) {
    this.emitter.on('broadcast', listener)
    return () => this.emitter.off('broadcast', listener)
  }

  broadcast(message) {
    this.emitter.emit('broadcast', message)
  }

  /**
   * A runaway guard, not a trial length.
   *
   * The cap exists so a bug cannot spin the court forever; it should never be what
   * ends a hearing. So it is derived from the case rather than fixed: the standing
   * phases cost about fifteen turns, each person in the box costs two full
   * examinations, and objections are interrupts on top of all of it. A case with
   * five witnesses is legitimately twice the trial a case with two is, and a flat
   * number would quietly cut the longer one off mid-argument.
   */
  #turnBudget() {
    const box = (this.caseManager?.data?.witnesses || []).filter(
      (w) => w.testifies !== false && w.role !== ROLES.CLERK,
    ).length || 1
    const examinationTurns = box * this.questionsPerExamination * 2 * 2
    return 40 + examinationTurns * 2
  }

  /** Put the trial in motion and run until it closes or the cap is reached. */
  async start({ maxTurns = this.#turnBudget() } = {}) {
    // A loop that is already alive is told to carry on rather than being doubled.
    // This matters now that a turn can block indefinitely on a person: a pause
    // followed by a resume must not leave two loops sharing one courtroom.
    if (this.driving) {
      this.paused = false
      this.running = true
      return this.snapshot()
    }

    this.driving = true
    const era = this.era
    this.running = true
    this.paused = false
    // A previous STOP left the queue shut. Starting again reopens it, otherwise
    // this session's events would be accepted and never played.
    this.queue.resume()

    this.#emitState('trial started')
    try {
      while (this.running && !this.paused && this.era === era && this.turnsTaken < maxTurns) {
        const advanced = await this.step()
        if (!advanced) break
      }
    } finally {
      if (this.era === era) this.running = false
      this.driving = false
    }
    return this.snapshot()
  }

  /**
   * One beat of the trial. Exposed on its own so the frontend can single-step
   * through a session, which is how the whole thing gets debugged.
   *
   * @returns {Promise<boolean>} false when the trial has nothing left to do
   */
  async step() {
    if (this.state.currentPhase === PHASES.CASE_CLOSED) return false

    let turn = this.turns.nextTurn(this.state)

    // Phase exhausted: move the trial on, then look again. One retry only, so a
    // phase with nothing to do cannot spin.
    if (!turn) {
      const moved = this.#advancePhase()
      if (!moved) return false
      turn = this.turns.nextTurn(this.state)
      if (!turn) return false
    }

    await this.#takeTurn(turn)
    await this.queue.drain()
    this.#emitState()
    return true
  }

  pause() {
    this.paused = true
    this.running = false
    // Waiting on a person is the one thing a pause cannot politely wait out, so
    // the open question is withdrawn. The turn goes quiet, the loop unwinds, and
    // RESUME asks again from the same place.
    this.seat.cancel('trial paused')
    return this.snapshot()
  }

  async resume({ maxTurns = this.#turnBudget() } = {}) {
    this.paused = false
    return this.start({ maxTurns })
  }

  stop() {
    this.running = false
    this.paused = false
    this.era += 1
    this.seat.cancel('trial stopped')
    this.queue.stop()
    return this.snapshot()
  }

  // --- one turn ----------------------------------------------------------------

  /**
   * The pipeline, in the order the spec names it.
   *
   * Note what does *not* happen here: the decision is never trusted. It is asked
   * for, checked, and only then does anything else in the system see it. That is
   * true of the person playing a role as much as of the agents — step 1 is the
   * only line that knows whether a human or a model answered, and everything from
   * step 2 down cannot tell the difference.
   */
  async #takeTurn(turn) {
    this.turnsTaken += 1
    const agent = this.agents[turn.role]

    if (!agent) {
      this.#note('missing-agent', `No agent for role ${turn.role}.`)
      this.turns.completeTurn({ substantive: false })
      return
    }

    // 1. Whoever holds this role decides WHAT should happen.
    const proposed = this.seat.holds(turn.role)
      ? await this.#askPerson(turn, agent)
      : await this.#ask(agent, turn)

    // 2. The state engine decides WHETHER it is allowed.
    const verdict = validateDecision(proposed, { state: this.state, evidenceEngine: this.evidence })
    const decision = verdict.decision

    if (!verdict.ok) {
      this.#note('rejected', `${turn.role} ${proposed?.action} refused: ${verdict.rejections[0]?.message}`, {
        code: verdict.rejections[0]?.code,
        replacedWith: decision.action,
      })
    }
    if (proposed?.degraded) {
      this.#note('degraded', `${turn.role} turn ran without a live model.`)
    }

    // 3. Record it, and let it move the world.
    this.#applyDecision(decision)

    // 4. The event system decides WHEN, and the socket carries it.
    const event = buildCourtEvent(decision, {
      phase: this.state.currentPhase,
      camera: decision.camera || null,
    })
    this.queue.enqueue(event)
    this.state.recordEvent(event)

    // The evidence monitor is a second, separate message because the existing
    // frontend already keys it off EVENT/SHOW_EVIDENCE. No new protocol for it.
    if (decision.action === ACTIONS.PRESENT_EVIDENCE || decision.action === ACTIONS.SHOW_EVIDENCE) {
      if (decision.evidence) {
        this.queue.enqueue(buildShowEvidenceEvent({
          agent: decision.role, evidenceId: decision.evidence,
        }))
      }
    }

    this.turns.completeTurn({ substantive: verdict.ok })

    // 5. Does the other side want to interrupt what was just asked?
    const window = this.turns.objectionWindow(this.state, verdict.ok ? decision : null)
    if (window) await this.#runObjectionWindow(window)
  }

  /**
   * Ask an agent for a decision, handing it exactly the context it is entitled to.
   *
   * The evidence view is built from EvidenceEngine rather than from the case file,
   * because the case file holds the exhibits' *static* statuses — everything is
   * MARKED there forever. Live status lives in the register, so the judge asked to
   * rule on an exhibit sees that it has been admitted.
   *
   * The direction is written as labelled sections rather than as JSON. Both the
   * hosted providers and the offline one read prompts by label, so a labelled
   * block is understood by all of them; a JSON blob would only be understood by a
   * model good enough to infer it.
   */
  async #ask(agent, turn) {
    const evidenceView = this.evidence.all().map((item) => ({
      id: item.id,
      title: item.title,
      type: item.type,
      status: item.status,
      proponent: item.proponent,
    }))

    return agent.decide({
      state: this.state,
      provider: this.provider,
      caseManager: this.caseManager,
      phase: this.state.currentPhase,
      evidence: evidenceView,
      extra: this.#direction(turn),
    })
  }

  // --- the person at the table --------------------------------------------------

  /**
   * Ask whoever is playing this role, and keep asking until they hand over
   * something the court will accept.
   *
   * The loop is what makes a refusal feel like a courtroom instead of a form
   * error. An agent that proposes an illegal action loses its turn to a silent
   * LISTEN, which is the only fair treatment for something that cannot be told
   * why. A person *can* be told why, so they get the same turn back with the
   * court's reason attached and try again.
   *
   * An unbounded loop is safe here because every iteration blocks on a human, and
   * both exits are always open: the hand-off button, and the trial being stopped
   * underneath them.
   */
  async #askPerson(turn, agent) {
    let rejection = null
    let refusals = 0

    for (;;) {
      const prompt = this.#turnPrompt(turn, rejection)
      const answer = await this.seat.ask(prompt)

      if (answer.kind === ANSWER_KINDS.HANDOFF) {
        this.#note('handoff', `${turn.role} gave turn ${this.turnsTaken} to the AI.`)
        return this.#ask(agent, turn)
      }

      // Stopped, reset or paused while they were thinking. WAIT is legal for every
      // role, so the turn closes quietly rather than the loop hanging on a promise
      // nobody is going to answer.
      if (answer.kind !== ANSWER_KINDS.DECISION) {
        return { role: turn.role, action: ACTIONS.WAIT, speech: '' }
      }

      const proposed = this.#personDecision(prompt, answer.payload)
      const verdict = validateDecision(proposed, {
        state: this.state, evidenceEngine: this.evidence,
      })
      if (verdict.ok) return proposed

      rejection = verdict.rejections[0] || null
      refusals += 1
      this.#note('refused', `${turn.role} ${proposed.action} refused: ${rejection?.message}`, {
        code: rejection?.code, by: 'human',
      })

      // A ceiling, purely as a backstop. A person reads the reason and tries
      // something else, so they will never reach it; a client stuck in a loop
      // re-sending one rejected action would otherwise never let the trial move.
      if (refusals >= MAX_HUMAN_REFUSALS) {
        this.#note('refused', `${turn.role} turn given up after ${refusals} refusals.`, { by: 'human' })
        return verdict.decision
      }
    }
  }

  /**
   * Report on an answer the client sent, and say nothing when there is nothing
   * to say. Split out of `command()` because the same three-way decision applies
   * to submitting, handing off and passing.
   */
  #humanAnswer(type, result, complaint) {
    if (result === SUBMIT_RESULTS.STALE) {
      this.#note('seat', 'A late answer arrived after the question closed; ignored.', {
        command: type, by: 'human',
      })
    } else if (result === SUBMIT_RESULTS.IGNORED) {
      this.broadcast(buildError(complaint, { command: type }))
    }
    return this.snapshot()
  }

  /**
   * Turn what a client sent into a decision the validator can read.
   *
   * The role is taken from the seat and never from the message. A client that
   * could name its own role could put words in the judge's mouth, which is the
   * same hole as letting the frontend decide courtroom rules — so the one field
   * that confers authority is the one field the client does not get to set.
   */
  #personDecision(prompt, payload = {}) {
    // `expect` is what the script wants from this turn, which is not always
    // something the court will allow yet — the same mismatch the agents' path
    // handles by substitution. So it is only the default when it is legal.
    const fallback = prompt.actions.includes(prompt.expect)
      ? prompt.expect
      : prompt.actions[0] || ACTIONS.WAIT
    const action = String(payload.action || fallback).toUpperCase()

    // Which exhibit is a matter of record rather than of opinion, so when an
    // evidence action names none and the court has exactly one candidate, the
    // engine supplies it — the same courtesy `#direction` extends to the agents.
    const candidates = prompt.evidenceOptions?.[action] || []
    const evidence = payload.evidence
      ? String(payload.evidence).toUpperCase()
      : candidates.length === 1 ? candidates[0] : null

    return {
      role: this.seat.role,
      action,
      speech: typeof payload.speech === 'string' ? payload.speech.trim() : '',
      evidence,
      ruling: payload.ruling ? String(payload.ruling).toUpperCase() : null,
      reason: typeof payload.reason === 'string' ? payload.reason : null,
      /** Marks the beat as played rather than generated. Rides through to the wire. */
      played: true,
    }
  }

  /**
   * Everything the person needs for this turn, and nothing they are not entitled
   * to. The agents' version of this is `#direction`, and the discipline is the
   * same: the list of available actions is computed *here*, by the state engine,
   * so the buttons on screen are the court's list rather than the frontend's
   * opinion of it.
   */
  #turnPrompt(turn, rejection = null) {
    const witness = this.state.activeWitness
      ? this.caseManager.witnessProfile?.(this.state.activeWitness)
      : null

    const exhibits = this.evidence.all().map((item) => ({
      id: item.id,
      title: item.title,
      type: item.type,
      status: item.status,
      proponent: item.proponent,
    }))

    // An action that needs an exhibit cannot be judged without one, so
    // `legalActionsNow` — which probes with no exhibit named — always leaves the
    // evidence actions out. Asked once per exhibit, the same gate answers the
    // question the panel actually needs: which exhibits could this action be taken
    // against right now. Without this a judge in the EVIDENCE phase would have no
    // way to admit the very document the phase exists for.
    const evidenceOptions = {}
    for (const action of EVIDENCE_ACTIONS) {
      const ids = exhibits
        .filter((item) => isLegalNow(turn.role, action, {
          state: this.state, evidenceEngine: this.evidence, evidence: item.id,
        }).ok)
        .map((item) => item.id)
      if (ids.length) evidenceOptions[action] = ids
    }

    const plain = legalActionsNow(turn.role, {
      state: this.state, evidenceEngine: this.evidence,
    })
    // Kept in the role's own action order so the panel's buttons do not reshuffle
    // between turns.
    const actions = allowedActionsFor(turn.role)
      .filter((action) => plain.includes(action) || evidenceOptions[action])

    return {
      kind: 'TURN',
      role: turn.role,
      expect: turn.expect,
      note: turn.note,
      phase: this.state.currentPhase,
      turnNumber: this.turnsTaken,
      actions,
      evidenceOptions,
      speaks: [...SPEAKING_ACTIONS],
      evidence: exhibits,
      witness: witness
        ? {
          id: this.state.activeWitness,
          name: witness.name,
          role: witness.officialRole || witness.role || null,
        }
        : null,
      question: lineText(this.state.lastQuestion),
      answer: lineText(this.state.lastAnswer),
      struck: this.struckQuestion || null,
      objection: this.state.pendingObjection || null,
      rulings: turn.expect === ACTIONS.RULE ? [RULINGS.SUSTAIN, RULINGS.OVERRULE] : null,
      rejection: rejection ? { code: rejection.code, message: rejection.message } : null,
    }
  }

  /**
   * Offer the objection to the person holding opposing counsel.
   *
   * The offer is still gated on `detectGrounds`, exactly as the AI's is: counsel
   * is prompted when there is something objectionable about the question, not
   * after every question, because a panel that lit up on every line would be a
   * clicking exercise rather than a trial. What they get, and an agent does not,
   * is the grounds spelled out.
   *
   * They may name any ground, including one detection did not find. That is real —
   * counsel is entitled to a bad objection — and the bench then overrules it,
   * which is the correct answer to a bad objection.
   */
  async #offerObjection({ objector, askedBy, question }) {
    const grounds = detectGrounds(question, {
      phase: this.state.currentPhase,
      askedBy,
      vocabulary: this.vocabulary,
      evidenceEngine: this.evidence,
      transcript: this.state.transcript || [],
    })

    const answer = await this.seat.ask({
      kind: 'OBJECTION',
      role: objector,
      expect: ACTIONS.OBJECT,
      phase: this.state.currentPhase,
      turnNumber: this.turnsTaken,
      note: `${askedBy === ROLES.PROSECUTOR ? 'The prosecution' : 'The defence'} has put a `
        + 'question to the witness. Object now, or let it stand.',
      question: typeof question === 'string' ? question : question?.text || '',
      askedBy,
      actions: [ACTIONS.OBJECT],
      grounds: grounds.map((g) => ({
        category: g.category,
        label: OBJECTION_CATEGORIES[g.category]?.label || g.category,
        note: g.note || null,
        confidence: g.confidence ?? null,
      })),
      categories: Object.entries(OBJECTION_CATEGORIES).map(([category, meta]) => ({
        category, label: meta.label, explains: meta.explains,
      })),
    })

    if (answer.kind === ANSWER_KINDS.HANDOFF) {
      this.#note('handoff', `${objector} left the objection call to the AI.`)
      return considerObjection({
        agent: this.agents[objector],
        provider: this.provider,
        caseManager: this.caseManager,
        question,
        askedBy,
        state: this.state,
        evidenceEngine: this.evidence,
        vocabulary: this.vocabulary,
      })
    }

    if (answer.kind !== ANSWER_KINDS.DECISION) {
      return { object: false, source: 'human-passed', grounds }
    }

    const payload = answer.payload || {}
    if (String(payload.action || ACTIONS.OBJECT).toUpperCase() !== ACTIONS.OBJECT) {
      return { object: false, source: 'human-declined', grounds }
    }

    const named = String(payload.category || '').toUpperCase()
    const category = OBJECTION_CATEGORIES[named] ? named : grounds[0]?.category || 'RELEVANCE'
    const meta = OBJECTION_CATEGORIES[category] || {}
    const speech = typeof payload.speech === 'string' && payload.speech.trim()
      ? payload.speech.trim()
      : meta.phrase || 'Objection.'

    // An objection is an action like any other, so it is checked like any other.
    // Losing the objection costs the offer and nothing else — the question simply
    // stands — which is why this refuses rather than re-asking.
    const checked = validateDecision(
      { role: objector, action: ACTIONS.OBJECT, speech },
      { state: this.state, evidenceEngine: this.evidence },
    )
    if (!checked.ok) {
      this.#note('refused', `${objector} OBJECT refused: ${checked.rejections[0]?.message}`, {
        code: checked.rejections[0]?.code, by: 'human',
      })
      return { object: false, source: 'human-refused', grounds }
    }

    return {
      object: true,
      category,
      speech,
      reason: typeof payload.reason === 'string' && payload.reason.trim()
        ? payload.reason.trim()
        : grounds.find((g) => g.category === category)?.note || meta.explains || null,
      source: 'human',
      grounds,
      played: true,
    }
  }

  /**
   * Put the objection to the person on the bench.
   *
   * Only the ruling is theirs to give; the words are optional and the bench's
   * standard phrasing fills in. The result goes through the same validation the
   * AI judge's does — see the caller — so a person on the bench is a person
   * exercising the bench's authority, not a person bypassing it.
   */
  async #askBench({ objection, category, confidence, question }) {
    const meta = OBJECTION_CATEGORIES[category] || {}
    const fallback = () => decideRuling({
      judge: this.agents[ROLES.JUDGE],
      provider: this.provider,
      caseManager: this.caseManager,
      state: this.state,
      objection,
      confidence,
    })

    let rejection = null
    for (;;) {
      const answer = await this.seat.ask({
        kind: 'RULING',
        role: ROLES.JUDGE,
        expect: ACTIONS.RULE,
        phase: this.state.currentPhase,
        turnNumber: this.turnsTaken,
        note: `The ${objection.by === ROLES.PROSECUTOR ? 'prosecution' : 'defence'} objects. `
          + 'Sustain it or overrule it.',
        actions: [ACTIONS.RULE],
        rulings: [RULINGS.SUSTAIN, RULINGS.OVERRULE],
        objection: {
          ...objection,
          label: meta.label || category,
          explains: meta.explains || null,
        },
        question: typeof question === 'string' ? question : question?.text || '',
        rejection,
      })

      // The bench cannot decline to rule, so a hand-off or a torn-down trial both
      // fall back to the AI judge rather than leaving the objection open.
      if (answer.kind !== ANSWER_KINDS.DECISION) {
        if (answer.kind === ANSWER_KINDS.HANDOFF) {
          this.#note('handoff', 'The bench left the ruling to the AI.')
        }
        return fallback()
      }

      const ruling = String(answer.payload?.ruling || '').toUpperCase()
      if (ruling !== RULINGS.SUSTAIN && ruling !== RULINGS.OVERRULE) {
        rejection = { code: 'NO_RULING', message: 'Sustain or overrule — the court needs one or the other.' }
        continue
      }

      const speech = typeof answer.payload?.speech === 'string' && answer.payload.speech.trim()
        ? answer.payload.speech.trim()
        : ruling === RULINGS.SUSTAIN
          ? 'Sustained.'
          : 'Overruled. Counsel may answer.'

      return {
        ruling,
        speech,
        reason: typeof answer.payload?.reason === 'string' ? answer.payload.reason : null,
        source: 'human',
        played: true,
      }
    }
  }

  /**
   * What this turn is for. Telling an agent that is the difference between a
   * courtroom and a group chat.
   *
   * The turn number is in here for a reason beyond bookkeeping: the offline
   * provider seeds its choices from the prompt text, so a counter guarantees the
   * prompt differs between turns and the same question is not asked twice in a row.
   */
  #direction(turn) {
    const lines = []
    lines.push(`THIS TURN: you are expected to ${turn.expect}. ${turn.note}`)
    lines.push(`TURN NUMBER: ${this.turnsTaken}`)
    lines.push(`LEGAL ACTIONS NOW: ${legalActionsNow(turn.role, {
      state: this.state, evidenceEngine: this.evidence,
    }).join(', ')}`)

    const witness = this.state.activeWitness
      ? this.caseManager.witnessProfile?.(this.state.activeWitness)
      : null
    if (witness) lines.push(`WITNESS ON STAND: ${witness.name} (${witness.officialRole || witness.role})`)

    const asked = (this.state.transcript || [])
      .filter((l) => l.action === ACTIONS.QUESTION_WITNESS && l.phase === this.state.currentPhase)
      .map((l) => l.text)
    if (asked.length) {
      lines.push('ALREADY ASKED (do not repeat any of these):')
      for (const q of asked.slice(-6)) lines.push(`- ${q}`)
    }

    if (this.struckQuestion) {
      lines.push(`STRUCK QUESTION: "${this.struckQuestion}" — an objection to this was `
        + 'sustained. Ask something different, on the same subject if you wish, without the defect.')
    }

    // Which exhibit the court is dealing with. The engine names it because *which*
    // document is on the table is a matter of record, not of opinion — an agent
    // that invents an id gets refused by the evidence gate, which is correct but
    // wastes a turn. What the agent still decides is what to say about it, and
    // whether it goes in.
    if (this.state.currentPhase === PHASES.EVIDENCE) {
      const exhibit = this.state.activeEvidence
        ? this.evidence.get(this.state.activeEvidence)
        : this.#nextTenderable(this.evidenceProponent || ROLES.PROSECUTOR)
      if (exhibit) {
        lines.push(`EXHIBIT IN QUESTION: ${exhibit.id} — ${exhibit.title} `
          + `(${exhibit.type}, currently ${exhibit.status})`)
      }
    }

    // Leading newline on purpose: the agent appends this after `DIRECTION: `, and a
    // label is only a label when it starts its own line.
    return `\n${lines.join('\n')}`
  }

  /**
   * Apply a validated decision to the world: transcript, speaker, evidence, phase.
   *
   * Only this method mutates state as a result of a decision, so there is one place
   * to look when the courtroom's record and the events on the wire disagree.
   */
  #applyDecision(decision) {
    const { role, action } = decision

    this.state.currentSpeaker = role
    if (decision.speech) {
      this.state.recordSpeech({
        role,
        action,
        text: decision.speech,
        phase: this.state.currentPhase,
        played: Boolean(decision.played),
      })
    }

    switch (action) {
      case ACTIONS.PRESENT_EVIDENCE: {
        const result = this.evidence.introduce(decision.evidence, role)
        if (!result.ok) this.#note('evidence', result.reason)
        else this.state.activeEvidence = decision.evidence
        break
      }
      case ACTIONS.SHOW_EVIDENCE:
        this.state.activeEvidence = decision.evidence
        break
      case ACTIONS.ADMIT_EVIDENCE: {
        const result = this.evidence.admit(decision.evidence, role)
        if (result.ok) {
          if (!this.state.admittedEvidence.includes(decision.evidence)) {
            this.state.admittedEvidence.push(decision.evidence)
          }
        } else this.#note('evidence', result.reason)
        break
      }
      case ACTIONS.EXCLUDE_EVIDENCE: {
        const result = this.evidence.exclude(decision.evidence, role, decision.reason || 'inadmissible')
        if (result.ok) {
          if (!this.state.excludedEvidence.includes(decision.evidence)) {
            this.state.excludedEvidence.push(decision.evidence)
          }
        } else this.#note('evidence', result.reason)
        break
      }
      default:
        break
    }
  }

  // --- objections --------------------------------------------------------------

  /**
   * The target flow of the spec, end to end.
   *
   * Counsel asks -> the other side decides whether to object -> dialogue pauses ->
   * objection animation -> camera to the objecting counsel -> the bench evaluates
   * -> ruling animation -> SUSTAIN or OVERRULE -> resume -> the witness continues.
   *
   * The pause and resume are not written here: they fall out of `queue.interrupt()`,
   * which stops the line in flight, plays this sequence, and hands the floor back
   * at the character the speaker was cut off at.
   */
  async #runObjectionWindow({ objector, askedBy, question }) {
    const text = (typeof question === 'string' ? question : question?.text) || ''

    // Two guards against a loop, both of them also real courtroom behaviour. A
    // question already objected to does not get objected to twice — the bench has
    // dealt with it. And a phase has a ceiling: counsel who has been overruled
    // three times on the same examination stops interrupting.
    if (this.objectedQuestions.has(text)) return null
    if (this.objectionsThisPhase >= this.maxObjectionsPerPhase) return null

    const agent = this.agents[objector]

    // Whoever holds opposing counsel gets the call. Same gate either way — the
    // question has to be objectionable before anyone is asked about it.
    const call = this.seat.holds(objector)
      ? await this.#offerObjection({ objector, askedBy, question })
      : await considerObjection({
        agent,
        provider: this.provider,
        caseManager: this.caseManager,
        question,
        askedBy,
        state: this.state,
        evidenceEngine: this.evidence,
        vocabulary: this.vocabulary,
      })

    if (!call.object) {
      if (call.grounds?.length) {
        this.#note('objection-declined', `${objector} let a ${call.grounds[0].category} question pass (${call.source}).`)
      }
      return null
    }

    // Only now does the state machine learn about it, and only through the one
    // method that knows how to stack the interrupted phase.
    this.objectedQuestions.add(text)
    this.objectionsThisPhase += 1
    const pending = this.state.openObjection({
      by: objector,
      category: call.category,
      reason: call.reason,
      targetQuestion: typeof question === 'string' ? question : question?.text,
    })

    const objectionEvents = buildObjectionEvents({
      objector,
      category: call.category,
      speech: call.speech,
      reason: call.reason,
      targetQuestion: pending.targetQuestion,
      phase: PHASES.OBJECTION,
    })
    for (const event of objectionEvents) this.state.recordEvent(event)
    this.queue.interrupt(objectionEvents)
    this.state.recordSpeech({
      role: objector,
      action: ACTIONS.OBJECT,
      text: call.speech || `Objection. ${call.category}.`,
      phase: PHASES.OBJECTION,
      played: Boolean(call.played),
    })

    // The bench rules. Its own decision goes through the validator like anyone
    // else's — a judge cannot rule when nothing is pending, and by now something is.
    // That is true whether the bench is a model or a person: the check below is the
    // same call either way.
    const confidence = call.grounds?.find((g) => g.category === call.category)?.confidence ?? 0.6
    const bench = this.seat.holds(ROLES.JUDGE)
      ? await this.#askBench({
        objection: pending, category: call.category, confidence, question: text,
      })
      : await decideRuling({
        judge: this.agents[ROLES.JUDGE],
        provider: this.provider,
        caseManager: this.caseManager,
        state: this.state,
        objection: pending,
        confidence,
      })

    const checked = validateDecision({
      role: ROLES.JUDGE, action: ACTIONS.RULE, speech: bench.speech || 'Ruling.',
      ruling: bench.ruling, reason: bench.reason,
    }, { state: this.state, evidenceEngine: this.evidence })

    const ruling = checked.ok ? bench.ruling : RULINGS.OVERRULE
    if (!checked.ok) {
      this.#note('rejected', `Bench ruling refused: ${checked.rejections[0]?.message}`)
    }

    const rulingEvents = buildRulingEvents({
      objector, ruling, speech: bench.speech, category: call.category, reason: bench.reason,
    })
    for (const event of rulingEvents) this.state.recordEvent(event)
    this.queue.interrupt(rulingEvents)

    // Pops the OBJECTION frame and returns to the examination that was interrupted.
    const decided = this.state.resolveObjection(ruling)
    this.state.recordSpeech({
      role: ROLES.JUDGE,
      action: ACTIONS.RULE,
      text: bench.speech || `${ruling}.`,
      phase: PHASES.JUDGE_RULING,
      played: Boolean(bench.played),
    })

    // A sustained objection kills the question, so the witness must not answer it.
    // Clearing it is what makes the turn manager put counsel back on to rephrase,
    // and `struckQuestion` is what tells them what not to ask again.
    if (ruling === RULINGS.SUSTAIN) {
      this.state.lastQuestion = null
      this.struckQuestion = text
      this.turns.cursor = 0
    } else {
      this.struckQuestion = null
    }

    this.#note('objection', `${objector}: ${call.category} -> ${ruling} (${bench.source})`)
    await this.queue.drain()
    this.#emitState(`objection ${ruling.toLowerCase()}`)
    return decided
  }

  // --- phases ------------------------------------------------------------------

  /**
   * Move the trial to the next phase, doing whatever that phase needs set up
   * first: who is examining, who is on the stand, where the camera goes.
   */
  #advancePhase() {
    const from = this.state.currentPhase
    const to = this.#nextPhase(from)
    if (!to) return false
    if (!this.state.setPhase(to)) {
      this.#note('phase', `Refused transition ${from} -> ${to}.`)
      return false
    }

    this.objectionsThisPhase = 0
    this.struckQuestion = null
    this.turns.pendingProponent = to === PHASES.EVIDENCE ? this.evidenceProponent : null

    if (EXAMINATION_PHASES.has(to)) {
      // Cross-examines the same witness the other side called, which is the whole
      // point of cross — a fresh witness would make the phase meaningless.
      if (!this.state.activeWitness) this.#seatWitness(firstWitnessOf(this.caseManager))
      const witness = this.caseManager.witnessProfile?.(this.state.activeWitness)
      this.queue.enqueue(buildCourtEvent(
        {
          role: ROLES.CLERK,
          action: ACTIONS.SPEAK,
          speech: witness
            ? `Calling ${witness.name}${witness.officialRole ? `, ${witness.officialRole}` : ''}, to the witness box.`
            : 'Calling the next witness.',
        },
        { phase: to, camera: 'WITNESS', eventName: 'CALL_WITNESS' },
      ))
    } else {
      this.queue.enqueue(buildCameraEvent(to === PHASES.JUDGMENT ? 'JUDGE' : 'WIDE'))
    }

    // After the box is filled, not before: which side conducts depends on who
    // called the person now sitting in it.
    this.state.examiningCounsel = this.turns.examinerFor(to, this.#callingSideFor(this.state.activeWitness))

    this.turns.syncPhase(to)
    this.#emitState(`phase ${from} -> ${to}`)
    return true
  }

  /**
   * Which side called this person. The case file may say so outright; otherwise
   * the accused is a defence witness and everyone else is the prosecution's,
   * which is true of every case this engine has been given so far.
   */
  #callingSideFor(witnessId) {
    if (!witnessId) return null
    const profile = this.caseManager.witnessProfile?.(witnessId)
    if (profile?.calledBy) return profile.calledBy
    return profile?.role === ROLES.DEFENDANT ? ROLES.DEFENSE : ROLES.PROSECUTOR
  }

  /**
   * Which phase comes next — the script's answer, with one detour.
   *
   * A trial that never puts a document in is not a trial, and the script alone
   * would run direct straight into cross and never reach EVIDENCE. So once the
   * prosecution has finished examining its complainant, if it still holds an
   * exhibit that has only been marked, the court takes the tender before cross
   * begins. That is also the natural order in practice: counsel proves the
   * document through the witness who can speak to it, then hands over.
   *
   * The detour runs once. `EVIDENCE` has no `next` in the script precisely because
   * it is a return-to-sender phase — this method supplies the return address.
   */
  #nextPhase(from) {
    if (from === PHASES.DIRECT_EXAMINATION && !this.evidenceTendered) {
      const exhibit = this.#nextTenderable(ROLES.PROSECUTOR)
      if (exhibit) {
        this.evidenceProponent = ROLES.PROSECUTOR
        this.resumeAfterEvidence = this.turns.nextPhaseAfter(from) || PHASES.CROSS_EXAMINATION
        return PHASES.EVIDENCE
      }
    }
    if (from === PHASES.EVIDENCE) {
      this.evidenceTendered = true
      this.evidenceProponent = null
      const back = this.resumeAfterEvidence || PHASES.CROSS_EXAMINATION
      this.resumeAfterEvidence = null
      return back
    }
    // A case is not one witness. When cross of the person in the box finishes,
    // the court takes the next witness in the case file from the top rather than
    // closing the evidence after a single examination. The set guards it: every
    // witness is examined once, so this returns a witness to the stand only
    // while there is a witness who has not been on it.
    if (from === PHASES.CROSS_EXAMINATION) {
      if (this.state.activeWitness) this.examined.add(this.state.activeWitness)
      const next = this.#nextUnexaminedWitness()
      if (next) {
        this.#seatWitness(next)
        return PHASES.DIRECT_EXAMINATION
      }
    }
    return this.turns.nextPhaseAfter(from)
  }

  /** The next person in the case file who has not yet given evidence. */
  #nextUnexaminedWitness() {
    const roster = this.caseManager?.data?.witnesses || []
    // Whether someone is called turns on whether the case says they give
    // evidence, not on what uniform they are in. An investigating officer is
    // usually the most important witness the prosecution has; the escort
    // standing behind the accused is not a witness at all. The case file is
    // where that distinction belongs, so it is `testifies` that decides.
    return roster.find(
      (w) => w.testifies !== false && w.role !== ROLES.CLERK && !this.examined.has(w.id),
    )?.id || null
  }

  /** This side's next exhibit that has been marked but not yet put in. */
  #nextTenderable(role) {
    return this.evidence.all().find(
      (item) => item.proponent === role && item.status === EVIDENCE_STATUS.MARKED,
    ) || null
  }

  /** Put a witness on the stand and point that agent at the right profile. */
  #seatWitness(witnessId) {
    const profile = this.caseManager.witnessProfile?.(witnessId)
    if (!profile) return false
    this.state.activeWitness = witnessId
    // The accused is entitled to give evidence, and when he does it is the
    // defendant who answers, not the witness. Recording the seated person's own
    // role keeps the transcript honest about who spoke, and lets the turn manager
    // put the question to the right character instead of to a witness who is not
    // in the box.
    this.state.activeWitnessRole = profile.role || ROLES.WITNESS
    try {
      this.agents[this.state.activeWitnessRole]?.setWitness?.({
        witnessId, caseManager: this.caseManager,
      })
    } catch {
      this.#note('witness', `Could not scope witness ${witnessId}.`)
    }
    // Announce it. Who is standing in the box is part of the court's state, and
    // it is the one part that changes without a COURT_EVENT to carry it — the
    // snapshot otherwise reaches a client only on connect, so a renderer would
    // never hear that the officer, not the witness, is now being examined. The
    // engine says who is in the box and when; what a renderer does about it —
    // walk someone across the room, cut a camera, nothing at all — is its own
    // business and stays on its own side of the line.
    this.#emitState(`${witnessId} called to the witness box`)
    return true
  }

  /** Swap the witness on the stand mid-trial. Exposed for the developer panel. */
  callWitness(witnessId) {
    if (!this.#seatWitness(witnessId)) return false
    this.queue.enqueue(buildCourtEvent(
      { role: ROLES.CLERK, action: ACTIONS.SPEAK, speech: '' },
      { phase: this.state.currentPhase, camera: 'WITNESS', eventName: 'CALL_WITNESS' },
    ))
    return true
  }

  // --- the outside world -------------------------------------------------------

  /**
   * Commands from the frontend. Developer mode dispatches raw events straight to
   * the renderer; everything else drives the trial.
   */
  async command(payload = {}) {
    const type = String(payload.type || '').toUpperCase()
    try {
      switch (type) {
        case 'START':
        case 'START_TRIAL':
          return await this.start({ maxTurns: payload.maxTurns ?? this.#turnBudget() })
        case 'STEP':
        case 'NEXT_TURN':
          await this.step()
          return this.snapshot()
        case 'PAUSE':
          return this.pause()
        case 'RESUME':
          return await this.resume({ maxTurns: payload.maxTurns ?? this.#turnBudget() })
        case 'STOP':
          return this.stop()
        case 'RESET':
          this.stop()
          return this.reset()
        case 'CALL_WITNESS':
          this.callWitness(payload.witnessId)
          return this.snapshot()
        case 'SET_SPEED':
          this.speed = Number(payload.speed) || 1
          this.queue.speed = this.speed
          return this.snapshot()
        case 'SET_CASE':
          return this.loadMatter(payload.caseId || payload.case)

        // --- the human seat ---
        // These four are the whole client-side surface of playing a role. None of
        // them decides anything: they claim a seat, or they answer a question the
        // engine asked.
        case 'SET_HUMAN_ROLE': {
          const claimed = payload.role === null || payload.role === ''
            ? this.seat.release('seat given up')
            : this.seat.claim(payload.role)
          if (!claimed.ok) this.broadcast(buildError(claimed.reason, { command: type }))
          else this.#note('seat', `Human plays ${this.seat.role || 'nobody'}.`)
          return this.snapshot()
        }
        // Answering. Three outcomes, and only one of them is the client's fault.
        //
        // An answer that names a question the court has already closed is *late*,
        // not wrong — the court moved between the click and its arrival, which is
        // exactly what a double-clicked Send, or a click landing as a refusal comes
        // back, looks like. Shouting ERROR at a person for that is both untrue and
        // alarming, so a late answer is dropped and noted. An answer that names no
        // question at all with nothing pending is a client that lost track, and
        // that is still worth saying out loud.
        case 'HUMAN_ACTION':
          return this.#humanAnswer(
            type, this.seat.submit(payload.decision || payload), 'The court is not waiting on you.',
          )
        case 'HUMAN_HANDOFF':
          return this.#humanAnswer(
            type, this.seat.handOff(payload), 'There is no turn to hand over.',
          )
        case 'HUMAN_PASS':
          return this.#humanAnswer(
            type, this.seat.pass(payload), 'There is nothing to pass on.',
          )

        default:
          this.broadcast(buildError(`Unknown command "${type}".`))
          return this.snapshot()
      }
    } catch (error) {
      this.broadcast(buildError(String(error?.message || error), { command: type }))
      return this.snapshot()
    }
  }

  #emitState(reason = null) {
    this.broadcast(buildStateEvent(this.state.currentPhase, {
      reason,
      court: this.snapshot(),
    }))
  }

  #note(kind, message, extra = {}) {
    const entry = { kind, message, at: new Date().toISOString(), ...extra }
    this.diagnostics.push(entry)
    if (this.diagnostics.length > 200) this.diagnostics.shift()
    this.log(`[trial] ${kind}: ${message}`)
    return entry
  }

  /** Everything the frontend and the session store need, and nothing renderer-side. */
  snapshot() {
    return {
      case: {
        id: this.caseManager.id || null,
        title: this.caseManager.data?.title || null,
        // The heading a court record needs: which court, and who stands accused.
        jurisdiction: this.caseManager.data?.jurisdiction || null,
        accused: this.caseManager.data?.accused?.name || null,
        charges: this.caseManager.charges(),
      },
      phase: this.state.currentPhase,
      state: this.state.snapshot(),
      evidence: this.evidence.snapshot(),
      turn: this.turns.snapshot(),
      queue: this.queue.snapshot(),
      human: this.seat.snapshot(),
      provider: { name: this.provider?.name || 'offline', model: this.provider?.model || null },
      running: this.running,
      paused: this.paused,
      turnsTaken: this.turnsTaken,
      diagnostics: this.diagnostics.slice(-25),
      witnesses: this.caseManager.witnessRoster(ROLES.JUDGE),
    }
  }
}

export { MESSAGE_TYPES, PHASES, EVIDENCE_STATUS, semanticCamera, HUMAN_TYPES, PLAYABLE_ROLES }
