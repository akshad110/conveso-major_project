/**
 * Play a seat badly, on purpose.
 *
 * `socket-human.mjs` proves a cooperative client can try a case: it answers every
 * question with a legal action, in order, once. That is the happy path, and it was
 * passing on all three seats while real people were still getting stuck — because
 * nobody plays like that. A person double-clicks Send. They pick an exhibit, change
 * their mind, and pick the action again. They hit Object when the moment has passed.
 * They re-click the seat they are already sitting in. They walk away mid-turn and
 * come back to a panel that has moved on without them.
 *
 * So this tool misbehaves deliberately, one scripted provocation per turn, and then
 * checks the things that should be true no matter how badly the client behaves:
 *
 *   1. every YOUR_TURN is closed by exactly one YOUR_TURN_END
 *   2. no two prompts are ever open at once — a panel can only show one question
 *   3. re-claiming the seat you already hold never costs you your open turn
 *   4. a stray message with no turn open is ignored rather than silently eating
 *      the *next* turn
 *   5. a refusal comes back as the same question with a reason attached
 *   6. the trial still reaches CASE_CLOSED
 *
 * Usage:  node tools/socket-human-abuse.mjs [judge|prosecutor|defense] [--verbose]
 */
import net from 'node:net'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'

const ROLE = (process.argv[2] || 'judge').toLowerCase()
const VERBOSE = process.argv.includes('--verbose')
const PORT = Number(process.env.PORT || 4199)

const srv = spawn(process.execPath, ['server/index.js'], {
  env: { ...process.env, PORT: String(PORT), COURT_SPEED: '0', COURT_STREAM: '0' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
const serverLog = []
srv.stdout.on('data', (d) => serverLog.push(String(d)))
srv.stderr.on('data', (d) => serverLog.push(String(d)))
srv.on('exit', (code, sig) => { if (code) serverLog.push(`\n[server exited ${code} ${sig}]\n`) })
await new Promise((r) => setTimeout(r, 900))

const key = crypto.randomBytes(16).toString('base64')
const sock = net.connect(PORT, '127.0.0.1')

const counts = new Map()
const asks = []
const refusals = []
const errors = []
const violations = []
const log = []
let seat = null
let seatRole = null
let ends = 0
let openPrompt = null
let closedAt = null
let handshake = false
let buf = Buffer.alloc(0)
let turnNo = 0

function note(what) {
  log.push(what)
  if (VERBOSE) console.log(`    ${what}`)
}

function violate(what) {
  violations.push(what)
  if (VERBOSE) console.log(`    !! ${what}`)
}

function clientSend(obj) {
  const p = Buffer.from(JSON.stringify(obj))
  const mask = crypto.randomBytes(4)
  const head = p.length < 126
    ? Buffer.from([0x81, 0x80 | p.length])
    : Buffer.from([0x81, 0xfe, p.length >> 8, p.length & 255])
  const masked = Buffer.alloc(p.length)
  for (let i = 0; i < p.length; i += 1) masked[i] = p[i] ^ mask[i % 4]
  sock.write(Buffer.concat([head, mask, masked]))
}

/**
 * A legal answer for this prompt, so a provocation can be followed by a real move.
 *
 * `replyTo` is what the shipped panel sends: the id of the question being answered.
 * It is the whole reason a double-clicked Send is harmless — the second click
 * names a question that has already closed, so the court drops it instead of
 * applying it to whatever came next.
 */
function legalMove(prompt) {
  if (prompt.kind === 'OBJECTION') return { type: 'HUMAN_PASS', replyTo: prompt.id }
  if (prompt.kind === 'RULING' || prompt.rulings?.length) {
    return {
      type: 'HUMAN_ACTION',
      replyTo: prompt.id,
      action: 'RULE',
      ruling: prompt.rulings?.[0] || 'OVERRULE',
      speech: '',
    }
  }
  const action = prompt.actions?.includes(prompt.expect) ? prompt.expect : prompt.actions?.[0]
  const exhibits = prompt.evidenceOptions?.[action] || []
  return {
    type: 'HUMAN_ACTION',
    replyTo: prompt.id,
    action,
    evidence: exhibits[0],
    speech: 'Let the record reflect the question.',
  }
}

/**
 * One provocation per turn, then a legal move. Each returns a label so the report
 * says which bad habit was being tried, not just that something went wrong.
 */
const PROVOCATIONS = [
  // Nothing on turn 1 — establish that the ordinary path still works.
  (p) => { clientSend(legalMove(p)); return 'plain legal move' },

  // Double-click Send. The second submit lands with no turn open; if the engine
  // queues it, it silently eats the turn AFTER this one.
  (p) => {
    const m = legalMove(p)
    clientSend(m); clientSend(m); clientSend(m)
    return 'Send clicked three times'
  },

  // Re-click the seat you are already in. The panel does this on reconnect, and
  // claim() hands off any open turn — so this used to cost a turn.
  (p) => {
    clientSend({ type: 'SET_HUMAN_ROLE', role: ROLE })
    setTimeout(() => clientSend(legalMove(p)), 60)
    return 'reselected the seat already held'
  },

  // An action that is not on the court's list — a stale button from the turn
  // before, or a client that kept its own idea of what is legal.
  (p) => {
    clientSend({ type: 'HUMAN_ACTION', replyTo: p.id, action: 'GAVEL_SMASH', speech: 'Order!' })
    setTimeout(() => clientSend(legalMove(p)), 60)
    return 'submitted an action the court never offered'
  },

  // Lower case, which is what a hand-written client or a URL param produces.
  (p) => {
    const m = legalMove(p)
    clientSend({ ...m, action: String(m.action || '').toLowerCase() })
    return 'submitted a lower-case action'
  },

  // An evidence action with no exhibit named, which is the refusal a person hits
  // most: the court has several candidates so the engine cannot guess.
  (p) => {
    const withEvidence = Object.keys(p.evidenceOptions || {})
    if (!withEvidence.length) { clientSend(legalMove(p)); return 'no evidence action available' }
    clientSend({ type: 'HUMAN_ACTION', replyTo: p.id, action: withEvidence[0], speech: 'Move to admit.' })
    return 'evidence action with no exhibit chosen'
  },

  // Pass when passing is not what is being asked. A person hits the buttons that
  // are on screen, and the objection panel's Pass is the one they remember.
  (p) => {
    clientSend({ type: 'HUMAN_PASS', replyTo: p.id })
    setTimeout(() => clientSend(legalMove(p)), 60)
    return 'passed on a turn that was not an offer'
  },

  // Empty speech — they hit Send before typing.
  (p) => { clientSend({ ...legalMove(p), speech: '' }); return 'sent with no speech' },

  // Hand off, then immediately try to answer anyway.
  (p) => {
    clientSend({ type: 'HUMAN_HANDOFF', replyTo: p.id })
    setTimeout(() => clientSend(legalMove(p)), 40)
    return 'handed off, then answered anyway'
  },

  // Walk away: answer nothing for a beat, then answer. The court must still be
  // waiting — there is no timeout by design.
  (p) => {
    setTimeout(() => clientSend(legalMove(p)), 1200)
    return 'left the turn open for 1.2 s'
  },
]

// Stray messages naming no question, fired in the one window where "no turn is
// open" is a fact rather than a guess: the seat is taken, the trial has not been
// started, so nothing can be pending at either end. All four must come back
// refused.
//
// Mid-trial this cannot be asserted, and pretending otherwise made the count come
// out differently on every seat: `openPrompt` is what the *client* has read, and
// the court may already have opened the next question by the time a stray lands.
// An answer naming no question is then indistinguishable from a client answering
// the question in front of it, and is taken as exactly that — which is why the
// shipped panel names the question on every answer. The mid-trial abuse is what
// the ten provocations are for; they all carry ids.
let straysSent = false
let expectedErrors = 0
function strays() {
  if (straysSent) return
  straysSent = true
  expectedErrors = 4
  clientSend({ type: 'HUMAN_ACTION', action: 'WAIT', speech: 'nobody asked' })
  clientSend({ type: 'HUMAN_PASS' })
  clientSend({ type: 'HUMAN_HANDOFF' })
  clientSend({ type: 'SET_HUMAN_ROLE', role: 'bailiff' })
  note('fired four stray messages naming no question, before the trial started')
}

function answer(prompt) {
  if (openPrompt) {
    violate(`two prompts open at once: ${openPrompt.kind} then ${prompt.kind}`)
  }
  openPrompt = prompt
  asks.push(prompt.kind)
  if (prompt.rejection) {
    refusals.push(prompt.rejection.code)
    note(`refused: ${prompt.rejection.code} — ${prompt.rejection.message}`)
  }
  if (prompt.role && seatRole && prompt.role !== seatRole) {
    violate(`asked as ${prompt.role} while holding ${seatRole}`)
  }

  // Bookkeeping above is synchronous so that YOUR_TURN and YOUR_TURN_END are
  // accounted for in the order the server sent them. Only the reply is deferred —
  // deferring the bookkeeping too made an END that legitimately preceded the next
  // TURN look like an overlap, which is a bug in the observer, not the engine.
  const provoke = PROVOCATIONS[turnNo] || ((p) => { clientSend(legalMove(p)); return 'legal move' })
  turnNo += 1
  setImmediate(() => {
    const label = provoke(prompt)
    note(`turn ${turnNo} (${prompt.kind}): ${label}`)
  })
}

function frames() {
  while (buf.length >= 2) {
    let len = buf[1] & 0x7f
    let off = 2
    if (len === 126) {
      if (buf.length < 4) return
      len = buf.readUInt16BE(2)
      off = 4
    } else if (len === 127) {
      if (buf.length < 10) return
      len = Number(buf.readBigUInt64BE(2))
      off = 10
    }
    if (buf.length < off + len) return
    const body = buf.subarray(off, off + len).toString('utf8')
    buf = buf.subarray(off + len)
    let m
    try {
      m = JSON.parse(body)
    } catch {
      continue
    }
    counts.set(m.type, (counts.get(m.type) || 0) + 1)
    if (m.type === 'HUMAN_ROLE') { seat = m.label; seatRole = m.role }
    if (m.type === "YOUR_TURN") answer(m)
    if (m.type === 'YOUR_TURN_END') {
      ends += 1
      if (!openPrompt) violate('YOUR_TURN_END with no prompt open')
      // A hand-off the client did not ask for is the bug this tool was written
      // for: the person is still sitting there and the AI took their turn.
      if (m.resolution === 'handoff' && !log.some((l) => l.includes('handed off'))) {
        violate(`turn resolved as handoff without the client asking (${m.reason || 'no reason'})`)
      }
      if (m.resolution === 'cancelled') {
        violate(`turn cancelled underneath the client (${m.reason || 'no reason'})`)
      }
      openPrompt = null
    }
    if (m.type === 'ERROR') {
      // A complaint the strays asked for is the engine behaving correctly. Any
      // other one means an ordinary mis-click earned a red message, which is the
      // thing this tool exists to catch.
      if (expectedErrors > 0) { expectedErrors -= 1; note(`expected complaint: ${m.message}`) }
      else errors.push(m.message)
    }
    if (m.type === 'STATE' && m.court?.phase === 'CASE_CLOSED') closedAt = m.court.phase
  }
}

sock.on('connect', () => {
  sock.write([
    'GET / HTTP/1.1',
    `Host: 127.0.0.1:${PORT}`,
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Key: ${key}`,
    'Sec-WebSocket-Version: 13',
    '', '',
  ].join('\r\n'))
})

sock.on('data', (chunk) => {
  if (!handshake) {
    const i = chunk.indexOf('\r\n\r\n')
    if (i === -1) return
    handshake = true
    buf = Buffer.concat([buf, chunk.subarray(i + 4)])
    clientSend({ type: 'HOLD' })
    setTimeout(() => {
      clientSend({ type: 'SET_HUMAN_ROLE', role: ROLE })
      // HOLD stopped the autostart, so nothing is pending at either end here.
      strays()
      setTimeout(() => clientSend({ type: 'START' }), 120)
    }, 120)
  } else {
    buf = Buffer.concat([buf, chunk])
  }
  frames()
})

const deadline = Date.now() + 60_000
while (Date.now() < deadline && !closedAt) {
  await new Promise((r) => setTimeout(r, 250))
}

sock.destroy()
srv.kill('SIGTERM')

const problems = [...violations]
if (!seat) problems.push('the server never confirmed the seat')
if (!asks.length) problems.push('the court never asked anything over the socket')
if (ends !== asks.length) problems.push(`${asks.length} questions but ${ends} closed`)
if (errors.length) problems.push(`server errors: ${errors.join('; ')}`)
if (!closedAt) problems.push('the trial did not reach CASE_CLOSED')
if (!straysSent) problems.push('the strays never found a gap between turns to fire into')
else if (expectedErrors > 0) {
  // A stray naming no question, sent while the court was waiting on nobody, was
  // swallowed instead of refused — which means some later question could be
  // answered by a message the person never sent.
  problems.push(`${expectedErrors} of 4 stray messages went unanswered by a complaint`)
}

console.log('')
console.log(`seat: ${seat || 'none'} (asked for ${ROLE})`)
console.log(`prompts: ${asks.length} (${[...new Set(asks)].join('/')}), closed: ${ends}`)
console.log(`refusals seen: ${refusals.join(', ') || 'none'}`)
console.log(`provocations: ${Math.min(turnNo, PROVOCATIONS.length)} of ${PROVOCATIONS.length}`)
console.log(`strays refused: ${straysSent ? 4 - Math.max(expectedErrors, 0) : 0} of 4, unasked-for errors: ${errors.length}`)
if (problems.length) {
  console.log(`\nFAIL  ${problems.length} problem(s):`)
  for (const p of problems) console.log(`  - ${p}`)
  if (VERBOSE) console.log(serverLog.join(''))
  process.exit(1)
}
console.log(`\nPASS  ${seat} survived ${Math.min(turnNo, PROVOCATIONS.length)} provocations and the case closed.`)
process.exit(0)
