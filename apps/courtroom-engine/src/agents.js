/**
 * The people in the room.
 *
 * An agent here is a character with standing, a job, a temperament and a strictly
 * bounded view of the case. The bounding is the important part: the judge does not
 * hold either side's theory, the complainant does not know what the forensic
 * examiner found, and counsel know their own case and the marked exhibits. All of
 * that scoping already lives in CaseManager, so this file asks for a view and
 * attaches it rather than deciding for itself who may know what — one place to get
 * that rule wrong is enough.
 *
 * Three things live here. AGENT_PROFILES is the static casting: names,
 * personalities, objectives and limits, stable for the whole trial. The Agent class
 * is one live participant — scoped knowledge, rolling memory, a mood that moves,
 * and a decide() that turns the present state of the courtroom into one structured
 * action. And `agents` plus the three rule-based helpers below it are the original
 * deterministic path, still exported and still working, because they are what runs
 * when there is no model to call.
 *
 * Two rules hold absolutely. Nothing in this file reads engineOnlyHiddenTruth() —
 * an agent that knew what actually happened would have nothing to argue about. And
 * no public method throws: a failed turn becomes a character standing quietly,
 * which is a legitimate courtroom beat, whereas an exception is a dead trial.
 */
import { ACTIONS, ROLES, allowedActionsFor, givesEvidence } from './courtroomActions.js'
import { PHASES } from './courtroomState.js'
import { systemPromptFor, turnPromptFor } from './llm/prompts.js'
import { parseDecision } from './llm/structuredOutput.js'
import { createWitnessMemory } from './witnessMemory.js'

/** Short-term memory cap. A turn needs the last few beats, not the whole trial. */
const MEMORY_LIMIT = 20

/**
 * The casting. `style`, `goals` and `restrictions` keep their original names and
 * wording because prompts.js and the frontend both read them; `personality`,
 * `objectives` and `speechStyle` are the fuller forms this layer works from.
 */
export const AGENT_PROFILES = {
  judge: {
    id: 'judge',
    name: 'Hon. Justice Meera Rao',
    role: 'Judge',
    style: 'calm, neutral, procedural',
    personality: 'Twenty-two years on the bench and no appetite for theatrics. Courteous to both sides, shorter with whichever one is wasting time, and entirely unmoved by volume.',
    speechStyle: 'Measured and economical. Rules in one sentence and gives the reason in the second.',
    goals: ['maintain order', 'rule on objections', 'control speaking order'],
    objectives: [
      'Keep the proceeding orderly and within procedure.',
      'Rule on every objection promptly and on the ground actually raised.',
      'Decide admissibility on the record, not on advocacy.',
      'Reach a verdict only on admitted evidence and recorded testimony.',
    ],
    restrictions: ['never reveal hidden reasoning', 'do not become biased'],
    baselineEmotion: 'composed',
  },

  prosecutor: {
    id: 'prosecutor',
    name: 'Adv. Arjun Sen',
    role: 'Prosecutor',
    style: 'analytical, firm, alert to contradictions',
    personality: 'Builds a case like a chain and dislikes a weak link more than he dislikes the defence. Confident to the point of overreading his own evidence, which is his one real fault.',
    speechStyle: 'Precise, one question at a time, returns to a dodged answer rather than moving on.',
    goals: ['present prosecution theory', 'object when procedure is violated', 'test witness credibility'],
    objectives: [
      'Prove each element of the charges from admitted evidence.',
      'Establish the accused as the person behind the counterfeit page, not merely the account.',
      'Object when a question or an argument departs from the record.',
    ],
    restrictions: ['do not invent evidence', 'reason only from accepted or pending case material'],
    baselineEmotion: 'focused',
  },

  defense: {
    id: 'defense',
    name: 'Adv. Kavya Menon',
    role: 'Defense Lawyer',
    style: 'strategic, composed, persuasive',
    personality: 'Patient, and lethal on a detail. Would rather establish one gap the court cannot unsee than score five rhetorical points.',
    speechStyle: 'Quiet, close-ended questions that leave the witness nowhere to expand.',
    goals: ['protect defendant', 'challenge weak evidence', 'present reasonable doubt'],
    objectives: [
      'Separate access to the account from identity of the offender.',
      'Expose the gaps in the investigation and in the identification evidence.',
      'Hold the prosecution to the standard of proof rather than to plausibility.',
    ],
    restrictions: ['do not misstate accepted evidence', 'stay within courtroom procedure'],
    baselineEmotion: 'composed',
  },

  witness: {
    id: 'witness',
    name: 'Ramesh Iyer',
    role: 'Witness',
    style: 'nervous, honest, limited to personal knowledge',
    personality: 'Earnest and wounded, wants to be believed, and fills the gaps in his memory without noticing that he is doing it.',
    speechStyle: 'Plain, slightly formal English. Short sentences, repeats himself when pressed.',
    goals: ['answer only questions asked', 'stay consistent with testimony'],
    objectives: [
      'Answer the question put, from personal knowledge only.',
      'Stay consistent with what has already been said on the record.',
      'Say plainly when something is not known rather than guessing at it.',
    ],
    restrictions: ['never know hidden facts', 'do not volunteer unrelated facts'],
    baselineEmotion: 'anxious',
  },

  defendant: {
    id: 'defendant',
    name: 'Dev Malhotra',
    role: 'Accused',
    style: 'articulate about technology, guarded about people',
    personality: 'Twenty-six, freelance developer, fluent about code and evasive about the flat he shares. Over-explains when nervous, which reads worse than silence would.',
    speechStyle: 'Fluent urban English that drifts into developer vocabulary and has to be pulled back.',
    goals: ['answer the court when addressed', 'explain the technical picture', 'say nothing beyond the question'],
    objectives: [
      'Answer the bench directly when addressed and not otherwise.',
      'Account for the innocent reasons his account and his code are involved.',
      'Volunteer nothing; counsel speaks for him.',
    ],
    restrictions: ['do not argue the case', 'speak only when addressed by the court', 'never claim knowledge you do not have'],
    baselineEmotion: 'anxious',
  },

  clerk: {
    id: 'clerk',
    name: 'Court Clerk',
    role: 'Court Clerk',
    style: 'formal, concise, administrative',
    personality: 'The court runs on her paperwork and she has no interest whatsoever in who wins.',
    speechStyle: 'Single-clause announcements in the passive voice.',
    goals: ['announce case', 'log exhibits', 'read documents'],
    objectives: [
      'Call the matter and read the charges when directed.',
      'Mark and record every exhibit placed before the court.',
    ],
    restrictions: ['do not argue legal merits'],
    baselineEmotion: 'neutral',
  },

  police: {
    id: 'police',
    name: 'Head Constable Latha Gowda',
    role: 'Court Security',
    style: 'watchful, silent, entirely procedural',
    personality: 'Escort and security. Watches the room, says nothing about the merits, moves only on direction from the bench.',
    speechStyle: 'Does not speak on the merits. Procedural announcements only.',
    goals: ['maintain custody and order', 'act only on direction from the bench'],
    objectives: ['Stand present and keep the accused secure.', 'Act only when the bench directs.'],
    restrictions: ['do not speak on the merits', 'do not testify'],
    baselineEmotion: 'neutral',
  },
}

/**
 * Which person occupies a role by default when the trial opens. The witness box is
 * the complainant's until the engine calls someone else, and the accused is a
 * specific person with specific blind spots rather than a generic defendant.
 */
const DEFAULT_OCCUPANT = {
  witness: 'W_IYER',
  defendant: 'D_MALHOTRA',
  police: 'P_ESCORT',
}

/**
 * Durable memory. A ruling against you, an exhibit admitted or excluded, and a
 * commitment made on the record are the three things an advocate still has to
 * account for an hour later; everything else can fall out of the rolling window.
 */
const DURABLE_EVENTS = new Set([
  'RULING', 'RULE', 'SUSTAINED', 'OVERRULED',
  'ADMIT_EVIDENCE', 'EXCLUDE_EVIDENCE', 'EVIDENCE_ADMITTED', 'EVIDENCE_EXCLUDED',
  'COMMITMENT', 'CONTRADICTION', 'VERDICT',
])

export class Agent {
  constructor({ profile, role, knowledge = null, caseManager = null, witnessId = null } = {}) {
    const p = profile || AGENT_PROFILES[role] || AGENT_PROFILES.judge

    this.id = p.id || role || 'judge'
    this.role = normaliseRole(p.id || role)
    /** The human title, for the prose line of a prompt. The engine keys off `role`. */
    this.title = p.role || this.role
    this.name = p.name || this.title

    this.personality = p.personality || p.style || 'measured, professional'
    this.style = p.style || this.personality
    this.speechStyle = p.speechStyle || 'Plain courtroom register.'
    this.objectives = [...(p.objectives || p.goals || [])]
    this.goals = [...(p.goals || [])]
    this.restrictions = [...(p.restrictions || [])]

    /** Never the whole case. Whatever CaseManager decides this participant may hold. */
    this.knowledge = knowledge || { facts: [], evidence: [], theory: null }
    /** Rolling short-term memory; `longTerm` is the part that must survive the window. */
    this.memory = []
    this.longTerm = []
    this.emotionalState = { state: p.baselineEmotion || 'neutral', intensity: 0.2 }
    /** From allowedActionsFor, so the vocabulary cannot drift out of agreement. */
    this.allowedActions = allowedActionsFor(this.role)
    this.conversationContext = emptyContext()

    /**
     * Roles that give evidence get a WitnessMemory as well. It is the thing that
     * knows what this particular person cannot be asked about and whether their
     * new answer sits with the old one, and the judge has no use for either.
     */
    this.witnessMemory = null
    if (givesEvidence(this.role)) {
      this.setWitness({ witnessId: witnessId || DEFAULT_OCCUPANT[this.role] || null, caseManager })
    }
  }

  /**
   * Put a different person in the box. The engine calls this when a new witness is
   * sworn, and both the scoped knowledge and the memory of what has been said have
   * to change together — a fresh witness who inherited the last one's testimony
   * would be a contradiction machine.
   */
  setWitness({ witnessId, caseManager, profile = null } = {}) {
    try {
      const memory = createWitnessMemory({ profile, witnessId, caseManager })
      this.witnessMemory = memory
      if (memory.name && memory.name !== memory.id) this.name = memory.name
      if (memory.officialRole) this.title = memory.officialRole
      if (memory.personality) this.personality = memory.personality
      if (memory.speechStyle) this.speechStyle = memory.speechStyle
      if (memory.knowledge) this.knowledge = memory.knowledge
      this.emotionalState = { ...memory.emotionalState }
      return memory
    } catch {
      return this.witnessMemory
    }
  }

  // --- knowledge ---------------------------------------------------------------

  /** Re-scope from the case file, for when a fact becomes of record mid-trial. */
  attachKnowledge(caseManager, who = null) {
    try {
      if (!caseManager || typeof caseManager.knowledgeFor !== 'function') return this.knowledge
      const view = caseManager.knowledgeFor(who || this.witnessMemory?.id || this.role)
      if (view) this.knowledge = view
      return this.knowledge
    } catch {
      return this.knowledge
    }
  }

  /**
   * The fact texts a prompt may quote, as plain strings. Only the giving-evidence
   * roles get a fact list at all: it is the fence that stops a witness answering
   * about matters they never saw, and counsel are meant to argue from exhibits
   * instead.
   */
  promptKnowledge() {
    try {
      if (this.witnessMemory) {
        return [...this.witnessMemory.factTexts.values()].filter(Boolean)
      }
      const facts = this.knowledge?.facts || []
      return facts.map((f) => (typeof f === 'string' ? f : String(f?.text || ''))).filter(Boolean)
    } catch {
      return []
    }
  }

  // --- memory ------------------------------------------------------------------

  /**
   * Record a beat. Anything the trial will still be living with later is copied to
   * longTerm as well, because the rolling window is sized for the next prompt and
   * a ruling against you outlives twenty turns.
   */
  remember(entry) {
    try {
      const item = typeof entry === 'string' ? { type: 'NOTE', text: entry } : { ...(entry || {}) }
      item.at = item.at || new Date().toISOString()
      item.phase = item.phase || this.conversationContext.phase || null

      this.memory.push(item)
      if (this.memory.length > MEMORY_LIMIT) this.memory.shift()

      if (item.durable || DURABLE_EVENTS.has(String(item.type || '').toUpperCase())) {
        this.longTerm.push(item)
        if (this.longTerm.length > 200) this.longTerm.shift()
      }
      return item
    } catch {
      return null
    }
  }

  recall(n = 6) {
    const count = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 6
    return this.memory.slice(-count)
  }

  // --- mood --------------------------------------------------------------------

  /**
   * A named mood plus an intensity between 0 and 1. Naming the same mood again
   * accumulates, which is how an advocate ruled against three times running ends
   * up genuinely rattled; naming a new one replaces it at a modest intensity.
   */
  setEmotion(state, delta = 0.1) {
    try {
      const name = state ? String(state) : this.emotionalState.state
      const d = Number(delta)
      const step = Number.isFinite(d) ? d : 0.1
      this.emotionalState = name === this.emotionalState.state
        ? { state: name, intensity: clamp01(this.emotionalState.intensity + step) }
        : { state: name, intensity: clamp01(Math.abs(step) + 0.2) }
      if (this.witnessMemory) this.witnessMemory.emotionalState = { ...this.emotionalState }
      return { ...this.emotionalState }
    } catch {
      return { ...this.emotionalState }
    }
  }

  /**
   * Let the courtroom move the mood.
   *
   * The cases that matter are the ones a person in the room would actually feel: an
   * objection sustained against you is a small public correction and it lands as
   * frustration; your own objection sustained is encouragement; a witness caught
   * departing from their earlier answer is a nervous moment for that witness and an
   * opening for whoever is cross-examining.
   */
  reactTo(event = {}) {
    try {
      const type = String(event.type || event.action || '').toUpperCase()
      const by = event.by || event.actor || event.raisedBy || null
      const against = event.against || event.target || null
      const ruling = String(event.ruling || '').toUpperCase()

      if (type === 'RULING' || type === 'RULE') {
        const sustained = ruling.includes('SUSTAIN') || String(event.ruling || '').toLowerCase() === 'sustained'
        const mine = by === this.role || by === this.id
        if (sustained && !mine && (against === this.role || against === null || against === 'counsel')) {
          this.setEmotion('frustrated', 0.2)
        } else if (sustained && mine) {
          this.setEmotion('emboldened', 0.15)
        } else if (!sustained && mine) {
          this.setEmotion('frustrated', 0.1)
        }
        this.remember({ type: 'RULING', text: event.reason || event.text || `Objection ${sustained ? 'sustained' : 'overruled'}.`, ruling, by, durable: true })
        return { ...this.emotionalState }
      }

      if (type === 'CONTRADICTION') {
        if (givesEvidence(this.role)) {
          this.setEmotion('nervous', 0.25)
        } else {
          this.setEmotion('emboldened', 0.2)
        }
        this.remember({ type: 'CONTRADICTION', text: event.note || 'Testimony departed from an earlier answer.', durable: true })
        return { ...this.emotionalState }
      }

      if (type === 'ADMIT_EVIDENCE' || type === 'EVIDENCE_ADMITTED') {
        this.remember({ type: 'ADMIT_EVIDENCE', text: `Exhibit ${event.evidence || event.evidenceId || 'unknown'} admitted.`, durable: true })
        this.setEmotion(event.proponent === this.role ? 'emboldened' : 'focused', 0.1)
        return { ...this.emotionalState }
      }

      if (type === 'EXCLUDE_EVIDENCE' || type === 'EVIDENCE_EXCLUDED') {
        this.remember({ type: 'EXCLUDE_EVIDENCE', text: `Exhibit ${event.evidence || event.evidenceId || 'unknown'} excluded.`, durable: true })
        this.setEmotion(event.proponent === this.role ? 'frustrated' : 'emboldened', 0.15)
        return { ...this.emotionalState }
      }

      if (type === 'PRESSURE' && this.witnessMemory) {
        this.witnessMemory.pressure(Number(event.delta) || 0.15)
        this.emotionalState = { ...this.witnessMemory.emotionalState }
        return { ...this.emotionalState }
      }

      if (event.text || event.speech) {
        this.remember({ type: type || 'NOTE', text: event.text || event.speech })
      }
      return { ...this.emotionalState }
    } catch {
      return { ...this.emotionalState }
    }
  }

  // --- context -----------------------------------------------------------------

  /**
   * Refresh what this agent believes is going on, straight off the state machine.
   * Kept as a plain readable object rather than a formatted string so the same
   * context can feed a prompt, a debug overlay and a test assertion.
   */
  updateContext({ state } = {}) {
    try {
      const s = state || {}
      const transcript = typeof s.recentTranscript === 'function' ? s.recentTranscript(8) : (s.transcript || []).slice(-8)
      const lines = transcript.map((l) => (typeof l === 'string' ? l : `${l.role || 'unknown'} [${l.action || 'SPEAK'}]: ${l.text || ''}`))
      const lastQuestion = s.lastQuestion || null

      this.conversationContext = {
        phase: s.currentPhase || null,
        lastSpeaker: s.currentSpeaker || null,
        activeWitness: s.activeWitness || null,
        examiningCounsel: s.examiningCounsel || null,
        pendingObjection: s.pendingObjection || null,
        lastQuestion: typeof lastQuestion === 'string' ? lastQuestion : lastQuestion?.text || null,
        admittedEvidence: [...(s.admittedEvidence || [])],
        excludedEvidence: [...(s.excludedEvidence || [])],
        transcript: lines,
        // A giving-evidence role also needs its own prior answers close at hand,
        // since consistency is the thing it will be attacked on.
        ownTestimony: givesEvidence(this.role) && typeof s.testimonyFor === 'function'
          ? s.testimonyFor(this.role).slice(-6).map((l) => l.text)
          : [],
        updatedAt: new Date().toISOString(),
      }
      return this.conversationContext
    } catch {
      return this.conversationContext
    }
  }

  /**
   * The shape prompts.js expects. It reads `id` for the rule lookups and `role` for
   * the prose title, which is the opposite of how this class stores them, so the
   * translation happens here once rather than at every call site.
   */
  promptShape() {
    return {
      id: this.role,
      name: this.name,
      role: this.title,
      style: `${this.style}. ${this.personality}`.trim(),
      goals: this.objectives.length ? this.objectives : this.goals,
      restrictions: this.restrictions,
    }
  }

  // --- the turn ----------------------------------------------------------------

  /**
   * One turn: build the prompts, call the provider, coerce the reply into a
   * decision the state machine can act on.
   *
   * This method is the one most likely to be handed a half-built state, a provider
   * that is down or a model that returns prose, so it never throws. Every failure
   * path ends in a permitted silent action with the reason recorded, because a
   * character who listens is a courtroom beat and an exception is a dead trial.
   */
  async decide({ state, evidence = null, caseManager = null, provider = null, phase = null, extra = null } = {}) {
    const activePhase = phase || state?.currentPhase || this.conversationContext.phase || PHASES.PRE_SESSION

    try {
      this.updateContext({ state })
      if (caseManager && !this.knowledge?.facts?.length) this.attachKnowledge(caseManager)

      const knowledge = this.promptKnowledge()
      const allowedActions = this.allowedActions

      let system = systemPromptFor(this.promptShape(), { phase: activePhase, knowledge, allowedActions })
      system = this.#appendPersonaRules(system)

      let turn = turnPromptFor({
        agent: this.promptShape(),
        phase: activePhase,
        state,
        knowledge,
        transcript: this.conversationContext.transcript,
        pendingObjection: state?.pendingObjection,
        lastQuestion: state?.lastQuestion,
        evidence,
      })
      if (extra) turn += `\nDIRECTION: ${typeof extra === 'string' ? extra : JSON.stringify(extra)}`

      if (!provider || typeof provider.complete !== 'function') {
        return this.#safeDecision(activePhase, 'No language model provider was supplied for this turn.')
      }

      const reply = await provider.complete({
        system,
        messages: [{ role: 'user', content: turn }],
        maxTokens: 400,
        temperature: this.role === ROLES.JUDGE ? 0.4 : 0.7,
        json: true,
      })

      const parsed = parseDecision(reply?.text, { role: this.role, allowedActions })
      const decision = {
        ...parsed.decision,
        role: this.role,
        agent: this.id,
        name: this.name,
        phase: activePhase,
        emotion: { ...this.emotionalState },
        issues: parsed.issues,
        ok: parsed.ok,
        provider: reply?.provider || null,
        degraded: Boolean(reply?.degraded),
      }

      this.#recordOwnTurn(decision)
      return decision
    } catch (error) {
      return this.#safeDecision(activePhase, `Turn failed: ${String(error?.message || error)}`)
    }
  }

  /**
   * Persona and discipline that prompts.js cannot know about, appended after its
   * own sections so the labelled format it and the offline provider share stays
   * intact. Only a giving-evidence role gets the delivery block; for anyone else it
   * would be paid-for noise.
   */
  #appendPersonaRules(system) {
    const lines = [system]
    lines.push(`SPEECH STYLE: ${this.speechStyle}`)
    lines.push(`PRESENT MOOD: ${this.emotionalState.state} (intensity ${this.emotionalState.intensity.toFixed(2)}). It colours delivery only, never the facts.`)

    if (this.longTerm.length) {
      const recent = this.longTerm.slice(-4).map((m) => m.text).filter(Boolean)
      if (recent.length) lines.push(`ON THE RECORD ALREADY: ${recent.join(' | ')}`)
    }

    if (this.witnessMemory) {
      const c = this.witnessMemory.answerConstraints()
      lines.push(`DELIVERY: ${c.delivery}`)
      lines.push(`WHEN YOU DO NOT KNOW: say so in your own words, for example "${c.mustDisclaim[0]}" or "${c.mustDisclaim[1]}"`)
      lines.push(`CONSISTENCY: ${c.consistencyRule}`)
    }
    return lines.join('\n')
  }

  /** A witness's own answer is testimony, so it goes into the record they are held to. */
  #recordOwnTurn(decision) {
    this.remember({ type: decision.action, text: decision.speech || decision.reason || '', target: decision.target || null })

    if (this.witnessMemory && decision.action === ACTIONS.ANSWER && decision.speech) {
      const check = this.witnessMemory.recordAnswer({
        text: decision.speech,
        question: this.conversationContext.lastQuestion,
      })
      decision.consistency = check
      if (!check.consistent) {
        this.reactTo({ type: 'CONTRADICTION', note: check.note })
        decision.emotion = { ...this.emotionalState }
      }
    }
  }

  /**
   * The only decision this class will invent for itself. LISTEN where the role has
   * it, WAIT otherwise: both are silent, both are always legal, and neither puts a
   * word in a character's mouth that the model never wrote.
   */
  #safeDecision(phase, reason) {
    const action = this.allowedActions.includes(ACTIONS.LISTEN)
      ? ACTIONS.LISTEN
      : (this.allowedActions.includes(ACTIONS.WAIT) ? ACTIONS.WAIT : (this.allowedActions[0] || ACTIONS.WAIT))
    const decision = {
      role: this.role,
      agent: this.id,
      name: this.name,
      action,
      speech: '',
      reason,
      target: null,
      phase,
      emotion: { ...this.emotionalState },
      fallback: true,
      ok: false,
      issues: [reason],
      provider: null,
      degraded: true,
    }
    this.remember({ type: 'FALLBACK', text: reason })
    return decision
  }

  snapshot() {
    try {
      return {
        id: this.id,
        role: this.role,
        name: this.name,
        title: this.title,
        style: this.style,
        emotionalState: { ...this.emotionalState },
        allowedActions: [...this.allowedActions],
        factCount: this.promptKnowledge().length,
        memory: this.memory.length,
        longTerm: this.longTerm.length,
        witness: this.witnessMemory ? this.witnessMemory.snapshot() : null,
        context: this.conversationContext,
      }
    } catch {
      return { id: this.id, role: this.role, name: this.name }
    }
  }
}

/**
 * Cast the room. One live agent per role, each handed the view of the case that
 * CaseManager says it may hold and nothing more. Never throws: a role whose scoped
 * view could not be built still gets an agent, because a courtroom missing its
 * clerk is better than a courtroom that would not open.
 */
export function createAgents({ caseManager = null } = {}) {
  const built = {}
  for (const [role, profile] of Object.entries(AGENT_PROFILES)) {
    try {
      const who = DEFAULT_OCCUPANT[role] || role
      let knowledge = null
      if (caseManager && typeof caseManager.knowledgeFor === 'function') {
        try {
          knowledge = caseManager.knowledgeFor(who)
        } catch {
          knowledge = null
        }
      }
      built[role] = new Agent({ profile, role, knowledge, caseManager, witnessId: DEFAULT_OCCUPANT[role] || null })
    } catch {
      built[role] = new Agent({ profile, role })
    }
  }
  return built
}

// --- the rule-based path -----------------------------------------------------

/**
 * The original agent table, unchanged in shape and wording.
 *
 * engine.js and the frontend both read these entries, and prompts.js resolves a
 * bare role name against them, so the keys and the field names are a contract.
 * Note that `role` here is the human title while the key is the engine's role name
 * — that asymmetry predates this file and is relied on downstream.
 */
export const agents = Object.fromEntries(
  Object.entries(AGENT_PROFILES).map(([key, p]) => [key, {
    id: p.id,
    name: p.name,
    role: p.role,
    style: p.style,
    goals: [...p.goals],
    restrictions: [...p.restrictions],
  }]),
)

export function agentForEvent(event) {
  const type = event.type;
  if (type === "START_CASE" || type === "RULING" || type === "VERDICT") return agents.judge;
  if (type === "SUBMIT_EVIDENCE") return agents.clerk;
  if (type === "ANSWER_WITNESS") return agents.witness;
  if (type === "OBJECTION") return agents.prosecutor;

  const actor = event.actor || event.agent;
  if (actor && agents[actor]) return agents[actor];

  return agents.judge;
}

/**
 * The deterministic voice of the court. This is the path that runs when no model is
 * available, so it stays a complete set of courtroom lines rather than a stub —
 * every event type an engine can dispatch has something sayable here.
 */
export function generateAgentSpeech(agent, state, event) {
  const evidenceLine = state.evidence.accepted.length
    ? ` Accepted evidence now includes ${state.evidence.accepted.map((item) => item.title).join(", ")}.`
    : "";

  if (event.type === "START_CASE") {
    return `${agent.name}: This court is now in session in State versus Dev Malhotra. The matter concerns alleged digital payment fraud under Indian criminal procedure. Counsel will proceed in an orderly manner, and all evidence must be submitted through the court before it is relied upon.`;
  }

  if (event.type === "OPENING_STATEMENT" && agent.id === "prosecutor") {
    return `${agent.name}: The prosecution will show that the accused knowingly used a cloned payment link to divert funds from the complainant. We will rely on transaction records, device access logs, and witness testimony to connect the accused to the fraudulent act.`;
  }

  if (event.type === "OPENING_STATEMENT" && agent.id === "defense") {
    return `${agent.name}: The defense asks the court to look carefully at the gaps. A payment trail alone does not prove who controlled a device, who created a link, or whether the accused had the required intent.`;
  }

  if (event.type === "QUESTION_WITNESS") {
    return `${agent.name}: ${event.question || "Please tell the court what you personally observed."}`;
  }

  if (event.type === "ANSWER_WITNESS") {
    return `${agent.name}: I can only speak to what I saw. I received a payment request on my phone, believed it came from the vendor, and later learned the money had gone to a different account. I did not personally see who created that link.`;
  }

  if (event.type === "SUBMIT_EVIDENCE") {
    return `${agent.name}: Exhibit ${event.evidence?.id || state.evidence.pending.at(-1)?.id || "P-1"} is marked as pending. The court monitor may display it for review.`;
  }

  if (event.type === "OBJECTION") {
    return `${agent.name}: Objection, Your Honour. The statement appears to assume facts not yet admitted into evidence and risks leading the witness.`;
  }

  if (event.type === "RULING") {
    const ruling = event.ruling || state.pendingObjection?.recommendedRuling || "sustained";
    return `${agent.name}: The objection is ${ruling}. Counsel will ${ruling === "sustained" ? "reframe the question and avoid assuming disputed facts" : "continue, but keep the question tied to the record"}.${evidenceLine}`;
  }

  if (event.type === "FINAL_ARGUMENT") {
    return `${agent.name}: On the present record, the court must separate suspicion from proof. The accepted evidence and witness testimony will determine whether the required legal standard has been met.`;
  }

  if (event.type === "VERDICT") {
    return `${agent.name}: Having considered the testimony and admitted evidence, the court reserves final judgment in this training simulation. A written reasoning event may be generated after both sides complete final arguments.`;
  }

  return `${agent.name}: The court has recorded the event ${event.type}. The proceeding will continue according to the current trial phase.`;
}

/**
 * The rule-based interrupt test. Deliberately narrow: it fires on an unsupported
 * evidence claim and on the two classic leading formulae, and stays quiet
 * otherwise, because an objection at random is worse than none.
 */
export function shouldInterrupt(streamText, state) {
  const lower = streamText.toLowerCase();
  const defenseIsSpeaking = state.currentSpeaker === "defense";
  const unsupportedEvidenceClaim = lower.includes("transaction record proves") && state.evidence.accepted.length === 0;
  const leadingWitness = lower.includes("you clearly saw") || lower.includes("isn't it true");
  return defenseIsSpeaking && !state.pendingObjection && (unsupportedEvidenceClaim || leadingWitness);
}

// --- helpers -----------------------------------------------------------------

function emptyContext() {
  return {
    phase: null,
    lastSpeaker: null,
    activeWitness: null,
    examiningCounsel: null,
    pendingObjection: null,
    lastQuestion: null,
    admittedEvidence: [],
    excludedEvidence: [],
    transcript: [],
    ownTestimony: [],
    updatedAt: null,
  }
}

function normaliseRole(id) {
  const key = String(id || '').toLowerCase()
  if (key === 'defence') return ROLES.DEFENSE
  return Object.values(ROLES).includes(key) ? key : ROLES.JUDGE
}

function clamp01(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.min(1, Math.max(0, n))
}
