/**
 * Prompt construction — where a courtroom situation becomes text a model reads.
 *
 * Two rules shape everything here. The first is token economy: every prompt is
 * terse labelled sections, not prose, because these go out once per agent per
 * turn and a chatty preamble multiplied by a whole trial is real money. The
 * second is that the allowed-action list is *never* written out by hand. It comes
 * from allowedActionsFor() in courtroomActions.js, so when the action vocabulary
 * changes the prompts change with it and cannot drift out of agreement with the
 * validator that will judge the reply.
 *
 * The labelled-section format is also a contract with the offline provider, which
 * reads these same labels back out of the prompt to decide what to do. Renaming a
 * section here means teaching provider.js to read the new name.
 *
 * The hardest rule to get a model to keep is anti-omniscience: a witness must not
 * know things the case gave to someone else. That is enforced twice — the witness
 * prompt contains only that witness's own facts, and it is told in plain terms to
 * say it does not know when asked about anything else. A model cannot leak a fact
 * it was never shown.
 */
import { ROLES, allowedActionsFor, givesEvidence } from '../courtroomActions.js'
import { PHASES } from '../courtroomState.js'
import { agents } from '../agents.js'

/**
 * The objection grounds the bench recognises. Named here rather than in the state
 * machine because they are a vocabulary for the AI, not a rule the engine
 * enforces; the validator only cares that OBJECT was permitted.
 */
export const OBJECTION_CATEGORIES = {
  LEADING: 'the question suggests its own answer',
  HEARSAY: 'calls for what someone else said, outside the witness’s knowledge',
  SPECULATION: 'asks the witness to guess rather than recount',
  RELEVANCE: 'has no bearing on the charges',
  ARGUMENTATIVE: 'argues with the witness instead of questioning',
  ASSUMES_FACTS: 'assumes a fact not in the admitted evidence',
  COMPOUND: 'several questions in one',
  BADGERING: 'harassing the witness',
}

/** What each role is in court for. Short, because it is repeated every turn. */
const ROLE_BRIEF = {
  judge: 'Preside. Keep order, rule on objections, control who speaks. Never advocate for either side.',
  prosecutor: 'Prove the charges from admitted evidence and witness testimony. Object when procedure is broken.',
  defense: 'Protect the accused. Test the prosecution case and build reasonable doubt. Object when procedure is broken.',
  witness: 'Answer only what is asked, only from what you personally know.',
  defendant: 'Answer the court when addressed. Say nothing else; your counsel speaks for you.',
  clerk: 'Announce, read and record. Never argue the legal merits.',
  police: 'Stand present. Act only on direction from the bench.',
}

const SPEECH_RULE = 'Speech is spoken dialogue: 1-3 short sentences, plain courtroom register, no stage directions, no markdown.'

/**
 * The forbidden list. Stated as absolutes because hedged instructions get
 * negotiated with; the first two entries are the ones that ruin a simulation
 * quietly, and the third is the renderer boundary the whole engine rests on.
 */
const FORBIDDEN = [
  'Do not invent evidence, documents, witnesses or facts.',
  'Do not refer to evidence unless it appears under ADMITTED EVIDENCE.',
  'Do not volunteer anything you were not given. If you do not know it, you do not know it.',
  'Do not write dialogue or actions for any other character. You control only yourself.',
  'Do not output animation names, clip names, camera names, positions, coordinates or any 3D or rendering term. You describe courtroom conduct only.',
  'Do not use any action name outside your ALLOWED ACTIONS list.',
]

const SCHEMA = 'OUTPUT: exactly one JSON object, nothing before or after it.\n'
  + '{"action":"<one of ALLOWED ACTIONS>","speech":"<what you say aloud, or \\"\\" if silent>",'
  + '"reason":"<one short line of why, for the record>","target":"<who you address: judge|witness|counsel|court|null>"}\n'
  + 'Optional when relevant: "evidence":"<exhibit id>", "objectionCategory":"<ground>", "ruling":"SUSTAIN|OVERRULE".'

/**
 * Build the system prompt for one agent. Everything in it is stable for the whole
 * trial except the phase and the allowed-action list, which is why the volatile
 * turn context lives in turnPromptFor() instead: a provider that caches prompts
 * gets a stable prefix to cache.
 */
export function systemPromptFor(agent, { phase, knowledge, allowedActions } = {}) {
  const a = resolveAgent(agent)
  const role = a.role
  const allowed = (allowedActions && allowedActions.length ? allowedActions : allowedActionsFor(role))
  const lines = []

  lines.push(`You are ${a.name}, the ${a.title} in an Indian criminal trial simulation.`)
  lines.push(`ROLE: ${role}`)
  lines.push(`PERSONALITY: ${a.style}`)
  lines.push(`OBJECTIVES: ${(a.goals || []).join('; ') || ROLE_BRIEF[role]}`)
  lines.push(`DUTY: ${ROLE_BRIEF[role] || 'Follow the direction of the bench.'}`)
  if (a.restrictions?.length) lines.push(`LIMITS: ${a.restrictions.join('; ')}`)
  if (phase) lines.push(`PHASE: ${phase}`)
  lines.push(`ALLOWED ACTIONS: ${allowed.join(', ')}`)
  lines.push(`STYLE: ${SPEECH_RULE}`)

  lines.push('FORBIDDEN:')
  for (const rule of FORBIDDEN) lines.push(`- ${rule}`)

  // Role-specific rules, added only where they change behaviour. A judge does not
  // need the anti-omniscience paragraph and a witness does not need the ruling
  // vocabulary, and paying for either would be waste.
  if (givesEvidence(role)) {
    lines.push(...witnessRules(knowledge))
  }
  if (role === ROLES.JUDGE) {
    lines.push(...judgeRules())
  }
  if (role === ROLES.PROSECUTOR || role === ROLES.DEFENSE) {
    lines.push(...counselRules())
  }

  lines.push(SCHEMA)
  lines.push(`EXAMPLE: ${JSON.stringify(exampleFor(role))}`)

  return lines.join('\n')
}

/**
 * The knowledge fence. The facts are listed verbatim and numbered so the model
 * can be told "these and nothing else" against something concrete, and the
 * not-known instruction is given in the words we actually want back so the
 * refusal comes out as courtroom speech rather than as an AI apology.
 */
function witnessRules(knowledge) {
  const facts = normaliseFacts(knowledge)
  const lines = ['KNOWN FACTS (your entire knowledge of this case):']
  if (facts.length) {
    facts.forEach((f, i) => lines.push(`${i + 1}. ${f}`))
  } else {
    lines.push('- none recorded')
  }
  lines.push(
    'KNOWLEDGE RULE: the list above is everything you know. If a question goes beyond it, answer that you do not know or do not recall — for example "I do not know, sir, I did not see that myself." Never guess, never infer, never fill a gap. Being unable to answer is correct behaviour, not failure.',
    'Do not repeat facts already in the transcript unless asked again. Stay consistent with what you have already said.',
  )
  return lines
}

function judgeRules() {
  return [
    'RULING RULE: when an objection is pending you must RULE. Set "ruling" to exactly SUSTAIN or OVERRULE and give one short sentence of reason in "speech".',
    `OBJECTION GROUNDS: ${Object.entries(OBJECTION_CATEGORIES).map(([k, v]) => `${k} (${v})`).join('; ')}`,
    'Sustain when the objection identifies a real defect in the question or the evidence. Overrule when the question is proper or the objection is tactical.',
    'Do not decide the case while ruling on a point of procedure.',
  ]
}

function counselRules() {
  return [
    'One question at a time, and only about matters the witness can speak to personally.',
    `OBJECTION GROUNDS you may cite: ${Object.keys(OBJECTION_CATEGORIES).join(', ')}. Object only when there is a real defect; a frivolous objection costs you standing with the bench.`,
    'Address the bench as "Your Honour". Do not argue with a ruling once it is given.',
  ]
}

function exampleFor(role) {
  if (role === ROLES.JUDGE) {
    return {
      action: 'RULE',
      speech: 'Sustained. Counsel will rephrase without suggesting the answer.',
      reason: 'The question was leading.',
      target: 'counsel',
      ruling: 'SUSTAIN',
    }
  }
  if (givesEvidence(role)) {
    return {
      action: 'ANSWER',
      speech: 'I received the request on my phone and I believed it came from the vendor. I did not see who sent it.',
      reason: 'Answering from what I personally observed.',
      target: 'court',
    }
  }
  if (role === ROLES.CLERK) {
    return {
      action: 'SPEAK',
      speech: 'Exhibit P-2 is marked and placed before the court.',
      reason: 'Recording the exhibit as directed.',
      target: 'court',
    }
  }
  return {
    action: 'QUESTION_WITNESS',
    speech: 'Mr Iyer, what did you see on your phone that evening?',
    reason: 'Establishing what the witness personally observed.',
    target: 'witness',
  }
}

/**
 * The turn prompt: only what changed since last turn. Sections are omitted rather
 * than emitted empty, both to save tokens and because an absent PENDING OBJECTION
 * section is a clearer signal than one reading "none".
 */
export function turnPromptFor({
  agent, phase, state, knowledge, transcript, pendingObjection, lastQuestion, evidence,
} = {}) {
  const a = resolveAgent(agent)
  const role = a.role
  const s = state || {}
  const lines = []

  lines.push(`PHASE: ${phase || s.currentPhase || PHASES.PRE_SESSION}`)
  if (s.activeWitness) lines.push(`ON THE STAND: ${s.activeWitness}`)
  if (s.examiningCounsel) lines.push(`EXAMINING COUNSEL: ${s.examiningCounsel}`)
  if (s.currentSpeaker && s.currentSpeaker !== role) lines.push(`LAST SPEAKER: ${s.currentSpeaker}`)

  const admitted = evidenceList(evidence, s)
  lines.push(`ADMITTED EVIDENCE: ${admitted.length ? admitted.join(' | ') : 'none'}`)
  const excluded = s.excludedEvidence || []
  if (excluded.length) lines.push(`EXCLUDED (must not be mentioned): ${excluded.join(', ')}`)

  const recent = normaliseTranscript(transcript || s.transcript)
  if (recent.length) {
    lines.push('TRANSCRIPT (most recent last):')
    for (const line of recent) lines.push(`  ${line}`)
  }

  const q = lastQuestion || s.lastQuestion
  if (q) {
    const qText = typeof q === 'string' ? q : q.text
    // A witness reads this as the thing they must answer; anyone else reads it as
    // the thing they may object to. Same fact, different label, so neither has to
    // work out which it is.
    lines.push(`${givesEvidence(role) ? 'QUESTION TO YOU' : 'LAST QUESTION'}: ${qText}`)
  }

  const obj = pendingObjection || s.pendingObjection
  if (obj) {
    lines.push(`PENDING OBJECTION: ${obj.by || 'counsel'} objects on ${obj.category || 'RELEVANCE'} grounds — ${obj.reason || 'no reason stated'}`)
    if (obj.targetQuestion) lines.push(`OBJECTED-TO QUESTION: ${obj.targetQuestion}`)
    if (role === ROLES.JUDGE) lines.push('The bench must rule now: SUSTAIN or OVERRULE, with one short reason.')
    else lines.push('An objection is before the bench. Do not speak over it.')
  }

  if (givesEvidence(role)) {
    const facts = normaliseFacts(knowledge)
    if (facts.length) {
      // Repeated in the turn prompt as well as the system prompt on purpose: with
      // a long transcript in between, the fence needs to be near the question.
      lines.push('YOUR KNOWLEDGE (nothing outside this):')
      facts.forEach((f, i) => lines.push(`  ${i + 1}. ${f}`))
    }
  }

  lines.push(`ALLOWED ACTIONS: ${allowedActionsFor(role).join(', ')}`)
  lines.push('Decide your single next action. Reply with the JSON object only.')

  return lines.join('\n')
}

// --- shaping helpers ---------------------------------------------------------

/**
 * Accept a role name, an agents.js entry or a bare object, and always come back
 * with the same shape. Callers pass whichever they happen to hold, and the
 * personalities from agents.js are preserved rather than restated here.
 */
function resolveAgent(agent) {
  if (typeof agent === 'string') {
    const found = agents[agent]
    return normaliseAgent(found || { id: agent, name: agent, role: agent }, agent)
  }
  const role = agent?.id || agent?.role?.toLowerCase() || 'judge'
  return normaliseAgent(agent || agents.judge, role)
}

function normaliseAgent(a, roleKey) {
  const role = normaliseRole(a.id || roleKey)
  return {
    role,
    name: a.name || role,
    // agents.js stores the human-readable title in `role` ("Defense Lawyer")
    // while the engine keys off the id ("defense"). Both are useful, so keep the
    // title for the prose line and the id for every rule lookup.
    title: typeof a.role === 'string' && a.role !== role ? a.role : role,
    style: a.style || 'measured, professional',
    goals: a.goals || [],
    restrictions: a.restrictions || [],
  }
}

function normaliseRole(id) {
  const key = String(id || '').toLowerCase()
  if (key === 'defence') return ROLES.DEFENSE
  return Object.values(ROLES).includes(key) ? key : ROLES.JUDGE
}

/** Facts may arrive as a string, an array or a `{ knownFacts }` bundle. */
function normaliseFacts(knowledge) {
  if (!knowledge) return []
  if (Array.isArray(knowledge)) return knowledge.map(String).filter(Boolean)
  if (typeof knowledge === 'string') return knowledge.split('\n').map((s) => s.trim()).filter(Boolean)
  const facts = knowledge.knownFacts || knowledge.facts || []
  return Array.isArray(facts) ? facts.map(String).filter(Boolean) : []
}

function normaliseTranscript(transcript, limit = 8) {
  if (!Array.isArray(transcript)) return []
  return transcript.slice(-limit).map((l) => (
    typeof l === 'string' ? l : `${l.role || 'unknown'} [${l.action || 'SPEAK'}]: ${l.text || ''}`
  ))
}

/** Only admitted exhibits are ever named, since nothing else may be relied on. */
function evidenceList(evidence, state) {
  const ids = state?.admittedEvidence || []
  if (!evidence) return ids.map(String)
  const items = Array.isArray(evidence) ? evidence : Object.values(evidence)
  const named = items
    .filter((e) => e && (e.admitted || e.status === 'accepted' || e.status === 'admitted' || ids.includes(e.id)))
    .map((e) => `${e.id}: ${e.title || e.description || 'exhibit'}`)
  return named.length ? named : ids.map(String)
}
