/**
 * Print one example of every message type the engine puts on the wire.
 *
 * Written for whoever is building a client: rather than reading courtroomEvents.js
 * and hoping, run this and see the actual JSON a frontend has to handle.
 *
 *   node tools/event-shapes.mjs
 */
import { TrialEngine } from '../src/trialEngine.js'

const seen = new Map()
const engine = new TrialEngine({ speed: 0, stream: true })
engine.onBroadcast((message) => {
  if (!seen.has(message.type)) seen.set(message.type, message)
})

await engine.start({ maxTurns: 60 })

for (const [type, message] of seen) {
  const shown = type === 'STATE'
    ? { ...message, court: '<snapshot elided>' }
    : message
  console.log(`--- ${type} ---`)
  console.log(JSON.stringify(shown, null, 2))
}
