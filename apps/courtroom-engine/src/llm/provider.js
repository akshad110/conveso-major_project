/**
 * The LLM boundary — one small surface the rest of the engine talks to.
 *
 * Everything above this file (prompts, the decision coercer, the state machine)
 * is provider-agnostic on purpose. A provider here takes a system prompt and a
 * list of messages and returns text. It never sees courtroom rules and it never
 * decides anything: it is a transport, and the offline provider is a transport
 * that happens to be implemented in JavaScript rather than over HTTPS.
 *
 * The offline provider is the reason this design matters. A courtroom that stalls
 * because someone forgot an API key, or because a 429 came back at the wrong
 * moment, is a broken demo. So every network path here ends, on total failure, in
 * the offline provider rather than in a thrown error, and the result is marked
 * `degraded: true` so a caller that cares can tell the difference. The simulation
 * always gets a decision.
 *
 * No dependencies: global fetch, AbortController and node builtins only.
 */
import { ACTIONS, ROLE_ACTIONS, allowedActionsFor } from '../courtroomActions.js'
import { PHASES } from '../courtroomState.js'

export const PROVIDER_NAMES = ['anthropic', 'openai', 'ollama', 'offline']

const DEFAULT_TIMEOUT_MS = 20000
const DEFAULT_RETRIES = 2

/**
 * Which provider to use when nothing was asked for explicitly. Preference order
 * follows what is actually usable rather than what is best: a key that exists is
 * worth more than a key we wish existed, and offline always works.
 */
export function detectProviderName(env = process.env) {
  const explicit = String(env.COURT_LLM_PROVIDER || '').trim().toLowerCase()
  if (explicit && PROVIDER_NAMES.includes(explicit)) return explicit
  if (explicit) return 'offline'
  if (env.ANTHROPIC_API_KEY) return 'anthropic'
  if (env.OPENAI_API_KEY) return 'openai'
  return 'offline'
}

/**
 * Per-provider request shape and response shape. Kept as data rather than as
 * three near-identical functions so the retry, timeout and fallback machinery
 * below is written exactly once and every provider inherits it.
 */
const SPECS = {
  anthropic: {
    defaultModel: 'claude-sonnet-4-5',
    keyEnv: 'ANTHROPIC_API_KEY',
    url: () => 'https://api.anthropic.com/v1/messages',
    headers: (key) => ({
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    }),
    body: ({ model, system, messages, maxTokens, temperature }) => ({
      model,
      max_tokens: maxTokens,
      temperature,
      // Anthropic takes the system prompt out of band, which suits us: the
      // role contract stays clearly separated from the turn's context.
      ...(system ? { system } : {}),
      messages: messages.map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content })),
    }),
    text: (body) => body?.content?.[0]?.text ?? '',
  },

  openai: {
    defaultModel: 'gpt-4o-mini',
    keyEnv: 'OPENAI_API_KEY',
    url: () => 'https://api.openai.com/v1/chat/completions',
    headers: (key) => ({ 'content-type': 'application/json', authorization: `Bearer ${key}` }),
    body: ({ model, system, messages, maxTokens, temperature, json }) => ({
      model,
      max_tokens: maxTokens,
      temperature,
      // OpenAI has no system field, so it becomes the first message.
      messages: [...(system ? [{ role: 'system', content: system }] : []), ...messages],
      ...(json ? { response_format: { type: 'json_object' } } : {}),
    }),
    text: (body) => body?.choices?.[0]?.message?.content ?? '',
  },

  ollama: {
    defaultModel: 'llama3.1',
    // A local daemon needs no key, so it is always considered available; if it
    // is not running the request fails and we degrade to offline like any other
    // transport failure.
    keyEnv: null,
    url: (cfg) => `${cfg.baseUrl || 'http://127.0.0.1:11434'}/api/chat`,
    headers: () => ({ 'content-type': 'application/json' }),
    body: ({ model, system, messages, temperature, json }) => ({
      model,
      stream: false,
      ...(json ? { format: 'json' } : {}),
      options: { temperature },
      messages: [...(system ? [{ role: 'system', content: system }] : []), ...messages],
    }),
    text: (body) => body?.message?.content ?? '',
  },
}

let announced = false

/**
 * Build a provider. Safe to call more than once — the startup log only fires for
 * the first one, because a per-turn provider factory logging every turn would
 * bury everything else in the console.
 */
export function createProvider(config = {}) {
  const env = config.env || process.env
  const name = (config.provider || detectProviderName(env)).toLowerCase()
  const log = config.log === false ? () => {} : (config.log || ((msg) => console.log(msg)))

  const offline = createOfflineProvider(config)
  if (name === 'offline') {
    announceOnce(log, 'offline', offline.model, 'no network calls, deterministic')
    return offline
  }

  const spec = SPECS[name]
  if (!spec) {
    announceOnce(log, 'offline', offline.model, `unknown provider "${name}"`)
    return offline
  }

  const apiKey = config.apiKey || (spec.keyEnv ? env[spec.keyEnv] : null) || null
  const model = config.model || env.COURT_LLM_MODEL || spec.defaultModel
  const timeoutMs = Number(config.timeoutMs || env.COURT_LLM_TIMEOUT_MS || DEFAULT_TIMEOUT_MS)
  const retries = Number.isFinite(config.retries) ? config.retries : DEFAULT_RETRIES
  const available = spec.keyEnv ? Boolean(apiKey) : true

  if (!available) {
    // A configured provider with no credentials is a misconfiguration, not a
    // reason to stop: say so plainly and run offline.
    announceOnce(log, 'offline', offline.model, `${name} selected but ${spec.keyEnv} is not set`)
    return offline
  }

  announceOnce(log, name, model, `timeout ${timeoutMs}ms, ${retries} retries, offline fallback armed`)

  return {
    name,
    model,
    available,
    async complete(req = {}) {
      const payload = normaliseRequest(req)
      try {
        const { body, status } = await callWithRetry({ spec, name, apiKey, model, timeoutMs, retries, payload, config })
        const text = spec.text(body)
        if (!text || !String(text).trim()) throw new Error(`${name} returned empty text (status ${status})`)
        return { text: String(text), raw: body, provider: name, model }
      } catch (err) {
        // The whole point of this file: a dead API degrades the realism of one
        // turn, it does not end the trial.
        const result = await offline.complete(payload)
        return { ...result, degraded: true, degradedFrom: name, error: String(err?.message || err) }
      }
    },
  }
}

function announceOnce(log, name, model, note) {
  if (announced) return
  announced = true
  log(`[llm] provider=${name} model=${model}${note ? ` (${note})` : ''}`)
}

function normaliseRequest({ system, messages, prompt, maxTokens, temperature, json } = {}) {
  const msgs = Array.isArray(messages) && messages.length
    ? messages.map((m) => ({ role: m.role || 'user', content: String(m.content ?? '') }))
    : [{ role: 'user', content: String(prompt ?? '') }]
  return {
    system: system ? String(system) : '',
    messages: msgs,
    maxTokens: Number.isFinite(maxTokens) ? maxTokens : 512,
    temperature: Number.isFinite(temperature) ? temperature : 0.7,
    json: json !== false,
  }
}

/**
 * One HTTP attempt, hard-bounded by an AbortController. Node's fetch has no
 * timeout of its own, so without this a hung socket would hang the courtroom
 * indefinitely — which is the failure mode this engine can least afford.
 */
async function callOnce({ spec, apiKey, model, timeoutMs, payload, config }) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(spec.url(config), {
      method: 'POST',
      headers: spec.headers(apiKey),
      body: JSON.stringify(spec.body({ model, ...payload })),
      signal: controller.signal,
    })
    const status = res.status
    const raw = await res.text()
    if (!res.ok) {
      const err = new Error(`HTTP ${status}: ${raw.slice(0, 300)}`)
      err.status = status
      throw err
    }
    return { status, body: safeJson(raw) }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Retry only what retrying can fix: rate limits, server-side faults and network
 * or abort errors. A 400 or a 401 will fail identically the second time, so it
 * goes straight to the offline fallback instead of burning two more timeouts.
 */
async function callWithRetry({ spec, name, apiKey, model, timeoutMs, retries, payload, config }) {
  let lastErr = null
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await callOnce({ spec, apiKey, model, timeoutMs, payload, config })
    } catch (err) {
      lastErr = err
      const status = err?.status
      const transient = status === 429 || (status >= 500 && status < 600) || status === undefined
      if (!transient || attempt === retries) break
      // 400ms, 800ms, with a little jitter so parallel agents do not resynchronise
      // their retries into a second thundering herd.
      const backoff = 400 * 2 ** attempt + Math.floor(Math.random() * 150)
      await sleep(backoff)
    }
  }
  throw lastErr || new Error(`${name} failed`)
}

function safeJson(text) {
  try {
    return JSON.parse(text)
  } catch {
    return { raw: text }
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// --- the offline provider ----------------------------------------------------

/**
 * A courtroom that runs with no API key at all.
 *
 * This is not a stub returning a fixed line. It reads the prompt it was handed —
 * the same labelled sections prompts.js emits — and works out who is speaking,
 * what phase the trial is in, whether an objection is on the floor, what the last
 * question was and, for a witness, exactly which facts that witness knows. From
 * that it composes a decision that obeys the same role and phase rules a real
 * model would be asked to obey.
 *
 * Wording is drawn from small phrase pools by a PRNG seeded from the prompt text,
 * so the same courtroom situation always produces the same line (reproducible
 * runs, diffable transcripts) while a different question or a different turn
 * produces different wording. Deterministic, not repetitive.
 */
export function createOfflineProvider(config = {}) {
  return {
    name: 'offline',
    model: config.offlineModel || 'offline-heuristic',
    available: true,
    async complete(req = {}) {
      const payload = normaliseRequest(req)
      const decision = offlineDecide(payload)
      return {
        text: JSON.stringify(decision),
        raw: { offline: true, decision },
        provider: 'offline',
        model: 'offline-heuristic',
      }
    },
  }
}

/** Everything the offline brain needs, read back out of the prompt it was given. */
function readContext({ system, messages }) {
  const text = [system, ...messages.map((m) => m.content)].filter(Boolean).join('\n')
  const upper = text.toUpperCase()

  const role = labelled(text, 'ROLE')?.toLowerCase().match(/[a-z]+/)?.[0]
    || Object.keys(ROLE_ACTIONS).find((r) => upper.includes(`ROLE: ${r.toUpperCase()}`))
    || guessRole(upper)

  const phase = Object.keys(PHASES).find((p) => new RegExp(`PHASE:\\s*${p}\\b`).test(upper))
    || Object.keys(PHASES).find((p) => upper.includes(p))
    || PHASES.DIRECT_EXAMINATION

  const allowedLine = labelled(text, 'ALLOWED ACTIONS')
  const allowed = allowedLine
    ? allowedLine.toUpperCase().match(/[A-Z_]{3,}/g)?.filter((a) => ACTIONS[a]) || []
    : []

  const objectionBlock = section(text, 'PENDING OBJECTION')
  const pendingObjection = objectionBlock && !/^\s*(none|null|-)\s*$/i.test(objectionBlock)
    ? {
      raw: objectionBlock,
      category: objectionBlock.toUpperCase().match(/\b(LEADING|HEARSAY|SPECULATION|RELEVANCE|ARGUMENTATIVE|ASSUMES_FACTS|COMPOUND|BADGERING)\b/)?.[1] || 'RELEVANCE',
      by: objectionBlock.toLowerCase().match(/\b(prosecutor|defense|defence)\b/)?.[1] || null,
    }
    : null

  const lastQuestion = section(text, 'LAST QUESTION') || section(text, 'QUESTION TO YOU') || null
  const examining = section(text, 'EXAMINING COUNSEL')?.toLowerCase().match(/prosecutor|defense|defence/)?.[0] || null
  const witnessOnStand = section(text, 'ON THE STAND')
  const admitted = (section(text, 'ADMITTED EVIDENCE') || '').trim()

  // The witness's whole world. Read as a list so an answer can be built from one
  // fact rather than from a vague summary of all of them.
  const facts = listItems(section(text, 'KNOWN FACTS') || section(text, 'YOUR KNOWLEDGE') || '')

  // What the turn manager expects of this turn. A real model reads this as a
  // suggestion in prose; the offline provider reads it as a parsed hint, which is
  // what lets purely mechanical beats (a closing gavel, tendering the exhibit the
  // court is already dealing with) come out right without hard-coding them here.
  const expected = labelled(text, 'THIS TURN')?.match(/expected to ([A-Z_]{3,})/)?.[1] || null
  // Grounds the engine's own analysis found in the question just asked. Offered,
  // not imposed: the decision to interrupt is still made below.
  const grounds = listItems(section(text, 'OBJECTION GROUNDS') || '')
  const exhibitId = (section(text, 'EXHIBIT IN QUESTION') || '').match(/\b[A-Z][A-Z0-9_]{2,}\b/)?.[0] || null

  return {
    text, role: role || 'judge', phase, allowed, pendingObjection, lastQuestion, examining,
    witnessOnStand, admitted, facts, expected, grounds, exhibitId,
    rng: mulberry32(seedFrom(text)),
  }
}

function offlineDecide(payload) {
  const ctx = readContext(payload)
  const role = ctx.role
  const permitted = ctx.allowed.length ? ctx.allowed : allowedActionsFor(role)
  const decide = OFFLINE_BY_ROLE[role] || OFFLINE_BY_ROLE.default
  const decision = decide(ctx)
  // Last guard: the offline provider is held to the same contract as a real
  // model, so if a branch above proposed something this role may not do in this
  // phase, it quietly becomes the honest thing to do instead.
  if (!permitted.includes(decision.action)) {
    decision.action = permitted.includes(ACTIONS.LISTEN) ? ACTIONS.LISTEN : permitted[0] || ACTIONS.WAIT
    decision.speech = ''
    decision.reason = 'Action not permitted for this role in this phase; waiting.'
  }
  return decision
}

const pick = (rng, list) => list[Math.floor(rng() * list.length) % list.length]

/** `EXHIBIT_A` is an id, not something a barrister says out loud. */
const spokenExhibit = (id) => String(id)
  .toLowerCase()
  .replace(/_/g, ' ')
  .replace(/\b([a-z])/g, (m) => m.toUpperCase())

const OFFLINE_BY_ROLE = {
  judge(ctx) {
    if (ctx.pendingObjection) {
      // Objections that go to the form of the question are sustained; a bare
      // relevance complaint is the one the bench genuinely weighs, so it varies.
      const cat = ctx.pendingObjection.category
      const formDefect = ['LEADING', 'HEARSAY', 'SPECULATION', 'ARGUMENTATIVE', 'ASSUMES_FACTS', 'COMPOUND', 'BADGERING'].includes(cat)
      const sustain = formDefect || ctx.rng() < 0.4
      const ruling = sustain ? 'SUSTAIN' : 'OVERRULE'
      const speech = sustain
        ? pick(ctx.rng, [
          `Sustained. Counsel will rephrase and keep the question within ${cat === 'HEARSAY' ? 'the witness’s own knowledge' : 'the record'}.`,
          'Sustained. The witness will not answer that question as framed.',
          'Sustained. Put the question again without leading the witness.',
        ])
        : pick(ctx.rng, [
          'Overruled. The question is within the scope of this examination. The witness will answer.',
          'Overruled. Counsel may pursue the line, but stay close to the record.',
          'Overruled. I will allow it.',
        ])
      return {
        action: ACTIONS.RULE, speech, ruling,
        objectionCategory: cat,
        reason: `Objection on ${cat} grounds ${sustain ? 'is well founded' : 'does not bar the question'}.`,
        target: 'counsel',
      }
    }
    if (ctx.phase === PHASES.PRE_SESSION || ctx.phase === PHASES.COURT_OPENING) {
      if (ctx.expected === ACTIONS.GAVEL) {
        return {
          action: ACTIONS.GAVEL, speech: 'Order. We will proceed.',
          reason: 'Bringing the court to order before the matter is taken up.', target: 'court',
        }
      }
      return {
        action: ACTIONS.SPEAK,
        speech: pick(ctx.rng, [
          'This court is now in session. Counsel will confine themselves to the record and address the bench.',
          'The court is in session. I expect brevity from both sides and no argument with the witness.',
        ]),
        reason: 'Opening the sitting and setting expectations.',
        target: 'court',
      }
    }
    if (ctx.phase === PHASES.JUDGMENT) {
      if (ctx.expected === ACTIONS.GAVEL) {
        return {
          action: ACTIONS.GAVEL,
          speech: 'The matter stands disposed of on the terms recorded. This court is adjourned.',
          reason: 'Closing the matter once judgment has been delivered.',
          target: 'court',
        }
      }
      return {
        action: ACTIONS.SPEAK,
        speech: 'On the admitted evidence and the testimony recorded, the court will now state its reasoning.',
        reason: 'Delivering judgment on the record as it stands.',
        target: 'court',
      }
    }
    if (ctx.phase === PHASES.EVIDENCE) {
      // The bench has an exhibit in front of it and the turn manager is asking for
      // a ruling on admissibility, which is a decision, not a speech.
      if (ctx.expected === ACTIONS.ADMIT_EVIDENCE && ctx.exhibitId) {
        return {
          action: ACTIONS.ADMIT_EVIDENCE,
          evidence: ctx.exhibitId,
          speech: `${spokenExhibit(ctx.exhibitId)} is admitted and will be marked on the record. Counsel may take the witness to it.`,
          reason: 'Provenance is on the record and the document is relevant to the charge.',
          target: 'court',
        }
      }
      return {
        action: ACTIONS.SPEAK,
        speech: 'The exhibit is before the court. Counsel will establish its provenance before relying on it.',
        reason: 'Evidence must be founded before it is argued from.',
        target: 'counsel',
      }
    }
    return {
      action: ACTIONS.LISTEN, speech: '',
      reason: 'Examination is proceeding properly; the bench does not intervene.',
      target: null,
    }
  },

  prosecutor(ctx) { return advocate(ctx, 'prosecutor') },
  defense(ctx) { return advocate(ctx, 'defense') },

  witness(ctx) {
    if (!ctx.lastQuestion) {
      return { action: ACTIONS.WAIT, speech: '', reason: 'No question has been put to me.', target: null }
    }
    const fact = bestFact(ctx.lastQuestion, ctx.facts)
    if (!fact) {
      // The anti-omniscience rule, enforced rather than merely requested: nothing
      // in the question touches anything this witness was told, so the honest
      // answer is the only one available.
      return {
        action: ACTIONS.ANSWER,
        speech: pick(ctx.rng, [
          'I do not know, sir. That is not something I saw myself.',
          'I do not recall anything about that. I can only speak to what happened on my phone.',
          'I am sorry, I have no knowledge of that.',
        ]),
        reason: 'The question falls outside my personal knowledge, so I say so.',
        target: 'court',
      }
    }
    return {
      action: ACTIONS.ANSWER,
      speech: pick(ctx.rng, [
        `${fact} That is all I can say about it.`,
        `As far as I know, ${lowerFirst(fact)}`,
        `${fact} I did not see anything beyond that.`,
      ]),
      reason: 'Answering from my own knowledge and nothing further.',
      target: 'court',
    }
  },

  defendant(ctx) {
    // A plea answers the reading of the charges, not a question. The accused is
    // asked to plead by the court itself, so requiring an outstanding question here
    // would leave the dock silent at the one moment it must speak.
    if (ctx.phase === PHASES.CHARGES) {
      return {
        action: ACTIONS.ANSWER,
        speech: pick(ctx.rng, [
          'Not guilty, Your Honour. I did not do what is alleged.',
          'I understand the charges, Your Honour, and I plead not guilty.',
        ]),
        reason: 'Entering my plea to the charges as read.',
        target: 'judge',
      }
    }
    if (!ctx.lastQuestion) {
      return { action: ACTIONS.WAIT, speech: '', reason: 'Not addressed by the court.', target: null }
    }
    return {
      action: ACTIONS.ANSWER,
      speech: pick(ctx.rng, [
        'No, Your Honour. I did not do what is alleged.',
        'I understand the charge, Your Honour, and I deny it.',
      ]),
      reason: 'Answering the court directly and briefly.',
      target: 'judge',
    }
  },

  clerk(ctx) {
    if (ctx.phase === PHASES.CHARGES) {
      return {
        action: ACTIONS.SPEAK,
        speech: 'The charges are cheating, identity misuse and digital payment fraud. The accused will confirm that the charges are understood.',
        reason: 'Reading the charges as directed by the bench.',
        target: 'court',
      }
    }
    if (ctx.phase === PHASES.COURT_OPENING || ctx.phase === PHASES.PRE_SESSION) {
      return {
        action: ACTIONS.SPEAK,
        speech: 'All rise. The matter of State versus Dev Malhotra is called on for hearing.',
        reason: 'Calling the matter so the sitting can begin.',
        target: 'court',
      }
    }
    return { action: ACTIONS.WAIT, speech: '', reason: 'Nothing to record or announce.', target: null }
  },

  police(ctx) {
    // An officer in court is doing one of two jobs. Standing behind the dock she
    // is furniture with a uniform and has nothing to say. Called to the box as
    // the investigating officer she is a witness like any other, and answers on
    // exactly the same terms — from her own knowledge, or not at all.
    //
    // Which job it is, is not hers to decide: the court seats her, and the only
    // evidence of that reaching this far down is a question actually addressed
    // to her. Without one she stands by, which is also what keeps her silent
    // while somebody else is in the box.
    if (!ctx.lastQuestion) {
      return { action: ACTIONS.LISTEN, speech: '', reason: 'Standing by; no direction from the bench.', target: null }
    }
    return OFFLINE_BY_ROLE.witness(ctx)
  },

  default(ctx) {
    return { action: ACTIONS.LISTEN, speech: '', reason: 'Observing the proceedings.', target: null }
  },
}

/**
 * Both advocates share one brain here because their courtroom behaviour differs
 * by which side they are on, not by how they decide. Whose examination it is
 * settles whether this turn is a question or a watch-for-defects turn.
 */
function advocate(ctx, side) {
  const opening = side === 'prosecutor' ? PHASES.PROSECUTION_OPENING : PHASES.DEFENSE_OPENING
  const otherOpening = side === 'prosecutor' ? PHASES.DEFENSE_OPENING : PHASES.PROSECUTION_OPENING

  if (ctx.pendingObjection) {
    return { action: ACTIONS.WAIT, speech: '', reason: 'An objection is before the bench; I wait for the ruling.', target: null }
  }

  if (ctx.phase === opening) {
    const speech = side === 'prosecutor'
      ? pick(ctx.rng, [
        'The prosecution will show that the accused used a cloned payment link to divert the complainant’s funds. We rely on the transaction record and on the complainant’s own account of that evening.',
        'Your Honour, this is a case about a payment that went where it was never meant to go. We will connect the accused to the link that took it there.',
      ])
      : pick(ctx.rng, [
        'The defence asks the court to watch the gaps. A payment trail shows where money went, not whose hand was on the device.',
        'Your Honour, nothing on this record establishes who created that link. Suspicion is not proof, and the prosecution has offered the first without the second.',
      ])
    return { action: ACTIONS.SPEAK, speech, reason: 'Stating my case theory at the opening.', target: 'judge' }
  }

  if (ctx.phase === otherOpening || ctx.phase === PHASES.JUDGMENT || ctx.phase === PHASES.CASE_CLOSED) {
    return { action: ACTIONS.LISTEN, speech: '', reason: 'Not my turn to address the court.', target: null }
  }

  if (ctx.phase === PHASES.CLOSING_ARGUMENTS) {
    const speech = side === 'prosecutor'
      ? 'On the admitted evidence the chain is complete: the link, the transfer, and the account it reached. The charge is made out.'
      : 'The court has heard suspicion and inference, but no proof of who controlled that device. That is reasonable doubt.'
    return { action: ACTIONS.SPEAK, speech, reason: 'Summing up on the admitted record only.', target: 'judge' }
  }

  if (ctx.phase === PHASES.EVIDENCE) {
    // Tendering is a decision about an exhibit, so it needs the exhibit named. The
    // engine puts the one the court is dealing with in the prompt; refusing to
    // guess an id is the point — an invented id is exactly what the evidence gate
    // exists to catch.
    if (ctx.expected === ACTIONS.PRESENT_EVIDENCE && ctx.exhibitId) {
      return {
        action: ACTIONS.PRESENT_EVIDENCE,
        evidence: ctx.exhibitId,
        speech: `Your Honour, I tender ${spokenExhibit(ctx.exhibitId)}. It shows the account the money actually reached, and I ask that it be taken on record.`,
        reason: 'The document is the spine of the chain I have to prove.',
        target: 'judge',
      }
    }
    return {
      action: ACTIONS.SPEAK,
      speech: 'Your Honour, the exhibit is properly before the court and I will take the witness to it.',
      reason: 'Laying the foundation before relying on the exhibit.',
      target: 'judge',
    }
  }

  const mine = ctx.examining ? ctx.examining.startsWith(side.slice(0, 4)) || ctx.examining === side : ctx.phase === (side === 'prosecutor' ? PHASES.DIRECT_EXAMINATION : PHASES.CROSS_EXAMINATION)

  if (!mine) {
    // Opposing counsel's turn. Two sources of a possible objection: grounds the
    // engine's own analysis of the question has already found, and this side's own
    // reading of the words. The engine's analysis is richer — it knows the phase,
    // the exhibit register and what has been asked before — so it is preferred
    // where it has something, but the decision to interrupt stays here. Real
    // counsel lets arguable points go rather than objecting to everything, so a
    // weak ground is often waived and a strong one almost always taken.
    const offered = ctx.grounds[0]
    if (offered) {
      const category = offered.match(/\b([A-Z][A-Z_]{3,})\b/)?.[1] || 'RELEVANCE'
      // The ground arrives as `- CATEGORY — Label: why it is objectionable (confidence n)`.
      // What counsel says out loud is the "why", so take the text after the first
      // colon and drop the bookkeeping.
      const line = (offered.split(/:\s/).slice(1).join(': ') || offered)
        .replace(/\(confidence[^)]*\)/i, '').trim() || 'The question is defective in its form.'
      const confidence = Number(/confidence\s*([\d.]+)/i.exec(offered)?.[1]) || 0.6
      if (ctx.rng() < 0.35 + confidence * 0.6) {
        return {
          action: ACTIONS.OBJECT,
          speech: pick(ctx.rng, [`Objection, Your Honour. ${line}`, `Objection. ${line}`]),
          objectionCategory: category,
          reason: `The question is objectionable on ${category} grounds and I am not prepared to let it stand.`,
          target: 'judge',
        }
      }
      return {
        action: ACTIONS.LISTEN, speech: '',
        reason: `A ${category} point is available but weak enough that I will not interrupt the examination for it.`,
        target: null,
      }
    }
    const defect = questionDefect(ctx.lastQuestion || '')
    if (defect) {
      return {
        action: ACTIONS.OBJECT,
        speech: pick(ctx.rng, [
          `Objection, Your Honour. ${defect.line}`,
          `Objection. ${defect.line}`,
        ]),
        objectionCategory: defect.category,
        reason: defect.reason,
        target: 'judge',
      }
    }
    return { action: ACTIONS.LISTEN, speech: '', reason: 'The question is properly framed; nothing to object to.', target: null }
  }

  // A pool rather than a single line, and a wide one: the seed is derived from the
  // prompt, so as the transcript and turn counter change the question changes too.
  // Too narrow a pool and a three-question examination asks the same thing twice,
  // which then trips the badgering detector and the trial loops.
  const asked = new Set(listItems(section(ctx.text, 'ALREADY ASKED') || '').map((q) => q.trim()))
  const base = side === 'prosecutor'
    ? [
      'Mr Iyer, tell the court what you saw on your phone that evening.',
      'When the payment request arrived, what did you believe you were paying for?',
      'Did you at any point authorise a transfer to an account other than the vendor’s?',
      'Who was standing at the counter of Sunrise Electronics when you settled the payment?',
      'What amount had you agreed to pay Sunrise Electronics, and for what?',
      'When did you first realise the money had not reached the vendor?',
      'Describe the link you were shown and where it came from.',
    ]
    : [
      'Mr Iyer, you never saw who created that link, did you?',
      'You cannot tell this court whose device sent that request, can you?',
      'Before that evening, had you ever verified the vendor’s account details yourself?',
      'You had never met the accused before that morning at the counter, had you?',
      'Was there more than one young man in a Sunrise Electronics shirt in that shop?',
      'Did anybody read out the destination account name to you before you paid?',
      'How long did you look at the phone screen you were shown?',
    ]

  // Cross opens on safe ground and pushes on the second question. That is how
  // cross is actually conducted, and it is also where a defect in the *form* of
  // the question is likeliest — which is precisely what the other side is sitting
  // there waiting for. Keeping the pressure at a predictable point in the
  // examination means the objection beat is reachable in every session without the
  // decision to object being any less the other agent's to make.
  const probing = side === 'defense'
    ? [
      'What did the bank officer tell you when you reported that transfer?',
      'Is it possible that somebody else in that shop sent you that link, Mr Iyer?',
      'How can you claim the money went to the accused when you never read out the account name?',
    ]
    : []
  const pool = asked.size === 1 && probing.length ? probing : base
  const fresh = pool.filter((q) => !asked.has(q))
  const question = pick(ctx.rng, fresh.length ? fresh : base.filter((q) => !asked.has(q)).concat(base))

  return {
    action: ACTIONS.QUESTION_WITNESS,
    speech: question,
    reason: side === 'prosecutor'
      ? 'Establishing what the witness personally observed.'
      : 'Testing the limits of what the witness can actually speak to.',
    target: 'witness',
  }
}

/**
 * Cheap defect detection on a question, standing in for the judgement a model
 * would make. Deliberately conservative: it fires on the standard tells, so the
 * offline courtroom produces objections where a real one would, and stays quiet
 * otherwise instead of objecting at random.
 */
function questionDefect(question) {
  const q = String(question).toLowerCase()
  if (!q.trim()) return null
  if (/\b(isn'?t it true|you (clearly )?(saw|knew|did)|didn'?t you|did you not|you never .*, did you|can you not)\b/.test(q)) {
    return { category: 'LEADING', line: 'Counsel is leading the witness and putting the answer into their mouth.', reason: 'The question suggests its own answer.' }
  }
  if (/\b(did .* tell you|what did .* say|you heard that|someone said)\b/.test(q)) {
    return { category: 'HEARSAY', line: 'That calls for what someone else said, outside this witness’s knowledge.', reason: 'The answer would be hearsay.' }
  }
  if (/\b(do you think|would you agree|in your opinion|must have|probably)\b/.test(q)) {
    return { category: 'SPECULATION', line: 'Counsel is asking the witness to speculate rather than to recount.', reason: 'The question invites speculation.' }
  }
  if (/\b(proves|establishes)\b/.test(q)) {
    return { category: 'ASSUMES_FACTS', line: 'The question assumes a fact that is not in the admitted evidence.', reason: 'Assumes facts not on the record.' }
  }
  return null
}

/**
 * Which of the witness's known facts, if any, the question is actually about.
 *
 * Word overlap, but weighted, because a flat count gets this wrong in the one
 * direction that matters. "Tell the court what you saw on your phone" shares
 * exactly one content word with the fact it is plainly asking about, so a
 * threshold of two shared words makes the complainant deny knowing anything about
 * their own complaint. Weighting fixes that without opening the floodgates:
 *
 *   rarity — a word in one fact identifies that fact; a word in five identifies
 *            nothing, so each match is divided by the square root of how many
 *            facts contain it.
 *   length — long words are specific ("certificate", "authorise"); short ones are
 *            usually filler the stop list did not catch.
 *
 * No overlap at all still means the witness genuinely has nothing to offer, which
 * is exactly when the simulation needs them to say they do not know.
 */
function bestFact(question, facts) {
  if (!facts.length) return null
  const stop = new Set(['the', 'a', 'an', 'you', 'your', 'and', 'that', 'this', 'what', 'when', 'did', 'do', 'does', 'was', 'were', 'is', 'are', 'to', 'of', 'on', 'in', 'at', 'for', 'it', 'have', 'had', 'not', 'any', 'court', 'tell', 'please', 'mr', 'ms', 'witness', 'about', 'with', 'from', 'who', 'whose', 'how', 'ever', 'before', 'after', 'own', 'can', 'cannot', 'could', 'would'])
  const words = (s) => new Set(String(s).toLowerCase().match(/[a-z]{3,}/g)?.filter((w) => !stop.has(w)) || [])

  const qw = words(question)
  if (!qw.size) return null

  // How many facts each word appears in — the rarity denominator.
  const df = new Map()
  const factWords = facts.map((fact) => {
    const set = words(fact)
    for (const w of set) df.set(w, (df.get(w) || 0) + 1)
    return set
  })

  const weight = (w) => {
    const size = w.length >= 7 ? 1.4 : w.length >= 5 ? 1.0 : 0.55
    return size / Math.sqrt(df.get(w) || 1)
  }

  let best = null
  let bestScore = 0
  facts.forEach((fact, i) => {
    let score = 0
    for (const w of factWords[i]) if (qw.has(w)) score += weight(w)
    if (score > bestScore) {
      bestScore = score
      best = fact
    }
  })

  // One rare, specific word is a topic. A couple of short common ones are not.
  return bestScore >= 0.9 ? best : null
}

// --- prompt scraping helpers -------------------------------------------------

/**
 * Labels in prompts.js may carry a parenthetical gloss for the model's benefit —
 * "KNOWN FACTS (your entire knowledge of this case):" — so the label pattern has
 * to tolerate one. Missing this is silent and nasty: the witness simply never
 * sees its own facts and answers every question with "I do not know."
 */
const labelPattern = (label) => `^[ \\t]*${label}[ \\t]*(?:\\([^)]*\\))?[ \\t]*:`

/** The value on a `LABEL: value` line. */
function labelled(text, label) {
  const m = new RegExp(`${labelPattern(label)}[ \\t]*(.+)$`, 'im').exec(text)
  return m ? m[1].trim() : null
}

/**
 * A labelled block: everything after `LABEL:` up to the next all-caps label or a
 * blank line. Sections are how prompts.js is written, so this is the natural unit
 * to read back.
 */
function section(text, label) {
  // The terminator is a lookahead for the next label, a blank line, or genuine
  // end of input — spelled `(?![\s\S])` rather than `$` because `$` under the `m`
  // flag this needs for `^` also matches end of *line*, which would end every
  // section the instant it began.
  const re = new RegExp(
    `${labelPattern(label)}[ \\t]*([\\s\\S]*?)(?=\\n[ \\t]*[A-Z][A-Z _()/'’-]{2,}[ \\t]*(?:\\([^)]*\\))?[ \\t]*:|\\n[ \\t]*\\n|(?![\\s\\S]))`,
    'im',
  )
  const m = re.exec(text)
  if (!m) return null
  const value = m[1].trim()
  return value || null
}

function listItems(block) {
  return String(block)
    .split('\n')
    .map((l) => l.replace(/^\s*[-*\d.)]+\s*/, '').trim())
    .filter((l) => l.length > 3)
}

function guessRole(upper) {
  if (upper.includes('JUSTICE MEERA RAO') || upper.includes('THE BENCH')) return 'judge'
  if (upper.includes('ARJUN SEN')) return 'prosecutor'
  if (upper.includes('KAVYA MENON')) return 'defense'
  if (upper.includes('RAMESH IYER')) return 'witness'
  if (upper.includes('CLERK')) return 'clerk'
  return null
}

/**
 * Lowercase a fact so it can be spliced after "As far as I know, ...". A leading
 * "I" is left alone: these facts are first-person testimony, so this rule fires
 * on almost every one of them.
 */
function lowerFirst(s) {
  if (!s) return s
  if (/^I\b/.test(s)) return s
  return s[0].toLowerCase() + s.slice(1)
}

/** FNV-1a over the prompt: same situation in, same seed out. */
function seedFrom(text) {
  let h = 0x811c9dc5
  const s = String(text)
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

function mulberry32(seed) {
  let a = seed >>> 0
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
