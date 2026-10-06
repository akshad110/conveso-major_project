/**
 * Prove the courtroom's result derivation against a real hearing.
 *
 * Runs the actual trial engine in-process, plays a few human turns, takes the
 * snapshot the engine would have broadcast, and pushes it through
 * `deriveCourtroomOutcome` and then `normalizeCourtroomResult` — the same two
 * functions the live path uses, in the same order.
 *
 * This exists because the derivation reads a nested shape. `court.state.transcript`
 * and `court.transcript` both type-check, both run, and one of them silently
 * reports that the student did nothing. Only a real snapshot catches that.
 *
 *   node tools/verify-outcome.mjs [--verbose]
 */
import assert from 'node:assert/strict'
import { normalizeCourtroomResult, PERFORMANCE_AXES } from '@converso/contracts'
import { TrialEngine } from '../apps/courtroom-engine/src/trialEngine.js'
import {
  deriveCourtroomOutcome,
  deriveCourtroomProgress,
  renderTranscript,
} from '../apps/courtroom/src/session/outcome.js'

const verbose = process.argv.includes('--verbose')
let passed = 0
const failures = []

const check = (name, fn) => {
  try {
    const note = fn()
    passed += 1
    if (verbose) console.log(`  ok   ${name}${note ? ` — ${note}` : ''}`)
  } catch (err) {
    failures.push({ name, message: err.message })
    console.log(`  FAIL ${name}\n       ${err.message}`)
  }
}

const section = (name) => console.log(`\n${name}\n`)

/* --- run a hearing --------------------------------------------------------- */

/**
 * What the harness reaches for when it is handed a turn.
 *
 * Ordered so the hearing produces something measurable: a student who only ever
 * takes the first legal action mostly LISTENs, and a report full of zeros proves
 * nothing about whether the counts are wired up. Anything not on this list falls
 * through to the court's own first suggestion.
 */
const PREFERENCE = [
  'QUESTION_WITNESS', 'PRESENT_EVIDENCE', 'SHOW_EVIDENCE',
  'OBJECT', 'RULE', 'SPEAK',
]

/**
 * Play a hearing with a person in one of the seats.
 *
 * Two things about this are not obvious and both were found the hard way.
 *
 * `command` and `step` are async, so a harness that fires them without awaiting
 * gets a trial still sitting in PRE_SESSION and a seat held by nobody.
 *
 * And `seat.ask()` broadcasts YOUR_TURN *before* it constructs the promise that
 * sets `pending`, so an answer submitted in the same tick as the broadcast is
 * dropped as IGNORED. Over a socket that cannot happen — a reply is always a
 * later tick — but in-process it can, so the answer is deferred by a timer.
 * Answering too fast being indistinguishable from not answering is worth knowing.
 */
async function playHearing({ role, maxTurns = 24, budget = 40 }) {
  const trial = new TrialEngine({ log: () => {}, speed: 100, stream: false })
  const played = []

  trial.onBroadcast((message) => {
    if (message?.type !== 'YOUR_TURN') return
    const actions = Array.isArray(message.actions) ? message.actions : []
    const action = PREFERENCE.find((a) => actions.includes(a)) || actions[0]
    if (!action || played.length >= budget) {
      setTimeout(() => trial.seat.handOff({ replyTo: message.id }), 0)
      return
    }
    played.push(action)
    // Deferred on purpose — see above.
    setTimeout(() => {
      trial.seat.submit({
        replyTo: message.id,
        action,
        speech: `On the record, for ${role}.`,
        ruling: action === 'RULE' ? 'SUSTAIN' : null,
        reason: action === 'RULE' ? 'Leading.' : null,
      })
    }, 0)
  })

  await trial.command({ type: 'SET_HUMAN_ROLE', role })

  // `start` blocks on every human turn, so it cannot be awaited before the
  // listener above is in place. The race is a backstop: a hearing that somehow
  // waits on nobody must not hang the verifier.
  const finished = trial.start({ maxTurns })
  await Promise.race([
    finished,
    new Promise((resolve) => setTimeout(resolve, 20_000)),
  ])
  trial.stop()
  await finished.catch(() => {})

  return { trial, played }
}

section('A hearing actually runs')

// Top-level await: the whole file is a report on one real hearing, so there is
// nothing to check until it has been played.
const hearing = await playHearing({ role: 'prosecutor' })
const trial = hearing.trial
const played = hearing.played

check('the engine plays a hearing with a human in the prosecutor seat', () => {
  assert(trial, 'the hearing did not run')
  const snap = trial.snapshot()
  assert.equal(snap.human.role, 'prosecutor', `seat is ${snap.human.role}`)
  assert(snap.turnsTaken > 0, 'no turns were taken')
  return `phase ${snap.phase}, ${snap.turnsTaken} turns`
})

check('the person actually got turns, and they were recorded as played', () => {
  const snap = trial.snapshot()
  assert(played.length > 0, 'the seat was never asked to act')
  assert(snap.human.turnsPlayed > 0, `turnsPlayed is ${snap.human.turnsPlayed}`)
  const mine = snap.state.transcript.filter((l) => l.played === true)
  assert(mine.length > 0, 'nothing in the record is marked as a person speaking')
  return `${snap.human.turnsPlayed} turns played, ${mine.length} lines marked played`
})

check('the snapshot is the nested shape the derivation expects', () => {
  const snap = trial.snapshot()
  assert(snap.state && typeof snap.state === 'object', 'no court.state')
  assert(Array.isArray(snap.state.transcript), 'court.state.transcript is not an array')
  assert(Array.isArray(snap.state.rulings), 'court.state.rulings is not an array')
  assert(snap.evidence && Array.isArray(snap.evidence.items), 'no court.evidence.items')
  assert(snap.state.transcript.length > 0, 'the hearing produced an empty record')
  // The trap this file exists for.
  assert.equal(snap.transcript, undefined, 'court.transcript exists — the shape moved')
  return `${snap.state.transcript.length} lines, ${snap.evidence.items.length} exhibits`
})

check('reading the flat shape off a real hearing reports a student who did nothing', () => {
  // The bug, demonstrated rather than described. `court.transcript` on the real
  // wire shape is undefined, so the old reading produces an empty report from a
  // hearing that has a full record — and throws nothing while doing it.
  const snap = trial.snapshot()
  const wrong = renderTranscript(snap.transcript)
  const right = renderTranscript(snap.state.transcript)
  assert.equal(wrong, '', 'the flat read is no longer empty — recheck this test')
  assert(right.length > 0, 'the nested read is empty — the derivation is broken')
  return `wrong read 0 chars, right read ${right.length}`
})

/* --- the derivation -------------------------------------------------------- */

section('Deriving a result')

check('a real snapshot produces every field the normalizer wants', () => {
  const out = deriveCourtroomOutcome({ court: trial.snapshot(), role: 'prosecutor' })
  for (const key of [
    'role', 'verdict', 'completed', 'objectionsRaised', 'correctObjections',
    'evidencePresented', 'rulings', 'duration', 'performance', 'transcript',
  ]) {
    assert(key in out, `missing ${key}`)
  }
  for (const axis of PERFORMANCE_AXES) {
    assert(Number.isInteger(out.performance[axis]), `${axis} is ${out.performance[axis]}`)
    assert(out.performance[axis] >= 0 && out.performance[axis] <= 100, `${axis} out of range`)
  }
  assert.equal(out.role, 'prosecutor')
  assert.equal(typeof out.transcript, 'string')
  return `score-free report, ${Object.keys(out).length} fields`
})

check('the transcript is text, not JSON', () => {
  const snap = trial.snapshot()
  const text = renderTranscript(snap.state.transcript)
  assert(!text.startsWith('['+ '{'), 'looks like serialised objects')
  assert(!text.includes('"played"'), 'raw line objects leaked in')
  assert(text.length > 0, 'a populated record rendered empty')
  assert(text.includes('(you)'), "the person's own lines are not marked")
  return `${text.length} characters`
})

check('no court means a zero report, not a crash', () => {
  for (const bad of [undefined, null, {}, 'nonsense', 42, []]) {
    const out = deriveCourtroomOutcome({ court: bad, role: 'defense' })
    assert.equal(out.objectionsRaised, 0)
    assert.equal(out.transcript, '')
    assert.equal(out.completed, false)
    assert.equal(out.duration, 0)
  }
  return '6 malformed inputs'
})

check('an unknown seat is dropped, not passed through', () => {
  const out = deriveCourtroomOutcome({ court: trial.snapshot(), role: 'bailiff' })
  assert.equal(out.role, null, `role came back as ${out.role}`)
  return 'role null'
})

/* --- attribution ----------------------------------------------------------- */

section('Attribution')

check('objections are counted from the rulings the student earned', () => {
  const snap = trial.snapshot()
  // Plant a decided objection by each side plus one pending, then check the
  // prosecutor is credited with exactly their own.
  snap.state.rulings = [
    { id: 'obj-1', by: 'prosecutor', ruling: 'SUSTAIN' },
    { id: 'obj-2', by: 'prosecutor', ruling: 'OVERRULE' },
    { id: 'obj-3', by: 'defense', ruling: 'SUSTAIN' },
  ]
  snap.state.pendingObjection = { id: 'obj-4', by: 'prosecutor', ruling: null }

  const pros = deriveCourtroomOutcome({ court: snap, role: 'prosecutor' })
  assert.equal(pros.objectionsRaised, 3, `prosecutor raised ${pros.objectionsRaised}`)
  assert.equal(pros.correctObjections, 1, `prosecutor sustained ${pros.correctObjections}`)

  const def = deriveCourtroomOutcome({ court: snap, role: 'defense' })
  assert.equal(def.objectionsRaised, 1)
  assert.equal(def.correctObjections, 1)

  // A judge does not object, however the record reads.
  const judge = deriveCourtroomOutcome({ court: snap, role: 'judge' })
  assert.equal(judge.objectionsRaised, 0, 'the bench was credited with objections')
  return '3/1 prosecution, 1/1 defence, 0 bench'
})

check('exhibits are credited to whoever tendered them', () => {
  const snap = trial.snapshot()
  snap.evidence.items = [
    { id: 'P1', introducedBy: 'prosecutor', status: 'ADMITTED' },
    { id: 'P2', introducedBy: 'prosecutor', status: 'EXCLUDED' },
    { id: 'D1', introducedBy: 'defense', status: 'ADMITTED' },
    { id: 'X9', introducedBy: null, status: 'MARKED' },
  ]

  const pros = deriveCourtroomOutcome({ court: snap, role: 'prosecutor' })
  assert.equal(pros.evidencePresented, 2, `prosecutor tendered ${pros.evidencePresented}`)

  const def = deriveCourtroomOutcome({ court: snap, role: 'defense' })
  assert.equal(def.evidencePresented, 1, `defence tendered ${def.evidencePresented}`)

  // The half the old version got wrong: the defence tendered one and it was
  // admitted, so their handling must not be dragged down by the prosecution's
  // excluded exhibit.
  assert(
    def.performance.evidenceHandling > pros.performance.evidenceHandling,
    `defence ${def.performance.evidenceHandling} vs prosecution ${pros.performance.evidenceHandling}`,
  )
  return `2 vs 1, handling ${def.performance.evidenceHandling} vs ${pros.performance.evidenceHandling}`
})

check('only lines the person spoke are counted as theirs', () => {
  const snap = trial.snapshot()
  snap.state.transcript = [
    { index: 0, role: 'prosecutor', action: 'QUESTION_WITNESS', text: 'q1', phase: 'DIRECT_EXAMINATION', played: true },
    { index: 1, role: 'prosecutor', action: 'QUESTION_WITNESS', text: 'q2', phase: 'DIRECT_EXAMINATION', played: false },
    { index: 2, role: 'defense', action: 'QUESTION_WITNESS', text: 'q3', phase: 'CROSS_EXAMINATION', played: true },
  ]
  const pros = deriveCourtroomOutcome({ court: snap, role: 'prosecutor' })
  // One question of a target of eight.
  assert.equal(pros.performance.questioning, Math.round((1 / 8) * 100), `got ${pros.performance.questioning}`)
  return `agent line ignored, questioning ${pros.performance.questioning}`
})

check('a judge is credited with the rulings they gave, not the whole bench record', () => {
  const snap = trial.snapshot()
  snap.state.rulings = [
    { id: 'obj-1', by: 'prosecutor', ruling: 'SUSTAIN' },
    { id: 'obj-2', by: 'defense', ruling: 'OVERRULE' },
  ]
  snap.state.transcript = [
    { index: 0, role: 'judge', action: 'RULE', text: 'Sustained.', phase: 'JUDGE_RULING', played: true },
    { index: 1, role: 'judge', action: 'RULE', text: 'Overruled.', phase: 'JUDGE_RULING', played: false },
  ]
  const out = deriveCourtroomOutcome({ court: snap, role: 'judge' })
  assert.equal(out.rulings, 1, `judge credited with ${out.rulings} rulings`)
  return 'agent ruling excluded'
})

/* --- through the normalizer ------------------------------------------------ */

section('Through the server-side normalizer')

check('a derived report survives normalization unchanged in the counts', () => {
  const snap = trial.snapshot()
  snap.state.rulings = [
    { id: 'obj-1', by: 'prosecutor', ruling: 'SUSTAIN' },
    { id: 'obj-2', by: 'prosecutor', ruling: 'SUSTAIN' },
    { id: 'obj-3', by: 'prosecutor', ruling: 'OVERRULE' },
  ]
  snap.evidence.items = [
    { id: 'P1', introducedBy: 'prosecutor', status: 'ADMITTED' },
    { id: 'P2', introducedBy: 'prosecutor', status: 'ADMITTED' },
  ]
  const out = deriveCourtroomOutcome({ court: snap, role: 'prosecutor' })
  const stored = normalizeCourtroomResult(out)

  assert.equal(stored.objectionsRaised, out.objectionsRaised)
  assert.equal(stored.correctObjections, out.correctObjections)
  assert.equal(stored.evidencePresented, out.evidencePresented)
  assert.equal(stored.role, 'prosecutor')
  assert(Number.isInteger(stored.score), `score is ${stored.score}`)
  assert(stored.score > 0, 'a worked hearing scored zero')
  return `3 objections, 2 exhibits → ${stored.score}`
})

check('the real hearing survives the whole path with its work intact', () => {
  // Nothing planted. This is the hearing as played, through both functions in the
  // order the live client uses them, and it is the check that would have caught
  // the nesting bug on its own: every count below reads zero off the flat shape.
  const out = deriveCourtroomOutcome({ court: trial.snapshot(), role: 'prosecutor' })
  const stored = normalizeCourtroomResult(out)

  assert(stored.transcript.length > 0, 'the stored transcript is empty')
  assert(stored.duration > 0, `duration is ${stored.duration}`)
  assert(
    stored.performance.questioning > 0,
    'the prosecutor questioned a witness and scored zero for questioning',
  )
  assert(stored.score > 0, 'a played hearing stored a score of zero')
  assert.equal(stored.role, 'prosecutor')
  // The student was cross-examining when the harness stopped the trial, so the
  // court never closed and the report must not claim it did.
  assert.equal(stored.completed, false, 'an unfinished hearing reported as completed')
  return `q ${stored.performance.questioning}, ${stored.duration}s, score ${stored.score}`
})

check('the derivation never sends a score', () => {
  const out = deriveCourtroomOutcome({ court: trial.snapshot(), role: 'prosecutor' })
  assert(!('score' in out), 'outcome.js is sending a score — the server computes it')
  return 'no score field'
})

check('silence scores low, work scores higher', () => {
  const quiet = normalizeCourtroomResult(
    deriveCourtroomOutcome({ court: trial.snapshot(), role: 'defense' }),
  )

  const busy = trial.snapshot()
  busy.state.rulings = [
    { id: 'o1', by: 'defense', ruling: 'SUSTAIN' },
    { id: 'o2', by: 'defense', ruling: 'SUSTAIN' },
    { id: 'o3', by: 'defense', ruling: 'SUSTAIN' },
  ]
  busy.evidence.items = [
    { id: 'D1', introducedBy: 'defense', status: 'ADMITTED' },
    { id: 'D2', introducedBy: 'defense', status: 'ADMITTED' },
  ]
  busy.state.transcript = Array.from({ length: 8 }, (_, i) => ({
    index: i, role: 'defense', action: 'QUESTION_WITNESS',
    text: `question ${i}`, phase: 'CROSS_EXAMINATION', played: true,
  }))
  busy.phase = 'CASE_CLOSED'

  const worked = normalizeCourtroomResult(deriveCourtroomOutcome({ court: busy, role: 'defense' }))
  assert(worked.score > quiet.score, `worked ${worked.score} is not above quiet ${quiet.score}`)
  assert(worked.completed === true, 'CASE_CLOSED did not read as completed')
  return `${quiet.score} → ${worked.score}`
})

/* --- the bookmark ---------------------------------------------------------- */

section('The mid-hearing bookmark')

check('progress is small, and says where the student is', () => {
  const p = deriveCourtroomProgress({ court: trial.snapshot(), role: 'prosecutor' })
  for (const key of ['phase', 'speaker', 'witness', 'lines', 'turnsPlayed', 'objections', 'at']) {
    assert(key in p, `missing ${key}`)
  }
  assert(!('transcript' in p), 'the bookmark is carrying the whole transcript')
  assert(JSON.stringify(p).length < 400, 'bookmark is too large to send every 15s')
  return `${JSON.stringify(p).length} bytes, phase ${p.phase}`
})

check('a malformed court still yields a sendable bookmark', () => {
  const p = deriveCourtroomProgress({ court: null, role: null })
  assert.equal(p.lines, 0)
  assert.equal(p.phase, null)
  return 'zeroed'
})

/* --- result ---------------------------------------------------------------- */

console.log(`\n${'─'.repeat(64)}`)
if (failures.length) {
  console.log(`FAILED — ${passed} passed, ${failures.length} failed\n`)
  for (const f of failures) console.log(`  ${f.name}\n    ${f.message}`)
  process.exit(1)
}
console.log(`PASSED — ${passed} checks passed, 0 failed\n`)
