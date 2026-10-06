/**
 * The human seat, tested without a browser anywhere near it.
 *
 * Two things matter here and nothing else does. First, that the seat is only a
 * mailbox: it carries a question out and an answer back, and holds no opinion
 * about whether the answer is allowed. Second, that a person's answer is put
 * through the same gate as a model's — so an illegal move from a client is refused
 * with a reason and never reaches the wire, and a client cannot act as a role it
 * does not hold.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { HumanSeat, PLAYABLE_ROLES, ANSWER_KINDS, SUBMIT_RESULTS } from '../src/humanSeat.js'
import { TrialEngine } from '../src/trialEngine.js'

test('the seat carries questions and answers, and decides nothing', async () => {
  const sent = []
  const seat = new HumanSeat({ broadcast: (m) => sent.push(m) })

  assert.equal(seat.claim('bailiff').ok, false, 'only three seats are playable')
  assert.deepEqual(PLAYABLE_ROLES, ['judge', 'prosecutor', 'defense'])

  const claim = seat.claim('Prosecutor')
  assert.equal(claim.ok, true)
  assert.equal(seat.role, 'prosecutor', 'the role is normalised and remembered')
  assert.equal(sent.at(-1).type, 'HUMAN_ROLE')

  // A question goes out and the promise stays open until it is answered.
  const asked = seat.ask({ kind: 'TURN', actions: ['SPEAK'], expect: 'SPEAK' })
  assert.equal(seat.waiting(), true)
  assert.equal(sent.at(-1).type, 'YOUR_TURN')
  assert.equal(sent.at(-1).role, 'prosecutor', 'the seat stamps the role, not the client')

  assert.equal(
    seat.submit({ action: 'SPEAK', speech: 'May it please the court.' }),
    SUBMIT_RESULTS.ACCEPTED,
  )
  const answer = await asked
  assert.equal(answer.kind, ANSWER_KINDS.DECISION)
  assert.equal(answer.payload.speech, 'May it please the court.')
  assert.equal(seat.waiting(), false)
  assert.equal(sent.at(-1).type, 'YOUR_TURN_END')
  assert.equal(sent.at(-1).resolution, 'decision')

  // Every question is numbered, and an answer names the one it answers. An
  // answer naming a question the court has already closed is *late*, not wrong —
  // a double-clicked Send, or a click that lands as a refusal comes back — so it
  // is dropped rather than applied to whatever is open now. Without this, words
  // written for one question end up in the person's mouth on the next.
  const second = seat.ask({ kind: 'TURN', actions: ['SPEAK'] })
  const openId = seat.prompt.id
  assert.equal(
    seat.submit({ replyTo: openId - 1, action: 'SPEAK', speech: 'meant for the last one' }),
    SUBMIT_RESULTS.STALE,
  )
  assert.equal(seat.waiting(), true, 'a late answer must not close the live question')
  assert.equal(
    seat.submit({ replyTo: openId, action: 'SPEAK', speech: 'Ready, Your Honour.' }),
    SUBMIT_RESULTS.ACCEPTED,
  )
  assert.equal((await second).payload.speech, 'Ready, Your Honour.')

  // Both other exits close the question too, and say which one was used.
  const handed = seat.ask({ kind: 'TURN', actions: ['SPEAK'] })
  seat.handOff()
  assert.equal((await handed).kind, ANSWER_KINDS.HANDOFF)

  const cancelled = seat.ask({ kind: 'OBJECTION', actions: ['OBJECT'] })
  seat.cancel('trial stopped')
  const end = await cancelled
  assert.equal(end.kind, ANSWER_KINDS.CANCELLED)
  assert.equal(end.reason, 'trial stopped')

  // Nothing is left waiting, so there is nothing to answer — and that is a
  // different thing from a late answer: this one the client should hear about.
  assert.equal(seat.submit({ action: 'SPEAK' }), SUBMIT_RESULTS.IGNORED)
})

test('a person\'s illegal move is refused with a reason and never reaches the wire', async () => {
  const wire = []
  const asks = []
  const trial = new TrialEngine({ speed: 0, stream: false, log: () => {} })

  trial.onBroadcast((message) => {
    wire.push(message)
    if (message.type !== 'YOUR_TURN') return
    asks.push(message)
    setImmediate(() => {
      if (message.kind === 'OBJECTION') return trial.command({ type: 'HUMAN_PASS' })
      // Once: prosecuting counsel purporting to rule from the floor.
      if (asks.length === 1) {
        return trial.command({ type: 'HUMAN_ACTION', action: 'RULE', ruling: 'SUSTAIN', speech: 'Sustained.' })
      }
      const action = message.actions.includes(message.expect) ? message.expect : message.actions[0]
      const exhibits = message.evidenceOptions?.[action] || []
      return trial.command({
        type: 'HUMAN_ACTION',
        action,
        evidence: exhibits[0],
        speech: 'The prosecution proceeds.',
      })
    })
  })

  await trial.command({ type: 'SET_HUMAN_ROLE', role: 'prosecutor' })
  await trial.command({ type: 'START' })

  const refused = asks.filter((a) => a.rejection)
  assert.ok(refused.length >= 1, 'the court should have asked again with a reason')
  assert.equal(refused[0].rejection.code, 'ROLE_NOT_PERMITTED')
  assert.match(refused[0].rejection.message, /\S/, 'the reason is in words, not just a code')

  const events = wire.filter((m) => m.type === 'COURT_EVENT')
  assert.equal(
    events.filter((e) => e.agent === 'prosecutor' && e.action === 'RULE').length,
    0,
    'the refused ruling must not appear on the wire',
  )

  const snapshot = trial.snapshot()
  const played = (snapshot.state.transcript || []).filter((l) => l.played)
  assert.ok(played.length > 0, 'the person\'s accepted decisions are marked in the record')
  assert.ok(played.every((l) => l.role === 'prosecutor'), 'and only ever under their own role')
  assert.equal(snapshot.phase, 'CASE_CLOSED', 'the trial still finished')
  assert.equal(snapshot.human.role, 'prosecutor')
})

test('on the bench, the person is asked to rule and the ruling binds the court', async () => {
  const wire = []
  const kinds = []
  const trial = new TrialEngine({ speed: 0, stream: false, log: () => {} })

  trial.onBroadcast((message) => {
    wire.push(message)
    if (message.type !== 'YOUR_TURN') return
    kinds.push(message.kind)
    setImmediate(() => {
      if (message.kind === 'OBJECTION') return trial.command({ type: 'HUMAN_PASS' })
      if (message.kind === 'RULING' || message.rulings?.length) {
        return trial.command({ type: 'HUMAN_ACTION', action: 'RULE', ruling: 'OVERRULE', speech: '' })
      }
      const action = message.actions.includes(message.expect) ? message.expect : message.actions[0]
      const exhibits = message.evidenceOptions?.[action] || []
      return trial.command({ type: 'HUMAN_ACTION', action, evidence: exhibits[0], speech: 'Proceed.' })
    })
  })

  await trial.command({ type: 'SET_HUMAN_ROLE', role: 'judge' })
  await trial.command({ type: 'START' })

  // Counsel is still an agent, so an objection has to come from the AI side, and
  // when it does the bench is the seat that must answer it.
  assert.ok(kinds.includes('RULING'), 'the bench was asked to rule on counsel\'s objection')

  const decided = trial.snapshot().state.rulings.filter((r) => r.ruling)
  assert.ok(decided.length >= 1, 'the ruling reached the record')
  assert.ok(
    decided.every((r) => r.ruling === 'OVERRULE'),
    'and it is the ruling the person chose, not one the simulation picked',
  )
  assert.ok(
    wire.some((m) => m.type === 'COURT_EVENT' && m.agent === 'judge' && m.action === 'RULE'),
    'the ruling was announced to the room',
  )
  assert.equal(trial.snapshot().phase, 'CASE_CLOSED')
})

test('the seat can be given up, and the AI takes the case back', async () => {
  const trial = new TrialEngine({ speed: 0, stream: false, log: () => {} })
  const prompts = []
  trial.onBroadcast((m) => {
    if (m.type === 'YOUR_TURN') prompts.push(m)
  })

  await trial.command({ type: 'SET_HUMAN_ROLE', role: 'judge' })
  assert.equal(trial.snapshot().human.role, 'judge')
  await trial.command({ type: 'SET_HUMAN_ROLE', role: null })
  assert.equal(trial.snapshot().human.role, null)

  await trial.command({ type: 'START' })
  assert.equal(prompts.length, 0, 'an empty seat is never asked anything')
  assert.equal(trial.snapshot().phase, 'CASE_CLOSED')
})
