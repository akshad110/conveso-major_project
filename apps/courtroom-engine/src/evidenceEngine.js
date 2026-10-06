/**
 * The evidence lifecycle — the second deterministic gate, alongside the state
 * machine.
 *
 * An exhibit in a real trial is not a fact, it is a thing at a stage. It is
 * marked, then introduced by the side that owns it, then admitted or excluded by
 * the bench, and only once admitted may counsel argue from it as proved. That
 * sequence is the whole of what this module enforces, because it is the sequence
 * an LLM will otherwise cheerfully skip: the natural failure mode of a generated
 * closing argument is to treat a marked exhibit as though the court had accepted
 * it, and the natural failure mode of a generated cross-examination is to wave
 * around something the judge threw out an hour ago.
 *
 * So the rules are a table, not a chain of ifs. The table can be read, tested and
 * argued with; a chain of ifs can only be debugged. And nothing here throws: an
 * illegal transition is an ordinary courtroom outcome that the caller reports back
 * to the agent as a rejection, not an exception that unwinds the turn.
 *
 * Deliberately absent: any notion of what an exhibit proves. Weight is the judge
 * agent's job. This file only knows status.
 */
import { ROLES } from './courtroomActions.js'

export const EVIDENCE_STATUS = {
  MARKED: 'MARKED',
  INTRODUCED: 'INTRODUCED',
  ADMITTED: 'ADMITTED',
  EXCLUDED: 'EXCLUDED',
  DISPUTED: 'DISPUTED',
  WITHDRAWN: 'WITHDRAWN',
}

export const EVIDENCE_TYPES = {
  DOCUMENT: 'DOCUMENT',
  IMAGE: 'IMAGE',
  VIDEO: 'VIDEO',
  AUDIO: 'AUDIO',
  PHYSICAL: 'PHYSICAL',
}

const STATUS_LIST = Object.keys(EVIDENCE_STATUS)
const TYPE_LIST = Object.keys(EVIDENCE_TYPES)

/**
 * The legal transitions, and nothing else.
 *
 * ADMITTED and EXCLUDED are terminal by design. A trial that could re-open an
 * admitted exhibit would give the agents an infinite argument to have, and the
 * real-world answer to a wrongly admitted exhibit is an appeal, which is out of
 * scope for a single session. DISPUTED sits between introduction and ruling: it is
 * where an objection to the exhibit parks it while the bench decides, which is why
 * it resolves only to ADMITTED or EXCLUDED and cannot be quietly withdrawn from.
 */
export const STATUS_TRANSITIONS = {
  [EVIDENCE_STATUS.MARKED]: [EVIDENCE_STATUS.INTRODUCED, EVIDENCE_STATUS.WITHDRAWN],
  [EVIDENCE_STATUS.INTRODUCED]: [
    EVIDENCE_STATUS.ADMITTED, EVIDENCE_STATUS.EXCLUDED,
    EVIDENCE_STATUS.DISPUTED, EVIDENCE_STATUS.WITHDRAWN,
  ],
  [EVIDENCE_STATUS.DISPUTED]: [EVIDENCE_STATUS.ADMITTED, EVIDENCE_STATUS.EXCLUDED],
  [EVIDENCE_STATUS.ADMITTED]: [],
  [EVIDENCE_STATUS.EXCLUDED]: [],
  [EVIDENCE_STATUS.WITHDRAWN]: [],
}

export const TERMINAL_STATUSES = new Set([
  EVIDENCE_STATUS.ADMITTED, EVIDENCE_STATUS.EXCLUDED, EVIDENCE_STATUS.WITHDRAWN,
])

/**
 * Statuses an exhibit may be spoken of at all. Excluded and withdrawn material is
 * not merely unproved, it is off the record: mentioning it is itself the wrong an
 * exclusion ruling exists to prevent.
 */
const MENTIONABLE = new Set([
  EVIDENCE_STATUS.MARKED, EVIDENCE_STATUS.INTRODUCED,
  EVIDENCE_STATUS.DISPUTED, EVIDENCE_STATUS.ADMITTED,
])

/** Only the bench rules on admissibility. Counsel ask; the judge decides. */
const BENCH = new Set([ROLES.JUDGE])

/** Sides with a proprietary interest in an exhibit, as opposed to mere presence. */
const PARTIES = new Set([ROLES.PROSECUTOR, ROLES.DEFENSE])

export function isLegalTransition(from, to) {
  return (STATUS_TRANSITIONS[from] || []).includes(to)
}

export class EvidenceEngine {
  constructor(items = []) {
    /** id -> item. A Map because order of insertion is the exhibit order. */
    this.items = new Map()
    /** Append-only audit of every accepted transition, and who caused it. */
    this.history = []
    if (items.length) this.load(items)
  }

  /**
   * Take the case file's exhibit list. Anything with an unrecognised type or
   * status is coerced rather than refused — a typo in a case file should not
   * silently remove an exhibit from the trial, it should show up as a coercion
   * note in the result the caller can log.
   */
  load(items = []) {
    const loaded = []
    const notes = []

    for (const raw of Array.isArray(items) ? items : []) {
      if (!raw || !raw.id) {
        notes.push('skipped an exhibit with no id')
        continue
      }
      const type = TYPE_LIST.includes(raw.type) ? raw.type : EVIDENCE_TYPES.DOCUMENT
      if (type !== raw.type) notes.push(`${raw.id}: unknown type ${raw.type}, treated as DOCUMENT`)

      const status = STATUS_LIST.includes(raw.status) ? raw.status : EVIDENCE_STATUS.MARKED
      if (status !== raw.status) notes.push(`${raw.id}: unknown status ${raw.status}, reset to MARKED`)

      const proponent = PARTIES.has(raw.proponent) ? raw.proponent : null
      if (!proponent) notes.push(`${raw.id}: no recognised proponent, only the bench may move it`)

      this.items.set(raw.id, {
        id: raw.id,
        title: raw.title || raw.id,
        type,
        description: raw.description || '',
        source: raw.source || 'unrecorded',
        proponent,
        status,
        relatedFacts: Array.isArray(raw.relatedFacts) ? [...raw.relatedFacts] : [],
        introducedBy: null,
        ruledBy: null,
        ruledAt: null,
        reason: null,
      })
      loaded.push(raw.id)
    }

    this.#record({ id: null, from: null, to: null, by: 'engine', reason: `loaded ${loaded.length} exhibits` })
    return { ok: true, loaded, notes }
  }

  get(id) {
    const item = this.items.get(id)
    return item ? { ...item, relatedFacts: [...item.relatedFacts] } : null
  }

  all() {
    return [...this.items.values()].map((item) => ({ ...item, relatedFacts: [...item.relatedFacts] }))
  }

  byStatus(status) {
    return this.all().filter((item) => item.status === status)
  }

  admitted() {
    return this.byStatus(EVIDENCE_STATUS.ADMITTED)
  }

  // --- transitions -----------------------------------------------------------

  /**
   * Put a new exhibit on the record at MARKED. Marking is clerical — it gives the
   * thing a name so the transcript can refer to it — so it is the one operation
   * that creates rather than moves.
   */
  mark(item) {
    if (!item || !item.id) return { ok: false, reason: 'an exhibit needs an id to be marked' }
    if (this.items.has(item.id)) return { ok: false, reason: `${item.id} is already marked` }

    const result = this.load([{ ...item, status: EVIDENCE_STATUS.MARKED }])
    if (!result.loaded.includes(item.id)) return { ok: false, reason: `${item.id} could not be marked` }

    this.#record({ id: item.id, from: null, to: EVIDENCE_STATUS.MARKED, by: item.proponent || 'clerk', reason: 'marked for identification' })
    return { ok: true, item: this.get(item.id), notes: result.notes }
  }

  /**
   * Introduce an exhibit. This is the one transition with an ownership rule: a
   * side may only introduce its own exhibits, because introducing something is
   * asserting it as part of your case. Without this the defendant agent will
   * eventually try to hand up the prosecution's bank statement.
   */
  introduce(id, proponent) {
    const item = this.items.get(id)
    if (!item) return { ok: false, reason: `no exhibit ${id}` }

    if (!PARTIES.has(proponent)) {
      return { ok: false, reason: `${proponent || 'that participant'} has no standing to introduce evidence` }
    }
    if (item.proponent && item.proponent !== proponent) {
      return { ok: false, reason: `${id} is the ${item.proponent}'s exhibit; ${proponent} cannot introduce it` }
    }

    const moved = this.#transition(id, EVIDENCE_STATUS.INTRODUCED, proponent, 'introduced in evidence')
    if (moved.ok) {
      item.introducedBy = proponent
      moved.item = this.get(id)
    }
    return moved
  }

  admit(id, by = ROLES.JUDGE) {
    if (!BENCH.has(by)) return { ok: false, reason: 'only the bench may admit evidence' }
    const moved = this.#transition(id, EVIDENCE_STATUS.ADMITTED, by, 'admitted in evidence')
    if (moved.ok) this.#stampRuling(id, by, 'admitted in evidence')
    return moved.ok ? { ...moved, item: this.get(id) } : moved
  }

  exclude(id, by = ROLES.JUDGE, reason = 'inadmissible') {
    if (!BENCH.has(by)) return { ok: false, reason: 'only the bench may exclude evidence' }
    const moved = this.#transition(id, EVIDENCE_STATUS.EXCLUDED, by, reason)
    if (moved.ok) this.#stampRuling(id, by, reason)
    return moved.ok ? { ...moved, item: this.get(id) } : moved
  }

  /**
   * Park an exhibit while an objection to it is decided. Either party may dispute,
   * including the side that owns it — an exhibit is sometimes challenged for
   * authenticity by the very side that has to prove it up.
   */
  dispute(id, by, reason = 'admissibility challenged') {
    if (!PARTIES.has(by) && !BENCH.has(by)) {
      return { ok: false, reason: `${by || 'that participant'} has no standing to dispute evidence` }
    }
    return this.#transition(id, EVIDENCE_STATUS.DISPUTED, by, reason)
  }

  /**
   * Take an exhibit back. Only the side that owns it may, and only before the
   * bench has ruled — the transition table already refuses it out of DISPUTED and
   * the terminal statuses, so this method only has to police ownership.
   */
  withdraw(id, by, reason = 'withdrawn by the proponent') {
    const item = this.items.get(id)
    if (!item) return { ok: false, reason: `no exhibit ${id}` }
    if (item.proponent && by !== item.proponent) {
      return { ok: false, reason: `${id} belongs to the ${item.proponent}; ${by} cannot withdraw it` }
    }
    return this.#transition(id, EVIDENCE_STATUS.WITHDRAWN, by, reason)
  }

  isAdmitted(id) {
    return this.items.get(id)?.status === EVIDENCE_STATUS.ADMITTED
  }

  /**
   * The question the validator actually asks before letting an evidence action
   * through. Three separate rules live here and the reason string says which one
   * failed, because "objection overruled, and here is exactly why" is the point of
   * the whole engine.
   *
   * `as` distinguishes the kinds of reference. Merely naming an exhibit that is
   * marked is fine; asserting it as proved requires admission; and offering it up
   * requires ownership.
   *
   * @param {string} id
   * @param {string} role
   * @param {object} [opts]  { as: 'mention' | 'admitted' | 'introduce' }
   */
  canReference(id, role, { as = 'mention' } = {}) {
    const item = this.items.get(id)
    if (!item) return { ok: false, reason: `there is no exhibit ${id} on the record` }

    // Excluded and withdrawn material is unmentionable by anyone in any manner,
    // which is why this is checked before role or intent.
    if (!MENTIONABLE.has(item.status)) {
      return { ok: false, reason: `${id} is ${item.status.toLowerCase()} and may not be referred to`, status: item.status }
    }

    if (as === 'admitted') {
      if (item.status !== EVIDENCE_STATUS.ADMITTED) {
        return {
          ok: false,
          status: item.status,
          reason: `${id} is only ${item.status.toLowerCase()}; it cannot be relied on as admitted evidence`,
        }
      }
      return { ok: true, status: item.status }
    }

    if (as === 'introduce') {
      if (!PARTIES.has(role)) {
        return { ok: false, status: item.status, reason: `${role || 'that participant'} may not tender evidence` }
      }
      if (item.proponent && item.proponent !== role) {
        return { ok: false, status: item.status, reason: `${id} is the ${item.proponent}'s exhibit` }
      }
      if (!isLegalTransition(item.status, EVIDENCE_STATUS.INTRODUCED)) {
        return { ok: false, status: item.status, reason: `${id} is already ${item.status.toLowerCase()}` }
      }
      return { ok: true, status: item.status }
    }

    // A witness may be shown a marked exhibit and asked about it, but has no
    // business volunteering one, so a witness reference is only ever a mention.
    return { ok: true, status: item.status }
  }

  /** The single choke point every status change goes through. */
  #transition(id, to, by, reason) {
    const item = this.items.get(id)
    if (!item) return { ok: false, reason: `no exhibit ${id}` }

    const from = item.status
    if (from === to) return { ok: false, reason: `${id} is already ${to.toLowerCase()}`, status: from }
    if (TERMINAL_STATUSES.has(from)) {
      return { ok: false, reason: `${id} is ${from.toLowerCase()} and that is final`, status: from }
    }
    if (!isLegalTransition(from, to)) {
      return { ok: false, reason: `${id} cannot go from ${from.toLowerCase()} to ${to.toLowerCase()}`, status: from }
    }

    item.status = to
    this.#record({ id, from, to, by: by || 'unknown', reason })
    return { ok: true, id, from, to, status: to, item: this.get(id) }
  }

  #stampRuling(id, by, reason) {
    const item = this.items.get(id)
    if (!item) return
    item.ruledBy = by
    item.ruledAt = new Date().toISOString()
    item.reason = reason
  }

  #record(entry) {
    this.history.push({ ...entry, at: new Date().toISOString(), seq: this.history.length })
    return entry
  }

  /**
   * Which side is doing better on the record, in exhibit terms only. The judge
   * agent needs this to write a judgment that matches what was actually admitted
   * rather than what was argued.
   */
  tally() {
    const out = {}
    for (const status of STATUS_LIST) out[status] = 0
    for (const item of this.items.values()) out[item.status] += 1
    return out
  }

  snapshot() {
    return {
      items: this.all(),
      admitted: this.admitted().map((i) => i.id),
      excluded: this.byStatus(EVIDENCE_STATUS.EXCLUDED).map((i) => i.id),
      disputed: this.byStatus(EVIDENCE_STATUS.DISPUTED).map((i) => i.id),
      withdrawn: this.byStatus(EVIDENCE_STATUS.WITHDRAWN).map((i) => i.id),
      tally: this.tally(),
      history: [...this.history],
    }
  }
}
