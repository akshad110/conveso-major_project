/**
 * Play a seat over the real socket.
 *
 * The bridge verifier drives the engine in-process, which is the right way to
 * check the wire contract but skips the server: the handshake, the frame masking,
 * the autostart grace period, and the routing table that decides which messages
 * reach the trial. This tool exercises exactly that. It connects the way the
 * browser does, says HOLD before the court can open on its own, claims the bench,
 * and then answers every question the court puts to it.
 *
 * Usage:  node tools/socket-human.mjs [judge|prosecutor|defense]
 *
 * It starts its own server on port 4198 and prints what it saw. Exit status 0 means
 * a person really can try a case through the socket.
 */
import net from 'node:net'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'

const ROLE = (process.argv[2] || 'judge').toLowerCase()
const PORT = 4198

const srv = spawn(process.execPath, ['server/index.js'], {
  env: { ...process.env, PORT: String(PORT), COURT_SPEED: '0', COURT_STREAM: '0' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
const serverLog = []
srv.stdout.on('data', (d) => serverLog.push(String(d)))
srv.stderr.on('data', (d) => serverLog.push(String(d)))
await new Promise((r) => setTimeout(r, 900))

const key = crypto.randomBytes(16).toString('base64')
const sock = net.connect(PORT, '127.0.0.1')

const counts = new Map()
const asks = []
const refusals = []
const errors = []
let seat = null
let ends = 0
let closedAt = null
let handshake = false
let buf = Buffer.alloc(0)

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

/** Answer the court, the way the turn panel does. */
function answer(prompt) {
  asks.push(prompt.kind)
  if (prompt.rejection) refusals.push(prompt.rejection.code)

  if (prompt.kind === 'OBJECTION') {
    if (asks.filter((k) => k === 'OBJECTION').length === 1 && prompt.grounds?.length) {
      clientSend({
        type: 'HUMAN_ACTION',
        action: 'OBJECT',
        category: prompt.grounds[0].category,
        speech: 'Objection, Your Honour.',
      })
    } else {
      clientSend({ type: 'HUMAN_PASS' })
    }
    return
  }

  if (prompt.kind === 'RULING' || prompt.rulings?.length) {
    clientSend({ type: 'HUMAN_ACTION', action: 'RULE', ruling: 'OVERRULE', speech: '' })
    return
  }

  // One turn to the AI, to prove the hand-off travels too.
  if (asks.length === 3) {
    clientSend({ type: 'HUMAN_HANDOFF' })
    return
  }

  const action = prompt.actions?.includes(prompt.expect) ? prompt.expect : prompt.actions?.[0]
  const exhibits = prompt.evidenceOptions?.[action] || []
  clientSend({
    type: 'HUMAN_ACTION',
    action,
    evidence: exhibits[0],
    speech: 'The court has heard enough on that point.',
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
    if (m.type === 'HUMAN_ROLE') seat = m.label
    if (m.type === 'YOUR_TURN') setImmediate(() => answer(m))
    if (m.type === 'YOUR_TURN_END') ends += 1
    if (m.type === 'ERROR') errors.push(m.message)
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
    // Immediately, before the server's autostart grace runs out.
    clientSend({ type: 'HOLD' })
    setTimeout(() => {
      clientSend({ type: 'SET_HUMAN_ROLE', role: ROLE })
      clientSend({ type: 'START' })
    }, 120)
  } else {
    buf = Buffer.concat([buf, chunk])
  }
  frames()
})

// Long enough for a whole trial at speed 0, and it exits early once the case closes.
const deadline = Date.now() + 40_000
while (Date.now() < deadline && !closedAt) {
  await new Promise((r) => setTimeout(r, 250))
}

sock.destroy()
srv.kill('SIGTERM')

const problems = []
if (!seat) problems.push('the server never confirmed the seat')
if (!asks.length) problems.push('the court never asked anything over the socket')
if (ends < asks.length) problems.push(`${asks.length} questions but only ${ends} closed`)
if (errors.length) problems.push(`server errors: ${errors.join('; ')}`)
if (!closedAt) problems.push('the trial did not reach CASE_CLOSED')
if (!counts.get('COURT_EVENT')) problems.push('no court events came back')

console.log('')
console.log(`seat: ${seat || 'none'} (asked for ${ROLE})`)
console.log(`prompts: ${asks.length} (${[...new Set(asks)].join('/')}), closed: ${ends}, refusals: ${refusals.join(',') || 'none'}`)
console.log(`messages: ${[...counts].map(([k, v]) => `${k}=${v}`).join(' ')}`)
if (problems.length) {
  console.log(`\nFAIL  ${problems.join('; ')}`)
  console.log(serverLog.join(''))
  process.exit(1)
}
console.log(`\nPASS  a person played ${seat} through the socket and the case closed.`)
process.exit(0)
