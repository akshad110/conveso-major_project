/**
 * The airlock between a language model and the state machine.
 *
 * Models produce almost-JSON. They wrap it in a fenced block, apologise before
 * it, explain it afterwards, leave a trailing comma, use single quotes because
 * they were thinking in Python, or write None where null belongs. None of that
 * should reach the validator, and none of it should stop the trial.
 *
 * So nothing in this file throws. Every function has a defined answer for
 * garbage, and coerceDecision() will always hand back a decision the role is
 * actually allowed to take — falling back to LISTEN, which is always safe because
 * a character standing quietly is a legitimate courtroom beat and an invalid
 * action is not. Whatever had to be fixed or discarded is reported in `issues`
 * so the debug overlay can show that the model misbehaved without the audience
 * ever seeing it.
 */
import { ACTIONS, ACTION_LIST, allowedActionsFor } from '../courtroomActions.js'

/** How long a spoken line may be before it stops being dialogue. */
const MAX_SPEECH = 600
const MAX_REASON = 300

/**
 * Keys a model invents when it starts thinking like a renderer. Stripped rather
 * than passed through, because courtroomEvents.js is the only thing allowed to
 * decide animation and camera and a model-supplied value would silently override
 * a deliberate mapping.
 */
const RENDERER_KEYS = new Set([
  'animation', 'anim', 'clip', 'clipname', 'animationname', 'camera', 'cameraangle',
  'shot', 'position', 'coordinates', 'coords', 'rotation', 'scale', 'transform',
  'x', 'y', 'z', 'gesture', 'pose', 'mixer', 'model', 'glb', 'bone', 'blendshape',
])

/** The fields a decision is allowed to carry through to the engine. */
const KEEP_KEYS = new Set([
  'action', 'speech', 'reason', 'target', 'evidence', 'objectionCategory', 'ruling',
  'emotion', 'phase', 'confidence',
])

/**
 * Words a model reaches for instead of the action name we asked for. Mapping
 * these is not leniency for its own sake: the intent is unambiguous, and turning
 * a clear OBJECTION into a silent LISTEN would lose a real courtroom beat.
 */
const SYNONYMS = {
  OBJECTION: ACTIONS.OBJECT,
  OBJECTING: ACTIONS.OBJECT,
  OBJECTS: ACTIONS.OBJECT,
  TESTIFY: ACTIONS.ANSWER,
  TESTIFYING: ACTIONS.ANSWER,
  TESTIMONY: ACTIONS.ANSWER,
  RESPOND: ACTIONS.ANSWER,
  RESPONSE: ACTIONS.ANSWER,
  REPLY: ACTIONS.ANSWER,
  ANSWERING: ACTIONS.ANSWER,
  RULING: ACTIONS.RULE,
  RULES: ACTIONS.RULE,
  DECIDE: ACTIONS.RULE,
  DECISION: ACTIONS.RULE,
  SUSTAIN: ACTIONS.RULE,
  OVERRULE: ACTIONS.RULE,
  SPEAKING: ACTIONS.SPEAK,
  SPEAKS: ACTIONS.SPEAK,
  SAY: ACTIONS.SPEAK,
  STATEMENT: ACTIONS.SPEAK,
  ADDRESS: ACTIONS.SPEAK,
  ANNOUNCE: ACTIONS.SPEAK,
  SILENT: ACTIONS.WAIT,
  SILENCE: ACTIONS.WAIT,
  NOTHING: ACTIONS.WAIT,
  NONE: ACTIONS.WAIT,
  PASS: ACTIONS.WAIT,
  IDLE: ACTIONS.WAIT,
  PRESENT: ACTIONS.PRESENT_EVIDENCE,
  SUBMIT_EVIDENCE: ACTIONS.PRESENT_EVIDENCE,
  SUBMIT: ACTIONS.PRESENT_EVIDENCE,
  DISPLAY_EVIDENCE: ACTIONS.SHOW_EVIDENCE,
  SHOW: ACTIONS.SHOW_EVIDENCE,
  QUESTION: ACTIONS.QUESTION_WITNESS,
  ASK: ACTIONS.QUESTION_WITNESS,
  EXAMINE: ACTIONS.QUESTION_WITNESS,
  CROSS_EXAMINE: ACTIONS.QUESTION_WITNESS,
  ADMIT: ACTIONS.ADMIT_EVIDENCE,
  ACCEPT_EVIDENCE: ACTIONS.ADMIT_EVIDENCE,
  EXCLUDE: ACTIONS.EXCLUDE_EVIDENCE,
  REJECT_EVIDENCE: ACTIONS.EXCLUDE_EVIDENCE,
  BANG_GAVEL: ACTIONS.GAVEL,
  ORDER: ACTIONS.GAVEL,
  OBSERVE: ACTIONS.LISTEN,
  LISTENING: ACTIONS.LISTEN,
  WATCH: ACTIONS.LISTEN,
  STAND_UP: ACTIONS.STAND,
  RISE: ACTIONS.STAND,
  SIT_DOWN: ACTIONS.SIT,
  BE_SEATED: ACTIONS.SIT,
}

/**
 * Pull the first complete JSON object out of arbitrary text.
 *
 * Balance-scanned rather than regex-matched, because the failure a regex has here
 * is the common one: a brace inside a quoted string. `{"speech":"He said }no}"}`
 * is valid JSON and a greedy or lazy regex mangles it either way. Tracking string
 * state and escapes costs a few lines and gets it right.
 */
export function extractJson(text) {
  if (text == null) return null
  let src = String(text)
  if (!src.trim()) return null

  // A fenced block, if there is one, is the model's own answer to "where is the
  // JSON" — trust it and scan inside it first.
  const fence = /```(?:json|JSON)?\s*([\s\S]*?)```/.exec(src)
  if (fence && fence[1].includes('{')) src = fence[1]

  const start = src.indexOf('{')
  if (start === -1) return null

  for (let from = start; from !== -1; from = src.indexOf('{', from + 1)) {
    const found = scanObject(src, from)
    if (found) return found
  }
  return null
}

/** Walk from an opening brace to its true partner, ignoring braces in strings. */
function scanObject(src, start) {
  let depth = 0
  let inString = false
  let quote = null
  let escaped = false

  for (let i = start; i < src.length; i += 1) {
    const ch = src[i]

    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      // Single quotes count as string delimiters here even though JSON forbids
      // them, because repairJson() may still rescue the text and a `}` inside a
      // 'single quoted' value must not end the scan early.
      else if (ch === quote) { inString = false; quote = null }
      continue
    }

    if (ch === '"' || ch === "'") { inString = true; quote = ch; continue }
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) return src.slice(start, i + 1)
      if (depth < 0) return null
    }
  }
  return null
}

/**
 * Make a model's near-JSON parseable.
 *
 * Applied in a fixed order, and only ever as a second attempt after plain
 * JSON.parse has failed, so well-formed output is never touched. Every rule here
 * corresponds to a slip models actually make rather than to a hypothetical one.
 */
export function repairJson(text) {
  if (text == null) return ''
  let s = String(text).trim()

  // Strip a fence the caller left on.
  s = s.replace(/^```(?:json|JSON)?\s*/, '').replace(/```\s*$/, '').trim()

  // Smart quotes and dashes, which arrive whenever the model is being literary.
  s = s.replace(/[“”„‟″]/g, '"').replace(/[‘’‚‛′]/g, "'")
  s = s.replace(/–|—/g, '-').replace(/ /g, ' ')

  // Python and JS literals in place of JSON ones.
  s = s.replace(/\b(None|Null|NULL|nil|undefined)\b/g, 'null')
  s = s.replace(/\bTrue\b/g, 'true').replace(/\bFalse\b/g, 'false')

  // Line comments and block comments, which models add when explaining themselves
  // inside the object. Stripped outside strings only.
  s = stripComments(s)

  // Single-quoted keys and values become double-quoted. Done character-wise so an
  // apostrophe inside a double-quoted value ("witness's phone") survives.
  s = requoteSingleQuoted(s)

  // Unquoted keys: {action: "SPEAK"} -> {"action": "SPEAK"}.
  s = quoteBareKeys(s)

  // Trailing commas before a closing brace or bracket.
  s = s.replace(/,\s*([}\]])/g, '$1')

  // Raw newlines inside a string value, which JSON forbids.
  s = escapeNewlinesInStrings(s)

  return s.trim()
}

/**
 * A single left-to-right pass that knows whether it is inside a string. Every
 * repair below needs that knowledge, and doing it once is both faster and safer
 * than three regexes each guessing at it.
 */
function scanTokens(s, handler) {
  let out = ''
  let inString = false
  let quote = null
  let escaped = false
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === quote) { inString = false; quote = null }
      out += handler.inString ? handler.inString(ch, i, quote) : ch
      continue
    }
    if (ch === '"' || ch === "'") {
      inString = true
      quote = ch
      out += handler.openString ? handler.openString(ch, i) : ch
      continue
    }
    out += handler.outside ? handler.outside(ch, i, s, out) : ch
  }
  return out
}

function stripComments(s) {
  let out = ''
  let inString = false
  let quote = null
  let escaped = false
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i]
    if (inString) {
      out += ch
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === quote) { inString = false; quote = null }
      continue
    }
    if (ch === '"' || ch === "'") { inString = true; quote = ch; out += ch; continue }
    if (ch === '/' && s[i + 1] === '/') {
      while (i < s.length && s[i] !== '\n') i += 1
      out += '\n'
      continue
    }
    if (ch === '/' && s[i + 1] === '*') {
      i += 2
      while (i < s.length && !(s[i] === '*' && s[i + 1] === '/')) i += 1
      i += 1
      continue
    }
    out += ch
  }
  return out
}

/**
 * Turn 'single quoted' spans into "double quoted" ones, escaping any double quote
 * that was inside them. An apostrophe in the middle of a word is left alone,
 * since a lone `'` between letters is possession, not a string.
 */
function requoteSingleQuoted(s) {
  let out = ''
  let i = 0
  while (i < s.length) {
    const ch = s[i]
    if (ch === '"') {
      // Copy a double-quoted string through untouched.
      out += ch
      i += 1
      while (i < s.length) {
        if (s[i] === '\\') { out += s[i] + (s[i + 1] ?? ''); i += 2; continue }
        out += s[i]
        if (s[i] === '"') { i += 1; break }
        i += 1
      }
      continue
    }
    if (ch === "'") {
      const prev = out.replace(/\s+$/, '').slice(-1)
      // A single quote only opens a string where a value or key may begin.
      if (prev && !'{[:,'.includes(prev)) { out += ch; i += 1; continue }
      let body = ''
      i += 1
      while (i < s.length && s[i] !== "'") {
        if (s[i] === '\\') {
          // A `\'` was only ever escaping the old delimiter. Carried through it
          // becomes an invalid JSON escape and the repair fails at the last
          // step, which is how `'I don\'t recall'` used to be lost entirely.
          if (s[i + 1] === "'") { body += "'"; i += 2; continue }
          body += s[i] + (s[i + 1] ?? '')
          i += 2
          continue
        }
        body += s[i]
        i += 1
      }
      i += 1
      out += `"${body.replace(/"/g, '\\"')}"`
      continue
    }
    out += ch
    i += 1
  }
  return out
}

/** Quote bare object keys, leaving anything already quoted alone. */
function quoteBareKeys(s) {
  let out = ''
  let inString = false
  let escaped = false
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i]
    if (inString) {
      out += ch
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') { inString = true; out += ch; continue }
    if (/[A-Za-z_$]/.test(ch)) {
      const m = /^[A-Za-z_$][\w$]*/.exec(s.slice(i))
      const word = m[0]
      const after = s.slice(i + word.length)
      const isKey = /^\s*:/.test(after) && /[{,]\s*$/.test(out)
      out += isKey ? `"${word}"` : word
      i += word.length - 1
      continue
    }
    out += ch
  }
  return out
}

function escapeNewlinesInStrings(s) {
  return scanTokens(s, {
    inString: (ch) => (ch === '\n' ? '\\n' : ch === '\r' ? '' : ch === '\t' ? '\\t' : ch),
  })
}

/**
 * Turn whatever the model produced into a decision the engine can act on.
 *
 * `ok` reports whether the model gave us something usable as-is; a false `ok`
 * with a valid decision is the normal degraded path, and callers are expected to
 * use the decision either way. That is the whole design: there is no error branch
 * to write at the call site, only a log line.
 */
export function coerceDecision(raw, { role, allowedActions } = {}) {
  const issues = []
  const resolvedRole = String(role || '').toLowerCase() || null
  const allowed = (allowedActions && allowedActions.length)
    ? allowedActions.map((a) => String(a).toUpperCase())
    : allowedActionsFor(resolvedRole)
  const fallback = allowed.includes(ACTIONS.LISTEN)
    ? ACTIONS.LISTEN
    : (allowed.includes(ACTIONS.WAIT) ? ACTIONS.WAIT : (allowed[0] || ACTIONS.WAIT))

  const safe = (action, reason) => ({
    ok: false,
    decision: {
      role: resolvedRole, action, speech: '', reason, target: null, fallback: true,
    },
    issues,
  })

  // A string still wrapped in prose is a common way for this to be called, so
  // handle it rather than rejecting it.
  let obj = raw
  if (typeof obj === 'string') {
    const inner = extractJson(obj)
    obj = safeParse(inner ?? obj) ?? safeParse(repairJson(inner ?? obj))
    if (!obj) issues.push('model output was not parseable JSON')
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    issues.push('no decision object present')
    return safe(fallback, 'Model produced no usable decision; holding position.')
  }

  // Some models nest the answer under a wrapper key. Unwrap one level if the
  // outer object plainly is not the decision.
  if (!obj.action && !obj.speech) {
    const nested = obj.decision || obj.response || obj.output || obj.result
    if (nested && typeof nested === 'object') {
      issues.push('decision was nested inside a wrapper object')
      obj = nested
    }
  }

  const stripped = []
  const kept = {}
  for (const [key, value] of Object.entries(obj)) {
    const lower = key.toLowerCase()
    if (RENDERER_KEYS.has(lower)) { stripped.push(key); continue }
    if (KEEP_KEYS.has(key)) kept[key] = value
    else if (KEEP_KEYS.has(lower)) kept[lower] = value
    else stripped.push(key)
  }
  if (stripped.length) {
    issues.push(`stripped keys the engine owns or does not accept: ${stripped.join(', ')}`)
  }

  // --- action ----------------------------------------------------------------
  const rawAction = firstString(kept.action)
  let action = normaliseActionName(rawAction)
  let fellBack = false

  if (!action) {
    issues.push(rawAction ? `unrecognised action "${rawAction}"` : 'no action given')
    action = inferAction(kept, allowed) || fallback
    fellBack = true
  } else if (!allowed.includes(action)) {
    const mapped = SYNONYMS[action]
    if (mapped && allowed.includes(mapped)) {
      issues.push(`action ${action} mapped to ${mapped} for role ${resolvedRole}`)
      action = mapped
    } else if (!ACTION_LIST.includes(action)) {
      issues.push(`action ${action} is not in the vocabulary; using ${fallback}`)
      action = fallback
      fellBack = true
    } else {
      issues.push(`action ${action} is not permitted for role ${resolvedRole}; using ${fallback}`)
      action = fallback
      fellBack = true
    }
  }

  // --- speech ----------------------------------------------------------------
  let speech = firstString(kept.speech) || ''
  if (typeof kept.speech === 'object' && kept.speech !== null) {
    issues.push('speech was not a string')
    speech = ''
  }
  speech = speech.replace(/\s+/g, ' ').trim()
  if (speech.length > MAX_SPEECH) {
    issues.push(`speech truncated from ${speech.length} to ${MAX_SPEECH} characters`)
    speech = `${speech.slice(0, MAX_SPEECH).replace(/\s+\S*$/, '')}...`
  }
  // A silent action that carries dialogue is a contradiction; the action wins,
  // because the state machine has already been told what may be said.
  if ((action === ACTIONS.LISTEN || action === ACTIONS.WAIT) && speech) {
    issues.push(`${action} carried speech; dropped it`)
    speech = ''
  }

  let reason = firstString(kept.reason) || (fellBack ? 'Substituted a permitted action.' : '')
  reason = reason.replace(/\s+/g, ' ').trim().slice(0, MAX_REASON)

  const decision = {
    role: resolvedRole,
    action,
    speech,
    reason,
    target: normaliseTarget(kept.target),
  }

  const evidence = firstString(kept.evidence)
  if (evidence) decision.evidence = evidence.trim()

  const category = firstString(kept.objectionCategory)
  if (category) decision.objectionCategory = category.toUpperCase().replace(/[^A-Z_]/g, '_').replace(/_+/g, '_')

  const ruling = normaliseRuling(kept.ruling, speech)
  if (ruling) decision.ruling = ruling
  if (action === ACTIONS.RULE && !decision.ruling) {
    issues.push('RULE without a ruling; defaulted to OVERRULE')
    decision.ruling = 'OVERRULE'
  }

  if (fellBack) decision.fallback = true
  if (rawAction && normaliseActionName(rawAction) !== action) decision.fallbackFrom = String(rawAction).toUpperCase()

  return { ok: issues.length === 0, decision, issues }
}

/** extract -> repair -> coerce. The path almost every caller wants. */
export function parseDecision(text, opts = {}) {
  const extracted = extractJson(text)
  let parsed = extracted ? safeParse(extracted) : null
  const issues = []

  if (!parsed && extracted) {
    parsed = safeParse(repairJson(extracted))
    if (parsed) issues.push('JSON required repair before parsing')
  }
  if (!parsed) {
    parsed = safeParse(repairJson(text))
    if (parsed) issues.push('JSON recovered only after repairing the whole reply')
  }
  if (!parsed) {
    issues.push('no JSON object could be recovered from the reply')
    // One last try: some replies are pure prose. Reading an action word and the
    // prose itself as speech is better than a silent LISTEN when the model
    // clearly meant to say something.
    parsed = salvageFromProse(text)
    if (parsed) issues.push('decision salvaged from prose')
  }

  const result = coerceDecision(parsed, opts)
  return { ...result, issues: [...issues, ...result.issues], ok: result.ok && issues.length === 0 }
}

// --- small helpers -----------------------------------------------------------

function safeParse(text) {
  if (typeof text !== 'string' || !text.trim()) return null
  try {
    const value = JSON.parse(text)
    return value && typeof value === 'object' ? value : null
  } catch {
    return null
  }
}

function firstString(value) {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) {
    const first = value.find((v) => typeof v === 'string')
    return first ? String(first) : ''
  }
  return ''
}

function normaliseActionName(name) {
  if (!name) return null
  const key = String(name).trim().toUpperCase().replace(/[\s-]+/g, '_').replace(/[^A-Z_]/g, '')
  if (!key) return null
  if (ACTION_LIST.includes(key)) return key
  return SYNONYMS[key] || null
}

/** No usable action name, so read the intent off the other fields. */
function inferAction(kept, allowed) {
  const has = (a) => allowed.includes(a)
  if (kept.ruling && has(ACTIONS.RULE)) return ACTIONS.RULE
  if (kept.objectionCategory && has(ACTIONS.OBJECT)) return ACTIONS.OBJECT
  if (kept.evidence && has(ACTIONS.PRESENT_EVIDENCE)) return ACTIONS.PRESENT_EVIDENCE
  const speech = firstString(kept.speech)
  if (speech && /\?\s*$/.test(speech.trim()) && has(ACTIONS.QUESTION_WITNESS)) return ACTIONS.QUESTION_WITNESS
  if (speech && has(ACTIONS.ANSWER) && !has(ACTIONS.SPEAK)) return ACTIONS.ANSWER
  if (speech && has(ACTIONS.SPEAK)) return ACTIONS.SPEAK
  return null
}

function normaliseTarget(value) {
  const t = firstString(value).trim().toLowerCase()
  if (!t || t === 'null' || t === 'none' || t === 'nobody') return null
  if (t.includes('honour') || t.includes('honor') || t.includes('bench') || t.includes('judge')) return 'judge'
  if (t.includes('witness')) return 'witness'
  if (t.includes('counsel') || t.includes('advocate') || t.includes('lawyer')) return 'counsel'
  if (t.includes('court') || t.includes('everyone') || t.includes('all')) return 'court'
  return t.replace(/[^a-z_]/g, '') || null
}

function normaliseRuling(value, speech) {
  const r = firstString(value).toUpperCase()
  if (r.includes('SUSTAIN')) return 'SUSTAIN'
  if (r.includes('OVERRULE')) return 'OVERRULE'
  // Judges say the ruling out loud far more reliably than they fill in the field.
  const s = String(speech || '').toUpperCase()
  if (s.includes('SUSTAIN')) return 'SUSTAIN'
  if (s.includes('OVERRULE')) return 'OVERRULE'
  return null
}

/**
 * A reply with no JSON at all. Look for an action word and keep the prose as the
 * spoken line, so a chatty model still produces a usable courtroom beat.
 */
function salvageFromProse(text) {
  const s = String(text ?? '').trim()
  if (!s) return null
  const upper = s.toUpperCase()
  const found = ACTION_LIST.find((a) => new RegExp(`\\b${a}\\b`).test(upper))
    || Object.keys(SYNONYMS).find((k) => new RegExp(`\\b${k}\\b`).test(upper))
  const speech = s.replace(/```[\s\S]*?```/g, ' ').replace(/\s+/g, ' ').trim()
  // Salvage needs something to salvage. An action word counts, and so does a real
  // sentence, but punctuation or a stray token does not — putting "..." in a
  // character's mouth is worse than letting them stand quietly.
  const looksLikeSpeech = /[A-Za-z]{3,}/.test(speech) && speech.split(/\s+/).length >= 3
  if (!found && !looksLikeSpeech) return null
  return {
    action: found ? (ACTION_LIST.includes(found) ? found : SYNONYMS[found]) : null,
    speech: speech.slice(0, MAX_SPEECH),
    reason: 'Recovered from an unstructured reply.',
    target: null,
  }
}
