/**
 * The event queue — the engine's answer to "when does that happen?"
 *
 * Validated events arrive here and leave one at a time, in order, each given room
 * to actually play in the 3D scene before the next one starts. Without this the
 * renderer would receive a judge's ruling and a witness's answer in the same
 * frame and both animations would fight over the same characters.
 *
 * Two things make it more than a list:
 *
 *   Streaming. A speaking event is not a single moment, it is a line of dialogue
 *   delivered over several seconds. The queue emits STREAM_START, then tokens, then
 *   STREAM_END, which is what lets the frontend reveal text at a readable pace and
 *   what a TTS layer would hook into later.
 *
 *   Interruption. An objection is precisely the case where the strict ordering has
 *   to bend: counsel cuts across a witness mid-sentence. `interrupt()` pauses the
 *   line in flight, plays the interrupting sequence, then resumes the original
 *   speaker from the exact character they were cut off at. Everything else waits
 *   its turn — only the objection engine and the bench get to jump the queue.
 *
 * The queue knows nothing about courtroom rules. By the time an event reaches it,
 * the validator has already decided it is allowed.
 */
import {
  MESSAGE_TYPES, buildStreamStart, buildStreamToken, buildStreamPause,
  buildStreamResume, buildStreamEnd,
} from './courtroomEvents.js'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Split a line into deliverable chunks. Words, so text never breaks mid-word. */
function tokenize(text) {
  return String(text).match(/\S+\s*/g) || []
}

export class EventQueue {
  /**
   * @param {object} opts
   * @param {(msg:object)=>void} opts.emit       where every message goes
   * @param {number} [opts.speed]                1 = real time, 0 = instant (tests)
   * @param {number} [opts.tokenIntervalMs]      pace of streamed dialogue
   * @param {boolean} [opts.stream]              false = whole lines, no tokens
   */
  constructor({ emit, speed = 1, tokenIntervalMs = 55, stream = true } = {}) {
    this.emit = typeof emit === 'function' ? emit : () => {}
    this.speed = speed
    this.tokenIntervalMs = tokenIntervalMs
    this.stream = stream

    /** Events awaiting their turn. */
    this.queue = []
    /** Events that jumped the queue and must play before anything else. */
    this.priority = []
    /** The event currently on screen, if any. */
    this.current = null
    this.running = false
    this.stopped = false
    /** Set when an interrupt lands while a line is mid-delivery. */
    this.interrupted = false
    this.emitted = 0
    /** Resolvers waiting on drain(). */
    this.#idleWaiters = []
  }

  #idleWaiters

  get length() {
    return this.priority.length + this.queue.length
  }

  get busy() {
    return this.running || this.length > 0
  }

  /** Real-world wait, scaled. `speed: 0` collapses all timing for tests. */
  async #wait(ms) {
    if (this.speed <= 0 || ms <= 0) return
    await sleep(Math.round(ms / this.speed))
  }

  /** Add to the back of the queue and make sure the pump is running. */
  enqueue(events) {
    // A stopped queue takes nothing. Accepting an event it will never play would
    // leave it permanently non-empty, and anything waiting on drain() would wait
    // for a pump that is never coming back.
    if (this.stopped) return this.length
    const list = Array.isArray(events) ? events : [events]
    for (const event of list) if (event) this.queue.push(event)
    this.#pump()
    return this.length
  }

  /**
   * Jump the queue. The in-flight line is paused rather than abandoned: the
   * speaker gets to finish it once the interruption is resolved, which is what
   * makes an objection feel like an interruption rather than a scene change.
   */
  interrupt(events) {
    if (this.stopped) return this.length
    const list = Array.isArray(events) ? events : [events]
    for (const event of list) if (event) this.priority.push(event)
    if (this.running) this.interrupted = true
    this.#pump()
    return this.length
  }

  /** Resolve once the queue has emptied and nothing is in flight. */
  drain() {
    if (this.stopped || !this.busy) return Promise.resolve()
    return new Promise((resolve) => this.#idleWaiters.push(resolve))
  }

  clear() {
    this.queue = []
    this.priority = []
  }

  stop() {
    this.stopped = true
    this.clear()
    this.#releaseIdle()
  }

  /**
   * Back into service after a stop. STOP is not the end of the trial — the court
   * can be started again — and without this the queue would accept the new
   * session's events and never play them.
   */
  resume() {
    if (!this.stopped) return
    this.stopped = false
    this.#pump()
  }

  #releaseIdle() {
    const waiters = this.#idleWaiters
    this.#idleWaiters = []
    for (const resolve of waiters) resolve()
  }

  #next() {
    return this.priority.shift() || this.queue.shift() || null
  }

  /**
   * The pump. Single-flight by design — `running` is the lock, so however many
   * callers enqueue concurrently there is only ever one event playing.
   */
  async #pump() {
    if (this.running || this.stopped) return
    this.running = true

    try {
      let event
      while ((event = this.#next())) {
        if (this.stopped) break
        this.current = event
        await this.#play(event)
        this.current = null
      }
    } finally {
      this.running = false
    }

    // An interrupt could have arrived between the last shift and the unlock.
    if (this.length > 0 && !this.stopped) {
      this.#pump()
      return
    }
    this.#releaseIdle()
  }

  /** Emit one event and hold the floor for as long as it lasts. */
  async #play(event) {
    this.emitted += 1
    this.emit(event)

    const speaks = event.speaks && typeof event.speech === 'string' && event.speech.trim()
    if (!speaks) {
      await this.#holdFor(event.duration ?? 0)
      return
    }
    await this.#deliver(event)
  }

  /**
   * A silent beat. Sliced so an interrupt arriving mid-beat is noticed promptly
   * instead of after the whole duration has elapsed.
   */
  async #holdFor(duration) {
    const slice = 120
    let remaining = duration
    while (remaining > 0 && !this.stopped) {
      if (this.priority.length) {
        // Something urgent is waiting; give up the rest of this beat.
        await this.#runPriority()
        return
      }
      await this.#wait(Math.min(slice, remaining))
      remaining -= slice
    }
  }

  /**
   * Deliver a spoken line token by token, yielding the floor if an objection
   * lands, then picking the same sentence back up.
   */
  async #deliver(event) {
    const agent = event.agent
    const text = event.speech
    const tokens = this.stream ? tokenize(text) : [text]
    const perToken = tokens.length ? Math.max(20, (event.duration ?? 1200) / tokens.length) : 0

    this.emit(buildStreamStart(agent, {
      text, action: event.action, camera: event.camera, streaming: this.stream,
    }))

    let spoken = ''
    let wasInterrupted = false

    for (const token of tokens) {
      if (this.stopped) break

      if (this.priority.length) {
        wasInterrupted = true
        this.emit(buildStreamPause(agent, {
          reason: 'INTERRUPTED',
          by: this.priority[0]?.agent || null,
        }))
        await this.#runPriority()
        // The floor comes back to the original speaker at the exact offset they
        // were cut off at, so the client can carry on the sentence.
        this.emit(buildStreamResume(agent, { from: spoken.length }))
      }

      spoken += token
      if (this.stream) this.emit(buildStreamToken(agent, token))
      await this.#wait(perToken)
    }

    this.emit(buildStreamEnd(agent, { text: spoken || text, interrupted: wasInterrupted }))
    this.interrupted = false
  }

  /**
   * Play out everything on the priority lane before returning the floor. Nested
   * interrupts are not allowed — an objection to an objection would leave the
   * bench with nothing coherent to rule on — so this drains the lane in order.
   */
  async #runPriority() {
    let event
    while ((event = this.priority.shift())) {
      if (this.stopped) break
      const held = this.current
      this.current = event
      this.emitted += 1
      this.emit(event)

      const speaks = event.speaks && typeof event.speech === 'string' && event.speech.trim()
      if (speaks) {
        const tokens = this.stream ? tokenize(event.speech) : [event.speech]
        const perToken = tokens.length ? Math.max(20, (event.duration ?? 1200) / tokens.length) : 0
        this.emit(buildStreamStart(event.agent, {
          text: event.speech, action: event.action, camera: event.camera,
          streaming: this.stream,
        }))
        for (const token of tokens) {
          if (this.stopped) break
          if (this.stream) this.emit(buildStreamToken(event.agent, token))
          await this.#wait(perToken)
        }
        this.emit(buildStreamEnd(event.agent, { text: event.speech, interrupted: false }))
      } else {
        await this.#wait(event.duration ?? 0)
      }
      this.current = held
    }
  }

  snapshot() {
    return {
      pending: this.queue.length,
      priority: this.priority.length,
      current: this.current
        ? { id: this.current.id, event: this.current.event, agent: this.current.agent }
        : null,
      emitted: this.emitted,
      running: this.running,
    }
  }
}

export { MESSAGE_TYPES }
