/**
 * Animation manager.
 *
 * A module-level registry of imperative character handles. Kept outside React
 * state on purpose: playing a clip must never trigger a re-render of the scene.
 * CharacterController registers itself here once its GLB is loaded, and
 * everything else (keyboard debug, the court event system, sequences) drives
 * characters exclusively through playAnimation().
 */

/** role -> { play, stop, getState, role } */
const controllers = new Map()
const listeners = new Set()
const warned = new Set()

export function registerCharacter(role, handle) {
  controllers.set(role, handle)
  warned.delete(role)
  notify()
  return () => {
    if (controllers.get(role) === handle) controllers.delete(role)
    notify()
  }
}

export function getCharacter(role) {
  return controllers.get(role) || null
}

export function registeredRoles() {
  return [...controllers.keys()]
}

function notify() {
  for (const fn of listeners) fn(registeredRoles())
}

export function onRegistryChange(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/**
 * Play a logical action on a character.
 *
 * Never throws for an unknown character or unknown clip: a missing character is
 * a no-op with a console warning, and clip resolution falls back inside the
 * controller (see config/animationMap.js resolveAction).
 *
 * @param {string} character role key, e.g. 'prosecutor'
 * @param {string} animationName logical action, e.g. 'OBJECTION'
 * @param {object} [options] { fade, autoReturn, onFinish, force, timeScale }
 * @returns {object|null} resolution info, or null if the character isn't mounted
 */
export function playAnimation(character, animationName, options = {}) {
  const handle = controllers.get(character)
  if (!handle) {
    // Warn once per role. A role can legitimately be absent — an unmounted
    // variant, a GLB still loading, or a broadcast to everyone — and shouldn't
    // spam the console.
    if (!warned.has(character)) {
      warned.add(character)
      console.warn(
        `[animationManager] no character "${character}" mounted; ignoring ${animationName}` +
          ' (further messages for this role suppressed)',
      )
    }
    return null
  }
  return handle.play(animationName, options)
}

export function characterState(character) {
  const handle = controllers.get(character)
  return handle ? handle.getState() : null
}

/** Bring everyone back to their resting idle. */
export function resetAll() {
  for (const handle of controllers.values()) handle.play('__IDLE__', { fade: 0.4 })
}

// --- sequences ---------------------------------------------------------------

let sequenceToken = 0
let pendingTimers = []

/**
 * Run a timed sequence of steps. Starting a new sequence cancels the previous
 * one, so overlapping court events can't fight each other.
 *
 * step = {
 *   at:        ms offset from sequence start (default 0)
 *   role:      character to drive
 *   action:    logical action
 *   options:   passed through to play()
 *   run:       arbitrary callback (camera moves, evidence, dialogue)
 * }
 */
export function playSequence(steps, { onDone } = {}) {
  cancelSequence()
  const token = ++sequenceToken
  const ordered = [...steps].sort((a, b) => (a.at || 0) - (b.at || 0))
  let last = 0

  for (const step of ordered) {
    const at = step.at || 0
    last = Math.max(last, at)
    pendingTimers.push(
      setTimeout(() => {
        if (token !== sequenceToken) return
        if (step.role && step.action) playAnimation(step.role, step.action, step.options)
        if (typeof step.run === 'function') step.run()
      }, at),
    )
  }

  if (onDone) {
    pendingTimers.push(
      setTimeout(() => {
        if (token === sequenceToken) onDone()
      }, last + 16),
    )
  }
  return token
}

export function cancelSequence() {
  sequenceToken++
  for (const t of pendingTimers) clearTimeout(t)
  pendingTimers = []
}

// --- teardown ----------------------------------------------------------------

/**
 * Let go of every character.
 *
 * This registry is module-level, which is what lets a clip play without
 * re-rendering the scene and is also why it outlives the React tree that filled
 * it. A controller that unmounts removes itself (see the closure returned by
 * `registerCharacter`), so in the ordinary case this finds nothing left to do.
 * The case it exists for is teardown, where the whole scene goes at once and
 * something has to stop the mixers *before* the geometry they animate is
 * disposed — a mixer updating a skeleton whose buffers have been freed is a
 * crash, not a leak.
 *
 * Timers first, because a sequence still in flight would otherwise call
 * `play()` on a character that is already halfway gone.
 */
export function releaseCharacters() {
  cancelSequence()
  for (const handle of controllers.values()) {
    try {
      handle.stop?.()
    } catch (err) {
      console.warn('[animationManager] a character would not stop', err)
    }
  }
  controllers.clear()
  warned.clear()
  notify()
  listeners.clear()
}

// Handy in the browser console while wiring things up.
if (typeof window !== 'undefined') {
  window.courtAnim = { playAnimation, playSequence, characterState, registeredRoles, resetAll }
}
