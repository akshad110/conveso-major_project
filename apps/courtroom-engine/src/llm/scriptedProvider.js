/**
 * The authored-performance layer.
 *
 * A case file is the *record*: facts, exhibits, who knows what. A script file is
 * the *performance*: the actual words counsel uses, the exact answer a witness
 * gives, the sentence the bench passes. They are separate files because they are
 * separate things — you can run the same case with no script at all and the
 * offline heuristic will argue it competently, just not memorably.
 *
 * This sits exactly where a language model sits: at the transport layer, behind
 * `complete()`. It is handed the same prompt a model would get, reads the role,
 * phase and witness out of it, and returns an authored decision in the identical
 * shape. That matters for two reasons:
 *
 *   1. Nothing downstream can tell the difference, so a scripted line goes
 *      through parseDecision and the action validator exactly like a generated
 *      one. A beat that proposes something the role may not do in that phase is
 *      rejected by the engine, not waved through because an author wrote it.
 *   2. The architecture rule holds. The script decides WHAT is said. The engine
 *      still decides WHETHER it is allowed and WHEN it happens. No legal logic
 *      moves in here, and no animation or camera instruction is accepted from a
 *      beat — the frontend keeps deciding how any of it looks.
 *
 * Anything the script does not cover falls through to the wrapped provider, so a
 * trial never stalls on a missing line. That includes every objection, because
 * objections depend on what was actually just asked and cannot be written in
 * advance.
 */

import { existsSync, readFileSync } from 'node:fs'

/** `ROLE: prosecutor` — emitted by prompts.js at the top of every system prompt. */
const RE_ROLE = /^ROLE:[ \t]*([a-z]+)/im
/** `PHASE: DIRECT_EXAMINATION` */
const RE_PHASE = /^PHASE:[ \t]*([A-Z_]+)/im
/** `ON THE STAND: W_GOPI` — absent outside examination. */
const RE_STAND = /^ON THE STAND:[ \t]*([A-Za-z0-9_]+)/im
/** `ALLOWED ACTIONS: SPEAK, LISTEN, ...` */
const RE_ALLOWED = /^ALLOWED ACTIONS:[ \t]*(.+)$/im

/**
 * Read a script off disk. Never throws: a malformed or missing script is not a
 * reason to refuse to hold a trial, it is a reason to fall back to the heuristic.
 */
export function loadScript(path) {
  if (!path || !existsSync(path)) return null
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    const beats = Array.isArray(parsed) ? parsed : parsed.beats
    if (!Array.isArray(beats) || !beats.length) return null
    return beats
      .filter((b) => b && b.role && b.phase && b.action)
      .map((b, i) => ({
        id: b.id || `beat-${i}`,
        role: String(b.role).toLowerCase(),
        phase: String(b.phase).toUpperCase(),
        witness: b.witness || null,
        action: String(b.action).toUpperCase(),
        speech: typeof b.speech === 'string' ? b.speech : '',
        reason: b.reason || 'Authored beat.',
        target: b.target || null,
        // The decision contract calls this `evidence` and expects a bare exhibit
        // id. Accept the friendlier spelling in the script file and normalise.
        evidence: b.evidence || b.evidenceId || null,
        ruling: b.ruling || null,
      }))
  } catch {
    return null
  }
}

function readBeatContext(req = {}) {
  const text = [req.system, ...(req.messages || []).map((m) => m?.content)]
    .filter(Boolean)
    .join('\n')
  const allowedRaw = RE_ALLOWED.exec(text)?.[1] || ''
  return {
    role: RE_ROLE.exec(text)?.[1]?.toLowerCase() || null,
    phase: RE_PHASE.exec(text)?.[1]?.toUpperCase() || null,
    witness: RE_STAND.exec(text)?.[1] || null,
    allowed: allowedRaw.toUpperCase().match(/[A-Z_]{3,}/g) || [],
  }
}

/**
 * Wrap a provider so authored beats are preferred and everything else falls
 * through. `fallback` is used as-is — usually the offline heuristic, but a real
 * model works just as well, which gives you an authored spine with generated
 * improvisation around it.
 */
export function createScriptedProvider({ beats, fallback, log = () => {} }) {
  const remaining = beats.map((b) => ({ ...b, used: false }))

  return {
    name: 'scripted',
    model: `authored-script+${fallback?.name || 'none'}`,
    available: true,

    async complete(req = {}) {
      const ctx = readBeatContext(req)
      if (!ctx.role || !ctx.phase) return fallback.complete(req)

      // First unused beat for this role in this phase, and — during examination —
      // for this witness. Declaration order is the running order, which is what
      // makes a written question and its written answer stay paired.
      const beat = remaining.find((b) => (
        !b.used
        && b.role === ctx.role
        && b.phase === ctx.phase
        && (!b.witness || b.witness === ctx.witness)
      ))

      if (!beat) return fallback.complete(req)

      // A beat that the phase does not permit is an authoring mistake. Hand the
      // turn to the fallback rather than push an invalid action at the validator
      // and spend the turn on a rejection.
      if (ctx.allowed.length && !ctx.allowed.includes(beat.action)) {
        log(`[script] ${beat.id} proposes ${beat.action}, not permitted here — falling back`)
        return fallback.complete(req)
      }

      beat.used = true

      const decision = { action: beat.action, speech: beat.speech, reason: beat.reason }
      if (beat.target) decision.target = beat.target
      if (beat.evidence) decision.evidence = beat.evidence
      if (beat.ruling) decision.ruling = beat.ruling

      return {
        text: JSON.stringify(decision),
        raw: { scripted: true, beat: beat.id, decision },
        provider: 'scripted',
        model: 'authored-script',
      }
    },

    /** Diagnostics for the verifier and the tests. */
    scriptStatus() {
      return {
        total: remaining.length,
        used: remaining.filter((b) => b.used).length,
        unused: remaining.filter((b) => !b.used).map((b) => b.id),
      }
    },
  }
}

/**
 * Give a case its voice, if it has one written down.
 *
 * Looks for a script sitting beside the case file it came from — `foo.json` ->
 * `foo.script.json` — and wraps the provider when one is there. A case with no
 * script is returned untouched, which is why this can be called unconditionally.
 */
export function attachScript(provider, caseManager, log = () => {}) {
  const source = caseManager?.sourcePath
  if (!source) return provider

  const beats = loadScript(source.replace(/\.json$/, '.script.json'))
  if (!beats) return provider

  log(`[script] ${beats.length} authored beats for ${caseManager.data.caseId}`)
  return createScriptedProvider({ beats, fallback: provider, log })
}
