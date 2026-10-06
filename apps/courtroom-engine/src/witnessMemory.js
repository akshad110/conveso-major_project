/**
 * A witness's memory, and the discipline that keeps it honest.
 *
 * A witness is the one participant in the room whose *ignorance* is the point. The
 * defense earns a contradiction because the complainant genuinely cannot see the
 * SMS log; the prosecution's identification collapses because the man at the
 * counter was someone else. None of that happens if the witness answers from the
 * case file. So this class is the per-person fence: it holds only the facts that
 * witness was given, refuses the ones the case file deliberately withheld, and
 * hands the prompt layer a set of constraints that make "I do not know" the
 * correct and available answer rather than a failure.
 *
 * The second job is consistency. A witness who can say anything twice is not a
 * witness, they are a random generator, and cross-examination has nothing to bite
 * on. So every answer is recorded and every new answer is checked against the
 * earlier ones on the same subject. The check is lexical, not semantic, and the
 * comment on checkConsistency says exactly how far that can be trusted.
 *
 * The third job is pressure. Real witnesses do not become more accurate when
 * pushed; a confident and wrong witness becomes more emphatic. W_IYER in the case
 * file is built for exactly that, and pressure() is the mechanism that serves it.
 *
 * Nothing here reads engineOnlyHiddenTruth(), and nothing here throws. A witness
 * who cannot answer is a courtroom event; a witness who crashes the server is not.
 */
import { ROLES } from './courtroomActions.js'

/** Short-term memory cap. Long enough for a full examination, short enough to prompt. */
const MEMORY_LIMIT = 40

/**
 * How a witness names their own ignorance. Given in the words we want back so the
 * refusal comes out as testimony rather than as a model apologising for itself.
 */
export const DISCLAIMERS = [
  'I do not know.',
  'I do not recall.',
  'I did not see that myself.',
  'That is not something I can speak to.',
]

/**
 * Markers that make two statements about the same subject incompatible. Negation
 * flips a claim outright; numbers, times and dates are where a witness who is
 * filling gaps drifts without noticing.
 */
const NEGATIONS = new Set([
  'not', 'no', 'never', 'nothing', 'nobody', 'none', 'neither', 'nor',
  'cannot', 'cant', 'didnt', 'dont', 'wasnt', 'werent', 'isnt', 'wont', 'hadnt', 'havent',
])

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'but', 'that', 'this', 'these', 'those', 'there', 'then',
  'was', 'were', 'is', 'are', 'been', 'being', 'have', 'has', 'had', 'did', 'does', 'do',
  'you', 'your', 'yours', 'my', 'mine', 'his', 'her', 'their', 'its', 'our',
  'for', 'from', 'with', 'about', 'into', 'onto', 'over', 'under', 'after', 'before',
  'what', 'when', 'where', 'which', 'who', 'whom', 'whose', 'how', 'why',
  'can', 'could', 'would', 'should', 'will', 'shall', 'may', 'might', 'must',
  'sir', 'madam', 'honour', 'honor', 'court', 'told', 'say', 'said', 'saying',
  'all', 'any', 'some', 'only', 'just', 'very', 'also', 'own', 'thing', 'anything',
])

export class WitnessMemory {
  constructor({ profile = {}, knowledge = null, caseManager = null } = {}) {
    const p = profile && typeof profile === 'object' ? profile : {}

    this.id = p.id || 'W_UNKNOWN'
    this.name = p.name || this.id
    this.role = p.role || ROLES.WITNESS
    this.officialRole = p.officialRole || null
    this.personality = p.personality || 'Reserved.'
    this.speechStyle = p.speechStyle || 'Plain, literal answers.'
    this.relationshipToAccused = p.relationshipToAccused || 'Unknown.'

    this.confidence = clamp01(p.confidence, 0.5)
    this.truthfulness = clamp01(p.truthfulness, 0.8)
    this.bias = p.bias || 'None recorded'
    this.biasStrength = clamp01(p.biasStrength, 0)

    /** A named mood plus a bounded intensity, so delivery can change without new prose. */
    this.emotionalState = { state: p.emotionalState || 'neutral', intensity: 0.3 }

    this.knownFacts = Array.isArray(p.knownFacts) ? [...p.knownFacts] : []
    this.unknownFacts = Array.isArray(p.unknownFacts) ? [...p.unknownFacts] : []

    /**
     * The scoped view, taken from CaseManager when one is available so the fact
     * text a witness can actually recite comes from the same subtraction every
     * other participant is subject to, rather than from a second copy of the rules.
     */
    this.knowledge = knowledge || safeKnowledge(caseManager, this.id) || { facts: [], evidence: [] }
    this.factTexts = new Map()
    for (const fact of this.knowledge.facts || []) {
      if (fact && fact.id) this.factTexts.set(fact.id, String(fact.text || ''))
    }

    /** What this witness has already said, in order. The record they must not depart from. */
    this.memory = []
    /** Cross-examination pressure, 0-1. Raised by pressure(), never by an answer alone. */
    this.pressureLevel = 0
    /** Contradictions the record now contains, for the debug overlay and the objection engine. */
    this.contradictions = []
  }

  // --- knowledge -------------------------------------------------------------

  /**
   * Whether this witness can speak to something, by fact id or by subject matter.
   *
   * unknownFacts is checked first and wins absolutely. The case file uses that
   * list to author a blind spot, and a blind spot that a knownTo entry elsewhere
   * could quietly reopen would be no blind spot at all.
   */
  knows(factIdOrText) {
    try {
      const needle = String(factIdOrText ?? '').trim()
      if (!needle) return false

      if (this.unknownFacts.includes(needle)) return false
      if (this.factTexts.has(needle)) return true
      if (this.knownFacts.includes(needle)) return this.factTexts.has(needle)

      // Not an id, so treat it as subject matter and look for a fact of theirs the
      // words actually touch. Two shared content words is a topic; one is noise.
      const words = contentWords(needle)
      if (!words.size) return false
      for (const text of this.factTexts.values()) {
        if (overlap(words, contentWords(text)) >= 2) return true
      }
      return false
    } catch {
      // An unanswerable question is the safe reading of a broken one.
      return false
    }
  }

  /** The fact ids this witness could be taken to, in case-file order. */
  availableFactIds() {
    return [...this.factTexts.keys()]
  }

  /** The fact of theirs a question is most nearly about, or null if none is. */
  factFor(question) {
    try {
      const qw = contentWords(question)
      if (!qw.size) return null
      let best = null
      let score = 0
      for (const [id, text] of this.factTexts) {
        const n = overlap(qw, contentWords(text))
        if (n > score) {
          score = n
          best = { id, text }
        }
      }
      return score >= 2 ? best : null
    } catch {
      return null
    }
  }

  /**
   * The object the prompt layer uses to force honest scoping.
   *
   * It says three things: what may be spoken to, in what words to decline
   * everything else, and how confidence, bias and present pressure colour the
   * delivery. Delivery is included because a witness who is wrong and certain must
   * sound different from one who is right and careful, and that difference is what
   * makes cross-examination readable.
   */
  answerConstraints() {
    try {
      const facts = [...this.factTexts.entries()].map(([id, text]) => ({ id, text }))
      const emphatic = this.confidence >= 0.8
      const yielding = this.truthfulness >= 0.9 && this.confidence < 0.7

      const delivery = []
      delivery.push(this.speechStyle)
      if (emphatic) {
        delivery.push('You are certain of what you remember and you do not like being doubted. Under challenge you restate rather than soften.')
      } else if (yielding) {
        delivery.push('You are careful and will concede the limits of what you saw when the limits are put to you.')
      }
      if (this.biasStrength >= 0.5) {
        delivery.push(`You lean one way without noticing it: ${this.bias}. It shapes emphasis, never invention.`)
      }
      if (this.pressureLevel >= 0.5) {
        delivery.push(emphatic
          ? 'You are under pressure and becoming more emphatic, repeating yourself rather than revising.'
          : 'You are under pressure and answering shorter, more cautiously.')
      }

      return {
        as: this.id,
        name: this.name,
        role: this.role,
        maySpeakTo: facts,
        mustDisclaim: [...DISCLAIMERS],
        // Named, not enumerated: telling a witness which facts exist elsewhere in
        // the case is itself the leak this class exists to prevent. All they are
        // told is that the list above is the whole of their world.
        knowledgeRule: 'The facts listed are the entirety of what you know. If a question goes beyond them, say plainly that you do not know or do not recall. Never guess, never infer, never fill a gap. Being unable to answer is correct.',
        consistencyRule: this.memory.length
          ? 'You have already given evidence. Stay consistent with it; do not quietly revise an earlier answer.'
          : 'This is your first answer.',
        alreadySaid: this.recall(6).map((m) => m.text),
        confidence: this.confidence,
        truthfulness: this.truthfulness,
        bias: this.bias,
        biasStrength: this.biasStrength,
        pressure: this.pressureLevel,
        emotionalState: { ...this.emotionalState },
        delivery: delivery.filter(Boolean).join(' '),
      }
    } catch {
      return {
        as: this.id,
        maySpeakTo: [],
        mustDisclaim: [...DISCLAIMERS],
        knowledgeRule: 'Answer only from personal knowledge. If in doubt, say you do not know.',
        delivery: 'Plain, literal answers.',
      }
    }
  }

  // --- memory ----------------------------------------------------------------

  /**
   * Record an answer and report whether it sits with the earlier ones.
   *
   * The consistency check runs before the append, so a contradiction is measured
   * against the record as it stood when the answer was given — which is what a
   * transcript would show and what counsel would put to them.
   */
  recordAnswer({ text, question = null, factIds = [] } = {}) {
    try {
      const said = String(text ?? '').trim()
      if (!said) return { consistent: true, conflictsWith: [], note: 'Nothing said.' }

      const check = this.checkConsistency(said)

      const entry = {
        index: this.memory.length,
        text: said,
        question: question ? String(question) : null,
        factIds: Array.isArray(factIds) ? factIds.filter(Boolean).map(String) : [],
        at: new Date().toISOString(),
        pressure: this.pressureLevel,
        emotionalState: { ...this.emotionalState },
        consistent: check.consistent,
      }
      this.memory.push(entry)
      if (this.memory.length > MEMORY_LIMIT) this.memory.shift()

      if (!check.consistent) {
        this.contradictions.push({ at: entry.at, text: said, conflictsWith: check.conflictsWith, note: check.note })
        // Being caught out is a nervous moment even for an honest witness.
        this.setEmotion('nervous', 0.25)
      }

      return check
    } catch (error) {
      return { consistent: true, conflictsWith: [], note: `Consistency check unavailable: ${String(error?.message || error)}` }
    }
  }

  /**
   * Does this answer contradict an earlier one on the same subject?
   *
   * This is a lexical check and nothing more. It finds a prior answer that shares
   * enough content words to be about the same thing, and then flags a conflict
   * when the two differ on a negation, a number, or a time or date — the three
   * places a drifting witness actually drifts. It will therefore miss a
   * contradiction expressed in different words ("a man showed me" versus "it came
   * by message" share almost nothing lexically) and it will occasionally flag a
   * witness who has merely added a qualifier. Do not read a `consistent: false`
   * as proof of a lie; read it as a place cross-examination should look. Anything
   * better than this needs a model, and this file has no provider.
   */
  checkConsistency(newText) {
    try {
      const said = String(newText ?? '').trim()
      if (!said || !this.memory.length) {
        return { consistent: true, conflictsWith: [], note: 'No earlier answer on this subject.' }
      }

      const now = analyse(said)
      if (!now.words.size) {
        return { consistent: true, conflictsWith: [], note: 'Answer carries no substantive content.' }
      }

      const conflictsWith = []
      const notes = []

      for (const prior of this.memory) {
        const then = analyse(prior.text)
        const shared = overlap(now.words, then.words)
        // Three shared content words is the threshold for "same subject". Two is
        // reachable by courtesy formulae alone and produced false alarms.
        if (shared < 3) continue

        const reasons = []
        if (now.negated !== then.negated) {
          reasons.push(`earlier answer ${then.negated ? 'denied' : 'asserted'} this and the new answer ${now.negated ? 'denies' : 'asserts'} it`)
        }
        const numberClash = differing(now.numbers, then.numbers)
        if (numberClash) reasons.push(`figures differ (${numberClash})`)
        const timeClash = differing(now.times, then.times)
        if (timeClash) reasons.push(`times or dates differ (${timeClash})`)

        if (reasons.length) {
          conflictsWith.push({ index: prior.index, text: prior.text, sharedWords: shared, reasons })
          notes.push(`Answer ${prior.index}: ${reasons.join('; ')}.`)
        }
      }

      if (!conflictsWith.length) {
        return { consistent: true, conflictsWith: [], note: 'Consistent with the testimony already given, on a lexical comparison.' }
      }
      return {
        consistent: false,
        conflictsWith,
        note: `${notes.join(' ')} Detected lexically, so it marks a line worth pursuing rather than a proved contradiction.`,
      }
    } catch (error) {
      return { consistent: true, conflictsWith: [], note: `Consistency check unavailable: ${String(error?.message || error)}` }
    }
  }

  recall(n = 6) {
    const count = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 6
    return this.memory.slice(-count)
  }

  /** Has this witness already been taken to this fact? Repetition is a tell. */
  hasSpokenTo(factId) {
    const id = String(factId ?? '')
    return this.memory.some((m) => m.factIds.includes(id))
  }

  // --- pressure and mood -----------------------------------------------------

  /**
   * Cross-examination pressure.
   *
   * The important asymmetry is here. Pressure always raises nervousness, but what
   * it does to the answer depends on the witness: a confident witness with poor
   * accuracy gets *more emphatic*, not more accurate, because that is how an
   * honest and mistaken person behaves when they feel disbelieved. W_IYER's
   * confidence of 0.95 against a demonstrably wrong identification is written for
   * this path, and `emphatic` is what answerConstraints() reads to make the
   * delivery follow.
   */
  pressure(delta = 0.15) {
    try {
      const d = Number(delta)
      this.pressureLevel = clamp01(this.pressureLevel + (Number.isFinite(d) ? d : 0.15), this.pressureLevel)

      const rising = Number.isFinite(d) && d > 0
      if (rising) {
        this.setEmotion('nervous', d * 0.8)
      }

      // Accuracy is not measured here — this class never sees hidden truth — so
      // "high confidence, low accuracy" is read off the case file's own signals:
      // certainty well above what a careful witness would claim, combined with a
      // strong bias that certainty is protecting.
      const emphatic = this.confidence >= 0.8 && this.biasStrength >= 0.4
      if (emphatic && rising) {
        // Certainty hardens rather than cracks. Bounded, so a long cross cannot
        // push a witness past total conviction.
        this.confidence = clamp01(this.confidence + d * 0.5, this.confidence)
        this.setEmotion('defensive', d * 0.6)
      } else if (rising && this.truthfulness >= 0.9) {
        // A careful witness narrows instead: less certain, more precise.
        this.confidence = clamp01(this.confidence - d * 0.3, this.confidence)
      }

      return {
        pressure: this.pressureLevel,
        confidence: this.confidence,
        emphatic,
        emotionalState: { ...this.emotionalState },
      }
    } catch {
      return { pressure: this.pressureLevel, confidence: this.confidence, emphatic: false, emotionalState: { ...this.emotionalState } }
    }
  }

  /** Relieve pressure — a new line of questioning, or the bench intervening. */
  relieve(delta = 0.2) {
    return this.pressure(-Math.abs(Number(delta) || 0.2))
  }

  /**
   * Move the mood. A named state plus an intensity, bounded 0-1. Naming the state
   * anew resets the intensity to the delta; repeating the same state accumulates,
   * which is how a witness who is needled repeatedly ends up rattled.
   */
  setEmotion(state, delta = 0.1) {
    try {
      const name = state ? String(state) : this.emotionalState.state
      const d = Number(delta)
      const step = Number.isFinite(d) ? d : 0.1
      if (name === this.emotionalState.state) {
        this.emotionalState = { state: name, intensity: clamp01(this.emotionalState.intensity + step, this.emotionalState.intensity) }
      } else {
        this.emotionalState = { state: name, intensity: clamp01(Math.abs(step) + 0.2, 0.3) }
      }
      return { ...this.emotionalState }
    } catch {
      return { ...this.emotionalState }
    }
  }

  // --- serialisation ---------------------------------------------------------

  /**
   * Safe to log or ship to a debug overlay. Fact ids are included but fact text is
   * not: an overlay is a place a client can read, and the texts are the one thing
   * scoping exists to keep in one witness's head.
   */
  snapshot() {
    try {
      return {
        id: this.id,
        name: this.name,
        role: this.role,
        officialRole: this.officialRole,
        confidence: this.confidence,
        truthfulness: this.truthfulness,
        bias: this.bias,
        biasStrength: this.biasStrength,
        emotionalState: { ...this.emotionalState },
        pressure: this.pressureLevel,
        relationshipToAccused: this.relationshipToAccused,
        knownFactIds: this.availableFactIds(),
        unknownFactIds: [...this.unknownFacts],
        answersGiven: this.memory.length,
        contradictions: this.contradictions.map((c) => ({ at: c.at, note: c.note, conflictsWith: c.conflictsWith.map((x) => x.index) })),
      }
    } catch {
      return { id: this.id, name: this.name, role: this.role, answersGiven: 0, contradictions: [] }
    }
  }
}

/**
 * Build a witness memory from the case file. Takes either a profile object or a
 * witness id, so a caller who already holds the roster does not have to look it up
 * again and one who does not can pass the id.
 */
export function createWitnessMemory({ profile = null, witnessId = null, caseManager = null } = {}) {
  let resolved = profile
  if (!resolved && caseManager && typeof caseManager.witnessProfile === 'function') {
    try {
      resolved = caseManager.witnessProfile(witnessId)
    } catch {
      resolved = null
    }
  }
  const id = resolved?.id || witnessId || null
  return new WitnessMemory({ profile: resolved || (id ? { id } : {}), caseManager })
}

// --- helpers -----------------------------------------------------------------

function safeKnowledge(caseManager, who) {
  if (!caseManager || typeof caseManager.knowledgeFor !== 'function' || !who) return null
  try {
    return caseManager.knowledgeFor(who)
  } catch {
    return null
  }
}

function clamp01(value, fallback = 0) {
  const n = Number(value)
  if (!Number.isFinite(n)) return clampRange(fallback)
  return clampRange(n)
}

function clampRange(n) {
  const v = Number(n)
  if (!Number.isFinite(v)) return 0
  return Math.min(1, Math.max(0, v))
}

/** Content words: three letters or more, stripped of punctuation, stop words dropped. */
function contentWords(text) {
  const out = new Set()
  const raw = String(text ?? '').toLowerCase().replace(/['’]/g, '')
  for (const word of raw.match(/[a-z]{3,}/g) || []) {
    if (!STOP_WORDS.has(word)) out.add(word)
  }
  return out
}

function overlap(a, b) {
  let n = 0
  for (const w of a) if (b.has(w)) n += 1
  return n
}

/**
 * Everything the consistency check compares: subject words, whether the statement
 * is a denial, and the figures and clock or calendar references in it.
 */
function analyse(text) {
  const raw = String(text ?? '').toLowerCase().replace(/['’]/g, '')
  const tokens = raw.match(/[a-z]+/g) || []
  const negated = tokens.some((t) => NEGATIONS.has(t))

  const times = new Set()
  for (const m of raw.match(/\b\d{1,2}[:.]\d{2}\b/g) || []) times.add(m.replace('.', ':'))
  for (const m of raw.match(/\b\d{1,2}\s?(?:am|pm)\b/g) || []) times.add(m.replace(/\s+/g, ''))
  for (const m of raw.match(/\b\d{1,2}\s+(?:january|february|march|april|may|june|july|august|september|october|november|december)\b/g) || []) times.add(m)
  for (const m of raw.match(/\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/g) || []) times.add(m)

  const numbers = new Set()
  // Figures a witness would be held to. Anything inside a time already counted is
  // skipped, so "11:07" does not also register as the numbers 11 and 7.
  const withoutTimes = raw.replace(/\b\d{1,2}[:.]\d{2}\b/g, ' ')
  for (const m of withoutTimes.match(/\d[\d,]*/g) || []) numbers.add(m.replace(/,/g, ''))

  return { words: contentWords(raw), negated, times, numbers }
}

/**
 * Do two sets of figures actually disagree?
 *
 * The test is subsethood, not disjointness. One side silent, or one side merely
 * fuller than the other, is extra detail rather than a contradiction — "at 11:07"
 * followed by "at 11:07 on 10 March" is the same account, told twice. But neither
 * set containing the other is a real change of story, and that distinction is what
 * catches the witness who keeps the date and moves the time.
 */
function differing(a, b) {
  if (!a.size || !b.size) return null
  if (subset(a, b) || subset(b, a)) return null
  return `${[...b].join(', ')} then ${[...a].join(', ')} now`
}

function subset(a, b) {
  for (const v of a) if (!b.has(v)) return false
  return true
}
