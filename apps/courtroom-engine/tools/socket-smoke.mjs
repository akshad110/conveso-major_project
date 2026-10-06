import net from 'node:net'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'

const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT: '4199', COURT_SPEED: '0', COURT_STREAM: '0' }, stdio: ['ignore','pipe','pipe'] })
srv.stdout.on('data', d => process.stdout.write('[srv] ' + d))
srv.stderr.on('data', d => process.stdout.write('[err] ' + d))
await new Promise(r => setTimeout(r, 900))

const key = crypto.randomBytes(16).toString('base64')
const sock = net.connect(4199, '127.0.0.1')
const counts = new Map()
let phases = [], sample = [], handshake = false, buf = Buffer.alloc(0)

sock.on('connect', () => {
  sock.write([`GET / HTTP/1.1`, `Host: 127.0.0.1:4199`, 'Upgrade: websocket', 'Connection: Upgrade',
    `Sec-WebSocket-Key: ${key}`, 'Sec-WebSocket-Version: 13', '', ''].join('\r\n'))
})

function frames() {
  while (buf.length >= 2) {
    let len = buf[1] & 0x7f, off = 2
    if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4 }
    else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10 }
    if (buf.length < off + len) return
    const body = buf.subarray(off, off + len).toString('utf8')
    buf = buf.subarray(off + len)
    try {
      const m = JSON.parse(body)
      counts.set(m.type, (counts.get(m.type) || 0) + 1)
      if (m.type === 'STATE' && m.reason?.startsWith('phase')) phases.push(m.reason.replace('phase ','').split(' -> ')[1])
      if (m.type === 'COURT_EVENT' && sample.length < 3) sample.push(`${m.agent} ${m.action} animation=${m.animation} camera=${m.camera}`)
    } catch {}
  }
}

sock.on('data', (chunk) => {
  if (!handshake) {
    const i = chunk.indexOf('\r\n\r\n')
    if (i === -1) return
    handshake = true
    buf = Buffer.concat([buf, chunk.subarray(i + 4)])
  } else buf = Buffer.concat([buf, chunk])
  frames()
})

// send a Developer Mode DISPATCH to prove the legacy path still works
function clientSend(obj) {
  const p = Buffer.from(JSON.stringify(obj))
  const mask = crypto.randomBytes(4)
  const head = p.length < 126 ? Buffer.from([0x81, 0x80 | p.length]) : Buffer.from([0x81, 0xfe, p.length >> 8, p.length & 255])
  const masked = Buffer.alloc(p.length)
  for (let i = 0; i < p.length; i++) masked[i] = p[i] ^ mask[i % 4]
  sock.write(Buffer.concat([head, mask, masked]))
}
setTimeout(() => clientSend({ type: 'DISPATCH', event: { type: 'ANIMATION', agent: 'judge', animation: 'GAVEL' } }), 1200)
setTimeout(() => clientSend({ type: 'NOPE' }), 1400)

await new Promise(r => setTimeout(r, 6000))
console.log('\nmessage counts:', [...counts].map(([k,v]) => `${k}=${v}`).join(' '))
console.log('phases:', phases.join(' -> '))
console.log('sample events:\n ' + sample.join('\n '))
sock.destroy(); srv.kill()
