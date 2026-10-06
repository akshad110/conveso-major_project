/**
 * The case file, and the discipline of who is allowed to know what.
 *
 * A courtroom simulation is only interesting if the participants are ignorant in
 * the right places. If every agent is handed the whole case file, the witness
 * answers questions about matters no witness could know, the defense never has
 * to work for a contradiction, and objections have nothing to bite on. So this
 * module's real job is not loading JSON — it is subtraction. Every public method
 * here returns less than the case file contains.
 *
 * The hardest line to hold is `hiddenTruth`. It is what actually happened, kept
 * so the engine can judge whether testimony is consistent and decide what a
 * witness would really say under pressure. No agent may ever see it, including
 * the judge. Convention is not enough for that: this class lifts hiddenTruth out
 * of the case data at construction and keeps it in a private field, so the object
 * every scoped view is built from does not have the key at all. A future
 * knowledgeFor() written carelessly, or a `{ ...caseData }` spread somewhere
 * downstream, still cannot leak it, because there is nothing there to spread.
 *
 * Loading never throws. The engine has to be able to start; a missing or corrupt
 * case file degrades to FALLBACK_CASE and reports the failure on the instance
 * rather than taking the server down with it.
 */
import { readFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { ROLES } from './courtroomActions.js'

/** Resolved from this file, not from cwd — the server may be started anywhere. */
const CASES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'cases')

export const DEFAULT_CASE_ID = 'state-v-malhotra'

/**
 * The knownTo wildcard. Facts of record — the FIR, the plea, what was read out in
 * open court — are known to the room, and writing every role into every such fact
 * would make the case file unreadable and easy to get wrong.
 */
export const PUBLIC_AUDIENCE = 'all'

/**
 * Fact types the bench is entitled to. A judge knows the record and the technical
 * material that has been led in evidence; a judge does not know either side's
 * private theory of the case, and must not be given it, because the whole point of
 * the trial is that the theories are argued in front of them.
 */
const JUDICIAL_FACT_TYPES = new Set(['procedural', 'background', 'technical', 'contested'])

/**
 * Last-resort case. Deliberately thin: enough shape for the state machine and the
 * prompt builders to run without special-casing, not enough to pretend it is a
 * real matter. It carries no hiddenTruth at all, which is the honest answer when
 * the engine does not know what actually happened.
 */
export const FALLBACK_CASE = {
  caseId: 'fallback-unnamed-matter',
  title: 'State versus Unnamed Accused',
  jurisdiction: 'Training simulation. Case file unavailable.',
  charges: [{ id: 'CH1', statute: 'unspecified', label: 'Unspecified offence', particulars: 'Particulars unavailable.', elements: [] }],
  facts: [
    { id: 'F01', type: 'procedural', text: 'The matter has been called and the accused has pleaded not guilty.', knownTo: [PUBLIC_AUDIENCE] },
    { id: 'F02', type: 'procedural', text: 'The case file could not be loaded, so the record before the court is limited to what is stated in open court.', knownTo: [PUBLIC_AUDIENCE] },
  ],
  timeline: [],
  victim: { id: 'V_UNKNOWN', name: 'Complainant', description: 'Details unavailable.' },
  accused: { id: 'D_UNKNOWN', name: 'Unnamed Accused', plea: 'Not guilty.' },
  witnesses: [
    {
      id: 'W_UNKNOWN', name: 'Witness', role: ROLES.WITNESS,
      personality: 'Cautious.', relationshipToAccused: 'Unknown.',
      confidence: 0.5, bias: 'None recorded', biasStrength: 0, truthfulness: 0.8,
      emotionalState: 'neutral', knownFacts: ['F01', 'F02'], unknownFacts: [],
      speechStyle: 'Short, literal answers.',
    },
  ],
  evidence: [],
  prosecutionTheory: { summary: 'Not available.', inferenceChain: [], reliesOn: [], keyWitnesses: [], weakestPoint: null },
  defenseTheory: { summary: 'Not available.', inferenceChain: [], reliesOn: [], keyWitnesses: [], weakestPoint: null },
}

/** Statuses a scoped view treats as still live. EXCLUDED and WITHDRAWN are gone. */
const REFERENCEABLE_STATUSES = new Set(['MARKED', 'INTRODUCED', 'ADMITTED', 'DISPUTED'])

export class CaseManager {
  /** Private on purpose. Nothing outside engineOnlyHiddenTruth() can reach it. */
  #hiddenTruth

  /**
   * @param {object} caseData  Parsed case JSON. Anything missing is filled from
   *   FALLBACK_CASE rather than left undefined, so callers never branch on shape.
   */
  constructor(caseData = {}) {
    const source = caseData && typeof caseData === 'object' ? caseData : {}
    // Take hiddenTruth out first and clone what is left. From this line on,
    // `this.data` provably has no hiddenTruth key, and every view is built from
    // `this.data`, so no view can carry it even by accident.
    const { hiddenTruth, ...visible } = source
    this.#hiddenTruth = hiddenTruth ? deepFreeze(clone(hiddenTruth)) : null

    this.data = normalise(visible)
    this.loadError = null
    this.usedFallback = this.data.caseId === FALLBACK_CASE.caseId
  }

  // --- knowledge scoping -----------------------------------------------------

  /**
   * Everything a given participant may be told, and nothing else.
   *
   * `who` accepts a court role ('prosecutor', 'witness') or a witness id
   * ('W_IYER'), because the witness seat is occupied by a specific person with a
   * specific blind spot and the generic role would give away too much. When a
   * witness id is passed, their own unknownFacts list wins over any knownTo
   * entry — that list is how the case file expresses a deliberate gap, so it has
   * to be the stronger rule.
   */
  knowledgeFor(who) {
    const witness = this.#resolveWitness(who)
    const role = witness ? witness.role : String(who || '').toLowerCase()

    const facts = this.#factsFor(role, witness)
    const factIds = new Set(facts.map((f) => f.id))

    const view = {
      caseId: this.data.caseId,
      title: this.data.title,
      jurisdiction: this.data.jurisdiction,
      role,
      as: witness ? witness.id : role,
      charges: clone(this.data.charges),
      facts,
      evidence: this.#evidenceFor(role, factIds),
      // Judge and neutral roles get no theory. Counsel get their own only, so
      // neither side can argue against a case it was handed rather than built.
      theory: this.#theoryFor(role),
      timeline: this.#timelineFor(role),
      accused: { name: this.data.accused?.name || null, plea: this.data.accused?.plea || null },
    }

    if (witness) view.self = this.witnessProfile(witness.id)
    else view.witnessRoster = this.witnessRoster(role)

    // Belt and braces for the one rule that matters most. `this.data` cannot
    // contain hiddenTruth, but a later edit to this method could add a spread of
    // something else, so the guarantee is enforced here rather than assumed.
    return stripHidden(view)
  }

  /** Facts this participant could plausibly have. */
  #factsFor(role, witness) {
    const denied = new Set(witness?.unknownFacts || [])
    const allowedIds = witness ? new Set(witness.knownFacts || []) : null

    return this.data.facts
      .filter((fact) => {
        if (denied.has(fact.id)) return false
        const audience = fact.knownTo || []
        if (audience.includes(PUBLIC_AUDIENCE)) return true
        // A witness is scoped by their own knownFacts list first; knownTo is the
        // case file's second way of saying the same thing and either suffices.
        if (witness) return allowedIds.has(fact.id) || audience.includes(witness.id)
        if (role === ROLES.JUDGE) return JUDICIAL_FACT_TYPES.has(fact.type) && this.#isOfRecord(fact)
        return audience.includes(role)
      })
      // knownTo is scaffolding for this filter and tells an agent who else knows
      // a fact, which is knowledge the agent has not earned. Drop it from views.
      .map(({ knownTo, ...fact }) => clone(fact))
  }

  /**
   * A fact reaches the bench only if it is on the record for both sides or is
   * genuinely public. A fact one side alone knows has not been proved to anyone
   * and a judge who acted on it would be deciding on material never led.
   */
  #isOfRecord(fact) {
    const audience = fact.knownTo || []
    if (audience.includes(PUBLIC_AUDIENCE)) return true
    return audience.includes(ROLES.PROSECUTOR) && audience.includes(ROLES.DEFENSE)
  }

  /**
   * Evidence this participant may be told about.
   *
   * Counsel see the whole marked set, both sides', because disclosure has already
   * happened by the time a trial starts. The bench sees only what has actually
   * been admitted or is live before it. A witness sees only exhibits touching
   * facts they know, which is what stops a witness authenticating a document they
   * have never been shown.
   */
  #evidenceFor(role, knownFactIds) {
    const items = this.data.evidence.filter((item) => REFERENCEABLE_STATUSES.has(item.status))

    if (role === ROLES.PROSECUTOR || role === ROLES.DEFENSE) return items.map(clone)
    if (role === ROLES.JUDGE || role === ROLES.CLERK) {
      return items
        .filter((item) => item.status === 'ADMITTED' || item.status === 'INTRODUCED' || item.status === 'DISPUTED')
        .map(({ relatedFacts, ...item }) => clone(item))
    }

    return items
      .filter((item) => (item.relatedFacts || []).some((id) => knownFactIds.has(id)))
      // A witness is told what the exhibit is, not who is running it or what it
      // is meant to prove, so their answers cannot be strategically convenient.
      .map((item) => ({ id: item.id, title: item.title, type: item.type, status: item.status }))
  }

  #theoryFor(role) {
    if (role === ROLES.PROSECUTOR) return { side: 'prosecution', ...clone(this.data.prosecutionTheory) }
    if (role === ROLES.DEFENSE) return { side: 'defense', ...clone(this.data.defenseTheory) }
    // The defendant knows the case their own counsel is running, but only its
    // shape — not counsel's assessment of where it is weak.
    if (role === ROLES.DEFENDANT) {
      const { weakestPoint, ...rest } = clone(this.data.defenseTheory || {})
      return { side: 'defense', ...rest }
    }
    return null
  }

  /** Timeline entries are dates and events of record, so scope them like facts. */
  #timelineFor(role) {
    if (role === ROLES.PROSECUTOR || role === ROLES.DEFENSE || role === ROLES.JUDGE) {
      return clone(this.data.timeline)
    }
    // Witnesses get no chronology. The timeline is the investigator's
    // reconstruction of the whole matter, assembled after the fact from sources no
    // single witness had; handing it over would let a witness date events they
    // only lived through in fragments. Their own facts are their chronology.
    return []
  }

  /**
   * Who else is in the room, for counsel's planning. Deliberately not the full
   * profile: a prosecutor should not be handed the defendant's truthfulness score.
   */
  witnessRoster(role) {
    const forCounsel = role === ROLES.PROSECUTOR || role === ROLES.DEFENSE
    return this.data.witnesses.map((w) => ({
      id: w.id,
      name: w.name,
      role: w.role,
      officialRole: w.officialRole || null,
      relationshipToAccused: forCounsel ? w.relationshipToAccused : null,
    }))
  }

  // --- lookups ---------------------------------------------------------------

  /**
   * The whole witness object, blind spots included. This is for the engine when it
   * is building that witness's own prompt, and for nobody else — handing one
   * agent another agent's profile would leak the other's bias and truthfulness.
   */
  witnessProfile(witnessId) {
    const found = this.#resolveWitness(witnessId)
    return found ? clone(found) : null
  }

  witnesses() {
    return this.data.witnesses.map(clone)
  }

  evidenceList() {
    return this.data.evidence.map(clone)
  }

  evidenceById(id) {
    const found = this.data.evidence.find((item) => item.id === id)
    return found ? clone(found) : null
  }

  charges() {
    return clone(this.data.charges)
  }

  factById(id) {
    const found = this.data.facts.find((f) => f.id === id)
    if (!found) return null
    const { knownTo, ...fact } = found
    return clone(fact)
  }

  /**
   * A short prose brief for a prompt preamble, so the caller does not have to
   * flatten knowledgeFor() by hand every turn. Built from the scoped view, which
   * means it inherits the same subtraction rather than repeating the rules.
   */
  summaryFor(who) {
    const view = this.knowledgeFor(who)
    const charges = view.charges.map((c) => `${c.label} (${c.statute})`).join('; ')
    const lines = [
      `${view.title} — ${view.jurisdiction}`,
      `Charges: ${charges || 'none recorded'}.`,
      `You are appearing as: ${view.as}.`,
      `Facts within your knowledge: ${view.facts.length}.`,
    ]
    if (view.theory) lines.push(`Your case: ${view.theory.summary}`)
    else lines.push('You hold no party theory of the case and must not adopt one.')
    if (view.evidence.length) {
      lines.push(`Exhibits you may speak to: ${view.evidence.map((e) => `${e.id} (${e.title})`).join(', ')}.`)
    } else {
      lines.push('No exhibit is presently within your knowledge.')
    }
    return {
      role: view.role,
      as: view.as,
      brief: lines.join('\n'),
      factCount: view.facts.length,
      evidenceCount: view.evidence.length,
    }
  }

  // --- serialisation ---------------------------------------------------------

  /**
   * What the session store may persist. Same rule as the scoped views: the
   * snapshot is built from `this.data`, so hiddenTruth is not reachable, and it
   * also drops per-fact knownTo and per-witness bias scores because a snapshot
   * tends to end up somewhere a client can read it.
   */
  snapshot() {
    return stripHidden({
      caseId: this.data.caseId,
      title: this.data.title,
      jurisdiction: this.data.jurisdiction,
      charges: clone(this.data.charges),
      timeline: clone(this.data.timeline),
      victim: clone(this.data.victim),
      accused: clone(this.data.accused),
      witnesses: this.data.witnesses.map((w) => ({
        id: w.id, name: w.name, role: w.role, officialRole: w.officialRole || null,
        emotionalState: w.emotionalState,
      })),
      evidence: this.data.evidence.map(({ relatedFacts, ...item }) => clone(item)),
      factCount: this.data.facts.length,
      usedFallback: this.usedFallback,
      loadError: this.loadError,
    })
  }

  /**
   * ENGINE ONLY. The return value of this method must never be interpolated into
   * a prompt, broadcast on the socket, or written into a snapshot or transcript.
   * It exists so the engine can check testimony against what really happened and
   * decide how a witness behaves under pressure. If you are writing prompt text
   * and reaching for this, you want witnessProfile() instead.
   */
  engineOnlyHiddenTruth() {
    return this.#hiddenTruth
  }

  #resolveWitness(who) {
    if (!who || typeof who !== 'string') return null
    const direct = this.data.witnesses.find((w) => w.id === who)
    if (direct) return direct
    // 'defendant' is a role but there is exactly one of them, so resolve it to
    // the person: the defendant's blind spots are the point of the character.
    if (who.toLowerCase() === ROLES.DEFENDANT) {
      return this.data.witnesses.find((w) => w.role === ROLES.DEFENDANT) || null
    }
    return null
  }
}

/**
 * Read a case off disk. Accepts a bare id ('state-v-malhotra'), a filename, or an
 * absolute path, so the engine can be pointed at a scratch file without a special
 * loader. Never throws: a failure returns a CaseManager over FALLBACK_CASE with
 * `loadError` set, because a courtroom that will not open is worse than a thin one.
 */
export function loadCase(caseIdOrPath = DEFAULT_CASE_ID) {
  const candidates = candidatePaths(caseIdOrPath)
  let lastError = null

  for (const path of candidates) {
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8'))
      const manager = new CaseManager(parsed)
      manager.sourcePath = path
      return manager
    } catch (error) {
      lastError = error
    }
  }

  const fallback = new CaseManager(FALLBACK_CASE)
  fallback.loadError = lastError ? `${lastError.message} (tried: ${candidates.join(', ')})` : 'no candidate path'
  fallback.usedFallback = true
  return fallback
}

function candidatePaths(idOrPath) {
  const raw = String(idOrPath || DEFAULT_CASE_ID)
  if (isAbsolute(raw)) return [raw]
  const withExt = raw.endsWith('.json') ? raw : `${raw}.json`
  return [
    join(CASES_DIR, withExt),
    // A relative path is resolved against cwd only after the cases directory has
    // been tried, so a case id can never be shadowed by a stray local file.
    resolve(process.cwd(), withExt),
  ]
}

/** Fill the shape so no caller has to guard against a half-written case file. */
function normalise(data) {
  const witnesses = Array.isArray(data.witnesses) && data.witnesses.length
    ? data.witnesses
    : FALLBACK_CASE.witnesses
  const facts = Array.isArray(data.facts) && data.facts.length ? data.facts : FALLBACK_CASE.facts

  return {
    caseId: data.caseId || FALLBACK_CASE.caseId,
    title: data.title || FALLBACK_CASE.title,
    jurisdiction: data.jurisdiction || FALLBACK_CASE.jurisdiction,
    charges: normaliseCharges(data.charges),
    facts: facts.map((f) => ({ knownTo: [], type: 'background', ...f })),
    timeline: Array.isArray(data.timeline) ? clone(data.timeline) : [],
    victim: clone(data.victim || FALLBACK_CASE.victim),
    accused: clone(data.accused || FALLBACK_CASE.accused),
    witnesses: witnesses.map(normaliseWitness),
    evidence: (Array.isArray(data.evidence) ? data.evidence : []).map((item) => ({
      status: 'MARKED', type: 'DOCUMENT', relatedFacts: [], ...clone(item),
    })),
    prosecutionTheory: clone(data.prosecutionTheory || FALLBACK_CASE.prosecutionTheory),
    defenseTheory: clone(data.defenseTheory || FALLBACK_CASE.defenseTheory),
  }
}

/** Charges may be written as bare strings in a quick case file; accept both. */
function normaliseCharges(charges) {
  if (!Array.isArray(charges) || !charges.length) return clone(FALLBACK_CASE.charges)
  return charges.map((charge, i) => (
    typeof charge === 'string'
      ? { id: `CH${i + 1}`, statute: 'unspecified', label: charge, particulars: charge, elements: [] }
      : { id: `CH${i + 1}`, statute: 'unspecified', elements: [], ...clone(charge) }
  ))
}

function normaliseWitness(w) {
  const out = {
    id: w.id,
    name: w.name || w.id,
    role: w.role || ROLES.WITNESS,
    officialRole: w.officialRole || null,
    // Whether this person actually gives evidence. Nearly everyone in the
    // witness list does, so it defaults to true; a court escort or an usher is
    // in the file because they are in the room, not because they will be asked
    // anything. Used to be inferred from the role, which was wrong the moment a
    // case had a police officer as its investigating witness.
    testifies: w.testifies !== false,
    personality: w.personality || 'Reserved.',
    relationshipToAccused: w.relationshipToAccused || 'Unknown.',
    confidence: clamp01(w.confidence, 0.5),
    bias: w.bias || 'None recorded',
    biasStrength: clamp01(w.biasStrength, 0),
    truthfulness: clamp01(w.truthfulness, 0.8),
    emotionalState: w.emotionalState || 'neutral',
    reliabilityNote: w.reliabilityNote || null,
    knownFacts: Array.isArray(w.knownFacts) ? [...w.knownFacts] : [],
    unknownFacts: Array.isArray(w.unknownFacts) ? [...w.unknownFacts] : [],
    speechStyle: w.speechStyle || 'Plain, literal answers.',
  }
  // A fact in both lists is a case-file mistake with a safe reading: the gap is
  // always the deliberate authorial choice, so ignorance wins.
  const denied = new Set(out.unknownFacts)
  out.knownFacts = out.knownFacts.filter((id) => !denied.has(id))
  return out
}

function clamp01(value, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(1, Math.max(0, n))
}

/**
 * The structural guarantee, applied to anything on its way out. Recursive because
 * a nested object added to a view later would otherwise slip past a shallow check.
 */
function stripHidden(value) {
  if (Array.isArray(value)) return value.map(stripHidden)
  if (!value || typeof value !== 'object') return value
  const out = {}
  for (const [key, v] of Object.entries(value)) {
    if (key === 'hiddenTruth') continue
    out[key] = stripHidden(v)
  }
  return out
}

/**
 * Views are cloned rather than shared. An agent turn that mutated a fact object
 * would silently rewrite the case file for every other agent, and that bug would
 * be near-impossible to see in a transcript.
 */
function clone(value) {
  if (value === null || typeof value !== 'object') return value
  return typeof structuredClone === 'function'
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value))
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object') return value
  Object.values(value).forEach(deepFreeze)
  return Object.freeze(value)
}
