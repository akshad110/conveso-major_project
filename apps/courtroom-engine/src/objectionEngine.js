/**
 * The objection engine.
 *
 * Objections are the moment the simulation either feels like a courtroom or feels
 * like a chatbot taking turns, so they get their own module rather than living as
 * a branch inside the orchestrator. Three jobs:
 *
 *   1. Read the question that was just asked and work out which grounds, if any,
 *      are actually available. This matters more than it sounds: an agent asked
 *      "would you like to object?" every turn will object constantly and at
 *      random. Offering it only the grounds a real lawyer could see keeps
 *      objections rare, motivated and explicable.
 *
 *   2. Let counsel decide whether to take them, and let the bench rule. Both are
 *      agent decisions, both go through the validator, and both degrade to a
 *      documented heuristic when no model is reachable.
 *
 *   3. Express the whole beat as an ordered event sequence — counsel rises,
 *      objects, camera to the bench, ruling, gavel, counsel sits, back to wide —
 *      because the renderer needs choreography, not a verdict.
 *
 * The grounds detection is lexical and openly imperfect. It is a *filter on what
 * to offer the model*, not a ruling; the model decides and the bench rules. A
 * missed ground costs a possible objection, which is a cheaper failure than a
 * fabricated one.
 */
import { ACTIONS, ROLES, semanticCamera } from './courtroomActions.js'
import { PHASES } from './courtroomState.js'
import { buildCourtEvent, buildCameraEvent } from './courtroomEvents.js'
import { EVIDENCE_STATUS } from './evidenceEngine.js'

export const RULINGS = { SUSTAIN: 'SUSTAIN', OVERRULE: 'OVERRULE' }

/**
 * The nine grounds, each with what it means, what it sounds like, and how
 * sympathetic the bench usually is to it.
 *
 * `leaning` is the prior the fallback judge uses when no model is available: how
 * often this ground is sustained when it is well spotted. Leading questions on
 * direct are sustained almost automatically; relevance objections are usually
 * overruled because the bench prefers to hear the answer.
 */
export const OBJECTION_CATEGORIES = {
  LEADING: {
    label: 'Leading the witness',
    explains: 'The question suggests the answer counsel wants.',
    leaning: 0.8,
    // Leading is perfectly proper on cross-examination. Encoding that means the
    // engine never raises it against the side entitled to do it.
    onlyInPhases: [PHASES.DIRECT_EXAMINATION],
    phrase: 'Objection, your honour. Leading.',
  },
  HEARSAY: {
    label: 'Hearsay',
    explains: 'The answer would repeat what someone outside this court said.',
    leaning: 0.7,
    phrase: 'Objection, your honour. That calls for hearsay.',
  },
  RELEVANCE: {
    label: 'Relevance',
    explains: 'The question has no bearing on the charges before the court.',
    leaning: 0.35,
    phrase: 'Objection, your honour. Relevance.',
  },
  SPECULATION: {
    label: 'Speculation',
    explains: 'The witness is being asked to guess rather than to recall.',
    leaning: 0.75,
    phrase: 'Objection, your honour. The question invites speculation.',
  },
  ARGUMENTATIVE: {
    label: 'Argumentative',
    explains: 'Counsel is arguing with the witness rather than examining them.',
    leaning: 0.65,
    phrase: 'Objection, your honour. Counsel is arguing with the witness.',
  },
  ASSUMES_FACTS: {
    label: 'Assumes facts not in evidence',
    explains: 'The question treats something unproved as established.',
    leaning: 0.8,
    phrase: 'Objection, your honour. That assumes facts not in evidence.',
  },
  COMPOUND: {
    label: 'Compound question',
    explains: 'Two questions in one; any answer would be ambiguous.',
    leaning: 0.6,
    phrase: 'Objection, your honour. Compound question.',
  },
  BADGERING: {
    label: 'Badgering the witness',
    explains: 'The witness has answered and is being pressed regardless.',
    leaning: 0.55,
    phrase: 'Objection, your honour. Counsel is badgering the witness.',
  },
  LACK_OF_FOUNDATION: {
    label: 'Lack of foundation',
    explains: 'Nothing establishes that this witness can speak to this.',
    leaning: 0.7,
    phrase: 'Objection, your honour. No foundation has been laid.',
  },
}

export const CATEGORY_LIST = Object.keys(OBJECTION_CATEGORIES)

/** Which side is entitled to object to a question the other side asked. */
export function opposingCounsel(role) {
  if (role === ROLES.PROSECUTOR) return ROLES.DEFENSE
  if (role === ROLES.DEFENSE) return ROLES.PROSECUTOR
  return null
}

// --- grounds detection -------------------------------------------------------

const LEADING_CUES = [
  /^\s*(isn'?t it (true|correct|the case))\b/i,
  /^\s*(did(n'?t)? you|were(n'?t)? you|was(n'?t)? it|have(n'?t)? you|you did|you were|you knew|you had)\b/i,
  /\b(wouldn'?t you agree|isn'?t that right|correct\?|is that not so)\b/i,
  /^\s*so,? you\b/i,
]

const HEARSAY_CUES = [
  /\bwhat did .{2,40}\b(tell|say to|mention to)\b/i,
  /\b(did|had) (anyone|someone|somebody|he|she|they) (tell|say|mention|inform)\b/i,
  /\bwhat (were|was) you told\b/i,
  /\baccording to (what|someone|somebody|him|her|them)\b/i,
]

const SPECULATION_CUES = [
  /\b(do you (think|suppose|imagine|believe)|in your (view|opinion))\b/i,
  /\b(could it (have|be)|might (it|he|she|they) have|would it be possible|is it possible that)\b/i,
  /\bwhat (would|might) have happened\b/i,
  /\bwhy do you (think|suppose)\b/i,
]

const ARGUMENTATIVE_CUES = [
  /\b(how can you (possibly |really )?(claim|say|expect|maintain))\b/i,
  /\byou expect (this court|us|the court) to believe\b/i,
  /\b(that'?s absurd|surely you|you can'?t seriously)\b/i,
  /\b(are you (seriously )?(telling|asking) (this court|us))\b/i,
]

const BADGERING_CUES = [
  /\b(answer the question|just answer|i'?ll ask (you )?again|answer me)\b/i,
  /\b(stop (evading|avoiding)|you'?re avoiding)\b/i,
]

const FOUNDATION_CUES = [
  /\b(as an expert|in your (expert|professional) (opinion|assessment))\b/i,
  /\b(you'?re (an|the) (expert|specialist))\b/i,
]

const COMPOUND_CUES = [
  /\?\s*\S+.*\?/,
  /\b(and|or) (did|were|was|have|had|do|does) you\b/i,
  /\b, and (did|were|was|have|had) (you|he|she|they)\b/i,
]

/** Presupposition patterns: "when you deleted..." asserts that you deleted. */
const PRESUPPOSITION_CUES = [
  /\b(when|after|before|since) you (deleted|forged|cloned|created|sent|took|hid|destroyed)\b/i,
  /\byour (forgery|fraud|scheme|deception)\b/i,
  /\bthe (money|funds) you (took|diverted|stole)\b/i,
]

function matchesAny(patterns, text) {
  return patterns.some((re) => re.test(text))
}

/**
 * How much of the case vocabulary a question touches. A question that shares no
 * substantive word with the charges, facts or exhibits is the only kind we are
 * willing to call irrelevant, and even then only weakly.
 */
function relevanceOverlap(text, vocabulary) {
  const words = String(text).toLowerCase().match(/[a-z]{4,}/g) || []
  if (!words.length || !vocabulary.size) return 1
  const hits = words.filter((w) => vocabulary.has(w)).length
  return hits / words.length
}

/**
 * Build the substantive vocabulary of a case once, so relevance checks are a set
 * lookup rather than a scan of the whole case file per question.
 */
export function caseVocabulary(caseManager) {
  const bag = new Set()
  const add = (text) => {
    for (const w of String(text || '').toLowerCase().match(/[a-z]{4,}/g) || []) bag.add(w)
  }
  try {
    const know = caseManager?.knowledgeFor?.('judge')
    add(know?.title)
    add(know?.summary)
    for (const c of know?.charges || []) add(typeof c === 'string' ? c : c?.description || c?.label)
    for (const f of know?.facts || []) add(f?.text || f)
    for (const e of know?.evidence || []) add(`${e?.label || ''} ${e?.description || ''}`)
  } catch {
    // A case file we cannot read just means no relevance objections.
  }
  return bag
}

/**
 * Which grounds are genuinely available against this question.
 *
 * Returns strongest first, each `{ category, confidence, note }`. An empty array
 * is the normal and most common answer — most questions are perfectly proper.
 */
export function detectGrounds(question, {
  phase = PHASES.DIRECT_EXAMINATION,
  askedBy = null,
  vocabulary = new Set(),
  evidenceEngine = null,
  transcript = [],
  witnessRole = ROLES.WITNESS,
} = {}) {
  const text = typeof question === 'string' ? question : question?.text || ''
  if (!text.trim()) return []

  const found = []
  const push = (category, confidence, note) => {
    const meta = OBJECTION_CATEGORIES[category]
    if (!meta) return
    // Respect a ground's phase restriction — leading on cross is not a ground.
    if (meta.onlyInPhases && !meta.onlyInPhases.includes(phase)) return
    found.push({ category, confidence, note })
  }

  if (matchesAny(LEADING_CUES, text)) {
    push('LEADING', 0.8, 'The question states the answer and invites agreement.')
  }
  if (matchesAny(HEARSAY_CUES, text)) {
    push('HEARSAY', 0.85, 'The answer would relay an out-of-court statement.')
  }
  if (matchesAny(SPECULATION_CUES, text)) {
    push('SPECULATION', 0.8, 'The witness is asked to speculate rather than recall.')
  }
  if (matchesAny(ARGUMENTATIVE_CUES, text)) {
    push('ARGUMENTATIVE', 0.75, 'Counsel is arguing rather than asking.')
  }
  if (matchesAny(COMPOUND_CUES, text)) {
    push('COMPOUND', 0.6, 'More than one question is being put at once.')
  }
  if (matchesAny(PRESUPPOSITION_CUES, text)) {
    push('ASSUMES_FACTS', 0.85, 'The question presupposes a disputed fact.')
  }
  if (matchesAny(FOUNDATION_CUES, text)) {
    push('LACK_OF_FOUNDATION', 0.6, 'Expertise is assumed but not established.')
  }

  // An exhibit named in a question that has not been admitted is the cleanest
  // foundation objection there is, and the engine can be certain about it.
  const exhibitIds = text.match(/\bEXHIBIT[_\s-]?([A-Z])\b/gi) || []
  for (const raw of exhibitIds) {
    const id = `EXHIBIT_${raw.slice(-1).toUpperCase()}`
    const item = evidenceEngine?.get?.(id)
    if (!item) {
      push('LACK_OF_FOUNDATION', 0.9, `${id} is not on the record at all.`)
    } else if (item.status === EVIDENCE_STATUS.MARKED) {
      push('LACK_OF_FOUNDATION', 0.7, `${id} is marked but not yet in evidence.`)
    } else if (item.status === EVIDENCE_STATUS.EXCLUDED || item.status === EVIDENCE_STATUS.WITHDRAWN) {
      push('ASSUMES_FACTS', 0.95, `${id} is ${item.status.toLowerCase()} and cannot be put to a witness.`)
    }
  }

  // Badgering is a pattern rather than a phrase, so it needs the transcript: the
  // same ground pressed again straight after the witness has answered it.
  const explicitPressure = matchesAny(BADGERING_CUES, text)
  const recentQuestions = transcript
    .filter((l) => l.action === ACTIONS.QUESTION_WITNESS && l.role === askedBy)
    .slice(-3)
  const answered = transcript.some((l) => l.role === witnessRole && l.action === ACTIONS.ANSWER)
  // The question under analysis is already on the transcript by the time this
  // runs, so the one to compare against is the entry *before* it. Comparing
  // against `at(-1)` compares the question with itself, which reads as badgering
  // every single time and stalls the examination in a loop of sustained
  // objections to perfectly proper questions.
  const previous = recentQuestions.length >= 2
    ? (normalise(recentQuestions.at(-1)?.text) === normalise(text)
      ? recentQuestions.at(-2)?.text
      : recentQuestions.at(-1)?.text)
    : null
  const repeated = Boolean(previous) && overlaps(text, previous)
  if (explicitPressure || (repeated && answered)) {
    push('BADGERING', explicitPressure ? 0.8 : 0.55,
      explicitPressure ? 'Counsel is demanding rather than asking.' : 'The same ground is being pressed again.')
  }

  const overlap = relevanceOverlap(text, vocabulary)
  if (overlap < 0.08 && text.split(/\s+/).length > 5) {
    push('RELEVANCE', 0.5, 'The question touches nothing in the case as pleaded.')
  }

  return found.sort((a, b) => b.confidence - a.confidence)
}

const normalise = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').trim()

/** Crude repeated-question test: how much substantive vocabulary two share. */
function overlaps(a, b) {
  if (!a || !b) return false
  const setA = new Set(String(a).toLowerCase().match(/[a-z]{4,}/g) || [])
  const wordsB = String(b).toLowerCase().match(/[a-z]{4,}/g) || []
  if (!setA.size || !wordsB.length) return false
  const shared = wordsB.filter((w) => setA.has(w)).length
  return shared / wordsB.length > 0.5
}

// --- the beat ----------------------------------------------------------------

/**
 * The interrupting half of the sequence: counsel rises and objects.
 *
 * Split from the ruling because the queue plays these first, pausing whoever was
 * speaking, and the bench has not decided anything yet at this point.
 */
export function buildObjectionEvents({ objector, category, speech, reason, targetQuestion, phase }) {
  const meta = OBJECTION_CATEGORIES[category] || OBJECTION_CATEGORIES.RELEVANCE
  const line = (speech && speech.trim()) || meta.phrase

  return [
    buildCourtEvent(
      { role: objector, action: ACTIONS.STAND, speech: '' },
      { phase, interrupt: true, camera: objector, eventName: `${objector.toUpperCase()}_RISES` },
    ),
    buildCourtEvent(
      {
        role: objector,
        action: ACTIONS.OBJECT,
        speech: line,
        reason: reason || meta.explains,
        objection: { category, label: meta.label, targetQuestion: targetQuestion || null },
        target: ROLES.JUDGE,
      },
      { phase: PHASES.OBJECTION, interrupt: true, camera: objector },
    ),
    // The camera goes to the bench before the ruling, because the answer everyone
    // is waiting for comes from there.
    buildCameraEvent(semanticCamera('JUDGE')),
  ]
}

/**
 * The resolving half: the bench rules, gavels, and counsel sits back down.
 *
 * `sustained` also carries an instruction to the witness — a sustained objection
 * means the question is withdrawn and must not be answered, which the frontend
 * shows by clearing the pending question.
 */
export function buildRulingEvents({ objector, ruling, speech, category, phase, reason }) {
  const sustained = ruling === RULINGS.SUSTAIN
  const meta = OBJECTION_CATEGORIES[category] || {}
  const line = (speech && speech.trim())
    || (sustained
      ? `Sustained. ${meta.label ? `${meta.label}.` : ''} Rephrase your question, counsel.`.trim()
      : 'Overruled. The witness will answer.')

  const events = [
    buildCourtEvent(
      {
        role: ROLES.JUDGE,
        action: ACTIONS.RULE,
        speech: line,
        ruling,
        reason: reason || meta.explains || null,
        objection: { category, label: meta.label || category, ruling },
      },
      { phase: PHASES.JUDGE_RULING, camera: 'JUDGE' },
    ),
    buildCourtEvent(
      { role: ROLES.JUDGE, action: ACTIONS.GAVEL, speech: '' },
      { phase: PHASES.JUDGE_RULING, camera: 'JUDGE', eventName: 'JUDGE_GAVELS' },
    ),
  ]

  if (objector) {
    events.push(buildCourtEvent(
      { role: objector, action: ACTIONS.SIT, speech: '' },
      { phase: PHASES.JUDGE_RULING, camera: objector, eventName: `${objector.toUpperCase()}_SITS` },
    ))
  }

  // Back to the room. A sustained objection returns to the wide shot; an overruled
  // one goes straight back to the witness who now has to answer.
  events.push(buildCameraEvent(sustained ? 'WIDE' : 'WITNESS'))
  return events
}

// --- decisions ---------------------------------------------------------------

/**
 * Should this side object, and on what ground?
 *
 * The agent is only consulted when a ground actually exists, and it is told which
 * grounds they are. When no model is available the fallback is deliberately
 * conservative: object only on a strongly-detected ground, so a degraded engine
 * produces fewer objections rather than nonsense ones.
 *
 * @returns {Promise<{object:boolean, category?:string, speech?:string, reason?:string, source:string}>}
 */
export async function considerObjection({
  agent, question, state, caseManager, evidenceEngine, vocabulary, askedBy, provider,
}) {
  const grounds = detectGrounds(question, {
    phase: state?.currentPhase,
    askedBy,
    vocabulary: vocabulary || caseVocabulary(caseManager),
    evidenceEngine,
    transcript: state?.transcript || [],
  })

  if (!grounds.length) return { object: false, source: 'no-grounds', grounds }
  if (!agent) return heuristicObjection(grounds)

  try {
    // Naming the grounds is the whole trick: the agent chooses among real options
    // or declines, instead of inventing a ground to sound busy. Written as labelled
    // prose sections rather than JSON because that is how every prompt in this
    // engine is written, and it is what both hosted and offline providers read.
    const extra = [
      '',
      'OBJECTION OPPORTUNITY: opposing counsel has just put a question to the witness.',
      `THE QUESTION: "${typeof question === 'string' ? question : question?.text || ''}"`,
      'OBJECTION GROUNDS:',
      ...grounds.map((g) => `- ${g.category} — ${OBJECTION_CATEGORIES[g.category]?.label || g.category}: ${g.note} (confidence ${g.confidence.toFixed(2)})`),
      '',
      'INSTRUCTION: If one of these grounds is genuinely available, respond with action '
      + 'OBJECT and set objectionCategory to that ground. If the question is proper, or the '
      + 'point is too slight to interrupt for, respond with action LISTEN.',
    ].join('\n')

    const decision = await agent.decide({ state, provider, caseManager, extra })

    if (decision?.action !== ACTIONS.OBJECT) {
      return { object: false, source: decision?.degraded ? 'agent-degraded' : 'agent-declined', grounds }
    }

    // The model may name a ground we did not detect. Trust our detection over its
    // enthusiasm: fall back to the strongest ground we actually found.
    const named = String(decision.objectionCategory || decision.objection?.category || '').toUpperCase()
    const category = grounds.some((g) => g.category === named) ? named : grounds[0].category

    return {
      object: true,
      category,
      speech: decision.speech,
      reason: decision.reason || grounds.find((g) => g.category === category)?.note,
      source: 'agent',
      grounds,
    }
  } catch {
    return heuristicObjection(grounds)
  }
}

/** No model, or the model failed: object only when the ground is strong. */
function heuristicObjection(grounds) {
  const best = grounds[0]
  if (!best || best.confidence < 0.75) return { object: false, source: 'heuristic-declined', grounds }
  return {
    object: true,
    category: best.category,
    speech: OBJECTION_CATEGORIES[best.category].phrase,
    reason: best.note,
    source: 'heuristic',
    grounds,
  }
}

/**
 * How does the bench rule?
 *
 * The judge agent decides. When it cannot, the fallback uses the ground's own
 * `leaning` weighted by how confident the detection was, so a blatant leading
 * question is sustained and a thin relevance objection is not — deterministic,
 * defensible, and never a coin flip on a strong ground.
 */
export async function decideRuling({ judge, state, objection, confidence = 0.6, provider, caseManager }) {
  const category = objection?.category || 'RELEVANCE'

  if (judge) {
    try {
      const decision = await judge.decide({
        state,
        provider,
        caseManager,
        extra: {
          kind: 'OBJECTION_TO_RULE',
          category,
          label: OBJECTION_CATEGORIES[category]?.label,
          explains: OBJECTION_CATEGORIES[category]?.explains,
          targetQuestion: objection?.targetQuestion || null,
          instruction: 'Rule on this objection now. Respond with action RULE and '
            + 'set ruling to exactly SUSTAIN or OVERRULE, with one sentence of reasoning.',
        },
      })
      const ruling = String(decision?.ruling || '').toUpperCase()
      if (ruling === RULINGS.SUSTAIN || ruling === RULINGS.OVERRULE) {
        return { ruling, speech: decision.speech, reason: decision.reason, source: 'judge' }
      }
      // A judge that answered but not with a ruling still gets its words used; the
      // ruling itself falls back rather than being invented from the speech.
      const fallback = leaningRuling(category, confidence)
      return { ...fallback, speech: decision?.speech || fallback.speech, source: 'judge-repaired' }
    } catch {
      // fall through
    }
  }

  return leaningRuling(category, confidence)
}

function leaningRuling(category, confidence) {
  const meta = OBJECTION_CATEGORIES[category] || { leaning: 0.5 }
  const sustain = meta.leaning * confidence >= 0.4
  const ruling = sustain ? RULINGS.SUSTAIN : RULINGS.OVERRULE
  return {
    ruling,
    speech: sustain
      ? `Sustained. ${meta.label || 'The objection'} is well taken. Rephrase, counsel.`
      : 'Overruled. The witness will answer the question.',
    reason: meta.explains || null,
    source: 'leaning',
  }
}
