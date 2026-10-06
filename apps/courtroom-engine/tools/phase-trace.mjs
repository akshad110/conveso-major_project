/**
 * Step a trial one turn at a time and print what the turn manager thinks.
 *
 * The tool to reach for when a phase will not end or an examination loops: it shows
 * the question and answer counts the completion test actually reads.
 *
 *   node tools/phase-trace.mjs [turns]
 */
import { TrialEngine } from '../src/trialEngine.js'
import { ACTIONS } from '../src/courtroomActions.js'

const limit = Number(process.argv[2] || 40)
const engine = new TrialEngine({ speed: 0, stream: false })

for (let turn = 0; turn < limit; turn += 1) {
  const alive = await engine.step()
  const state = engine.state
  const phase = state.currentPhase
  const count = (action) => state.transcript.filter(
    (line) => line.action === action && line.phase === phase,
  ).length

  console.log(
    String(turn).padStart(3),
    phase.padEnd(20),
    `asked ${count(ACTIONS.QUESTION_WITNESS)}`,
    `answered ${count(ACTIONS.ANSWER)}`,
    `complete ${engine.turns.isPhaseComplete(state)}`,
    `cursor ${engine.turns.cursor}`,
    `speaker ${state.currentSpeaker || '-'}`,
  )
  if (!alive) break
}
