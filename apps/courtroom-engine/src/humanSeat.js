/**
 * The human seat — one role at the table played by a person, not an agent.
 *
 * This module is the whole of that difference, and it is deliberately small: it
 * remembers which role the person claimed, and it turns "it is your turn" into a
 * promise the orchestrator can await.
 *
 * What it does *not* do is decide anything. A person's answer is a *proposal*, on
 * exactly the same footing as a language model's: it goes back to the orchestrator
 * and through validateDecision like any other. Nothing here can put an action on
 * the wire and nothing here can approve one — a client that could would be the
 * frontend making courtroom rulings, which is the one thing the architecture
 * forbids. The role on a submitted decision is taken from this seat rather than
 * from the message, so a client cannot act as someone else either.
 *
 * Three roles are playable. The bench, the prosecution and the defence are the
 * seats a trial can actually be driven from; a witness who writes their own
 * questions or a clerk who chooses the charges is not a part anyone can play.
 */
import { ROLES } from './courtroomActions.js'

export const PLAYABLE_ROLES = [ROLES.JUDGE, ROLES.PROSECUTOR, ROLES.DEFENSE]

export const PLAYABLE_ROLE_LABELS = {
  [ROLES.JUDGE]: 'Judge',
  [ROLES.PROSECUTOR]: 'Prosecutor',
  [ROLES.DEFENSE]: 'Defense lawyer',
}

/** Messages that exist only because somebody is playing. */
export const HUMAN_TYPES = {
  HUMAN_ROLE: 'HUMAN_ROLE',
  YOUR_TURN: 'YOUR_TURN',
  YOUR_TURN_END: 'YOUR_TURN_END',
}

/** How a wait ended. `pass` is a real answer: "no objection". */
export const ANSWER_KINDS = {
  DECISION: 'decision',
  HANDOFF: 'handoff',
  PASS: 'pass',
  CANCELLED: 'cancelled',
}

/**
 * What an incoming answer turned out to be.
 *
 * `STALE` is the one worth explaining. A person's click travels no faster than the
 * court moves, so an answer can arrive after the question it was written for has
 * already closed — they double-clicked Send, or they typed while a refusal came
 * back, or they hit Object a moment after the moment passed. Applying that answer
 * to whatever question happens to be open next is the worst thing the seat could
 * do: it puts words they wrote for one question into their mouth on another. So a
 * late answer is recognised as late and dropped, quietly, because they did nothing
 * wrong. `IGNORED` is different — nothing was pending at all and the client had no
 * question in hand, which is a client bug worth surfacing.
 */
export const SUBMIT_RESULTS = {
  ACCEPTED: 'accepted',
  STALE: 'stale',
  IGNORED: 'ignored',
}

export function isPlayableRole(role) {
  return PLAYABLE_ROLES.includes(String(role || '').toLowerCase())
}

export function playableSeats() {
  return PLAYABLE_ROLES.map((role) => ({ role, label: PLAYABLE_ROLE_LABELS[role] }))
}

export class HumanSeat {
  constructor({ broadcast = () => {} } = {}) {
    this.broadcast = broadcast
    /** The claimed role, or null while the AI plays everyone. */
    this.role = null
    /** The resolver of the open question, while a person is being waited on. */
    this.pending = null
    /** What they were asked, kept so a reconnecting client can catch up. */
    this.prompt = null
    this.turnsPlayed = 0
    this.handOffs = 0
    /**
     * Every question gets a number, and an answer has to name the question it is
     * answering. Without this the seat resolves whatever is open, which is fine
     * until the court moves between a person clicking and the click arriving.
     */
    this.promptSeq = 0
    this.promptId = null
    /** Late answers, counted rather than hidden, so the verifier can see them. */
    this.stale = 0
  }

  /**
   * Take a seat. Refused for any role outside the three, and refused politely
   * rather than by throwing, because this arrives from a socket.
   */
  claim(role) {
    const wanted = String(role || '').toLowerCase()
    if (!isPlayableRole(wanted)) {
      return {
        ok: false,
        reason: `"${role}" is not a playable seat — choose ${PLAYABLE_ROLES.join(', ')}.`,
      }
    }
    // Claiming the seat you are already sitting in is not a seat change, and it
    // happens constantly: the panel re-sends the choice when the socket comes
    // back, and a person who is unsure whether their pick registered clicks it
    // again. Treated as a change it cost them the turn in flight — the hand-off
    // below fired and the AI ruled in their place while they were still reading.
    // So: re-confirm the seat, leave the open question alone.
    if (this.role === wanted) {
      this.announce()
      return { ok: true, role: wanted, label: PLAYABLE_ROLE_LABELS[wanted], unchanged: true }
    }
    // Changing seats with a question open would leave that question addressed to a
    // role nobody holds, so the AI takes the turn that was in flight.
    if (this.pending) this.#resolve({ kind: ANSWER_KINDS.HANDOFF, reason: 'seat changed' })
    this.role = wanted
    this.announce()
    return { ok: true, role: wanted, label: PLAYABLE_ROLE_LABELS[wanted] }
  }

  /** Give the seat back to the AI. */
  release(reason = 'seat released') {
    if (this.pending) this.#resolve({ kind: ANSWER_KINDS.CANCELLED, reason })
    this.role = null
    this.turnsPlayed = 0
    this.handOffs = 0
    this.announce()
    return { ok: true }
  }

  holds(role) {
    return Boolean(this.role) && this.role === role
  }

  waiting() {
    return Boolean(this.pending)
  }

  announce() {
    this.broadcast({
      type: HUMAN_TYPES.HUMAN_ROLE,
      role: this.role,
      label: this.role ? PLAYABLE_ROLE_LABELS[this.role] : null,
      seats: playableSeats(),
      at: new Date().toISOString(),
    })
  }

  /**
   * Put a question to the person and wait for as long as it takes.
   *
   * The trial blocks on this promise on purpose. A courtroom does not carry on
   * without the advocate whose turn it is, and there is no timeout to race:
   * whoever is playing gets a hand-off button instead, which is a decision rather
   * than a deadline.
   *
   * @param {object} prompt what they are being asked, already assembled by the
   *   orchestrator — the legal actions, the exhibits, the question on the floor
   * @returns {Promise<{kind:string, payload?:object, reason?:string}>}
   */
  ask(prompt) {
    if (this.pending) this.#resolve({ kind: ANSWER_KINDS.CANCELLED, reason: 'superseded' })
    this.promptSeq += 1
    this.promptId = this.promptSeq
    this.prompt = { ...prompt, id: this.promptId, role: this.role || prompt.role }
    this.broadcast({
      type: HUMAN_TYPES.YOUR_TURN,
      ...this.prompt,
      at: new Date().toISOString(),
    })
    return new Promise((resolve) => {
      this.pending = resolve
    })
  }

  /**
   * Is this answer still answering the question that is open?
   *
   * A client that names no question is trusted, because that is what every client
   * written before questions had numbers does, and refusing them would be a
   * gratuitous break. A client that names one has to name the right one.
   */
  #current(payload) {
    const replyTo = payload?.replyTo
    if (replyTo === undefined || replyTo === null) return true
    return Number(replyTo) === this.promptId
  }

  /** They answered. Shape only — whether it is *allowed* is decided elsewhere. */
  submit(payload = {}) {
    if (!this.pending) return SUBMIT_RESULTS.IGNORED
    if (!this.#current(payload)) {
      this.stale += 1
      return SUBMIT_RESULTS.STALE
    }
    this.turnsPlayed += 1
    this.#resolve({ kind: ANSWER_KINDS.DECISION, payload })
    return SUBMIT_RESULTS.ACCEPTED
  }

  /** "Let the AI take this turn." */
  handOff(payload = {}) {
    if (!this.pending) return SUBMIT_RESULTS.IGNORED
    if (!this.#current(payload)) {
      this.stale += 1
      return SUBMIT_RESULTS.STALE
    }
    this.handOffs += 1
    this.#resolve({ kind: ANSWER_KINDS.HANDOFF })
    return SUBMIT_RESULTS.ACCEPTED
  }

  /** "No objection" — declining an offer, which is not the same as not answering. */
  pass(payload = {}) {
    if (!this.pending) return SUBMIT_RESULTS.IGNORED
    if (!this.#current(payload)) {
      this.stale += 1
      return SUBMIT_RESULTS.STALE
    }
    this.#resolve({ kind: ANSWER_KINDS.PASS })
    return SUBMIT_RESULTS.ACCEPTED
  }

  /** The trial stopped, reset or paused underneath the open question. */
  cancel(reason = 'cancelled') {
    if (!this.pending) return false
    return this.#resolve({ kind: ANSWER_KINDS.CANCELLED, reason })
  }

  #resolve(answer) {
    const done = this.pending
    this.pending = null
    const asked = this.prompt
    this.prompt = null
    this.promptId = null
    if (!done) return false
    this.broadcast({
      type: HUMAN_TYPES.YOUR_TURN_END,
      id: asked?.id ?? null,
      role: asked?.role || this.role,
      kind: asked?.kind || null,
      resolution: answer.kind,
      reason: answer.reason || null,
      at: new Date().toISOString(),
    })
    done(answer)
    return true
  }

  snapshot() {
    return {
      role: this.role,
      label: this.role ? PLAYABLE_ROLE_LABELS[this.role] : null,
      seats: playableSeats(),
      waiting: Boolean(this.pending),
      prompt: this.prompt,
      turnsPlayed: this.turnsPlayed,
      handOffs: this.handOffs,
      stale: this.stale,
    }
  }
}
