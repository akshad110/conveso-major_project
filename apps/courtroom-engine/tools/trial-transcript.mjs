/**
 * Run one complete trial and print it as a transcript, plus every camera cut,
 * evidence beat and stream pause. The fastest way to see whether a change to the
 * agents, the validator or the turn script made the courtroom better or worse.
 *
 *   node tools/trial-transcript.mjs
 */
import { TrialEngine } from '../src/trialEngine.js'

const out = []
const types = new Set()
const engine = new TrialEngine({ speed: 0, stream: false })

engine.onBroadcast((message) => {
  types.add(message.type)
  const gutter = ' '.repeat(20)
  if (message.type === 'COURT_EVENT') {
    out.push([
      String(message.phase || '').padEnd(20),
      String(message.agent || '').padEnd(11),
      String(message.action || '').padEnd(17),
      message.evidence ? `[${message.evidence}] ` : '',
      (message.speech || '').slice(0, 90),
    ].join(' '))
  }
  if (message.type === 'CAMERA') out.push(`${gutter} >>> camera ${message.preset || message.camera}`)
  if (message.type === 'EVENT') out.push(`${gutter} >>> ${message.event} ${message.evidence || message.evidenceId || ''}`)
  if (message.type.startsWith('STREAM_P') || message.type === 'STREAM_RESUME') out.push(`${gutter} ~~~ ${message.type}`)
})

await engine.start({ maxTurns: 80 })

const snapshot = engine.snapshot()
console.log(out.join('\n'))
console.log(`\nphase ${snapshot.phase} after ${snapshot.turnsTaken} turns`)
console.log('message types:', [...types].join(', '))
console.log('evidence:', snapshot.evidence.items?.map((i) => `${i.id}:${i.status}`).join(' '))
console.log('diagnostics:')
for (const entry of engine.diagnostics) console.log(' -', entry.kind, entry.message)
