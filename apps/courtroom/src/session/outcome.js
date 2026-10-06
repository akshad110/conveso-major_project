/**
 * What the hearing was worth, read off the court record.
 *
 * This file turns the engine's broadcast snapshot into the body of
 * `POST /complete`. It is a pure function of that snapshot and nothing else — no
 * timers, no stores, no DOM — so the same record always produces the same report,
 * and a disputed grade can be re-derived from the transcript afterwards.
 *
 * Two rules shaped every line of it.
 *
 * It reports counts, not a grade. Converso recomputes the score server-side from
 * these numbers and discards whatever `score` a browser sends, which is the right
 * way round: this is a browser, and a browser can be told to say anything. So
 * there is no score here to be tampered with, and nothing gained by tampering
 * with the counts either — inflating them only moves a student inside a range
 * Converso clamps anyway.
 *
 * Every number is a ratio of things the engine wrote down. Not one of them is an
 * opinion about how well the student argued. The three `PERFORMANCE_AXES` are the
 * tempting place to start inventing — "was that a good objection?" — and they are
 * deliberately the most boring part of the file: objections sustained over
 * objections made, questions put over a stated target, exhibits admitted over
 * exhibits tendered. A model's view of a student's advocacy may well belong in
 * Converso one day, but it belongs there, computed once on a server, not in
 * fifteen browsers each with its own idea.
 *
 * ---
 *
 * The shape this reads is `trialEngine.snapshot()`, which arrives as `court` on a
 * STATE message and is NOT flat:
 *
 *   court.phase                 the trial's phase, a PHASES key
 *   court.state                 courtroomState.snapshot() — transcript, rulings,
 *                               admittedEvidence, pendingObjection, startedAt
 *   court.evidence              evidenceEngine.snapshot() — items with a status
 *                               and an `introducedBy`, which is what makes
 *                               evidence attributable to a student at all
 *   court.human                 humanSeat.snapshot() — role, turnsPlayed, handOffs
 *
 * Reading `court.transcript` instead of `court.state.transcript` is the mistake
 * this comment exists to prevent. It does not throw; it silently reports a
 * student who did nothing.
 */
import { PERFORMANCE_AXES, PLAYABLE_ROLES } from '@converso/contracts'

/* --- what the engine calls things ----------------------------------------- */

/**
 * Copied, not imported.
 *
 * The courtroom app does not depend on the engine package — it only ever sees
 * the engine's JSON across a socket — so these are the wire's spellings, kept
 * here as the one place to fix if the engine ever renames them. The verifier
 * checks this list against the engine's own constants, which is what stops the
 * copy from silently rotting.
 */
const SUSTAINED = 'SUSTAIN'
const PHASE_CASE_CLOSED = 'CASE_CLOSED'
const ADMITTED = 'ADMITTED'
const EXAMINATION_PHASES = new Set(['DIRECT_EXAMINATION', 'CROSS_EXAMINATION'])

const ACTION = {
  QUESTION_WITNESS: 'QUESTION_WITNESS',
  PRESENT_EVIDENCE: 'PRESENT_EVIDENCE',
  SHOW_EVIDENCE: 'SHOW_EVIDENCE',
  RULE: 'RULE',
  OBJECT: 'OBJECT',
  SPEAK: 'SPEAK',
}

/**
 * How much of each thing counts as having done the job properly.
 *
 * These are the denominators of the axes, and they are stated as constants
 * because a target buried in an expression is a target nobody can argue with.
 * They are per-hearing, not per-phase: a hearing has one examination each way,
 * so eight questions is a worked examination rather than a token one, three
 * objections is enough for an accuracy figure to mean anything, and two tenders
 * is both sides' documents.
 */
const TARGET = {
  objections: 3,
  questions: 8,
  evidence: 2,
  interventions: 4,
}

/* --- small arithmetic ------------------------------------------------------ */

const isArray = Array.isArray
const ratio = (n, d) => (d > 0 ? Math.min(1, n / d) : 0)
const pct = (n) => Math.max(0, Math.min(100, Math.round(n * 100)))

/**
 * A blend of "was it right" and "was there enough of it".
 *
 * One sustained objection is not a perfect score and nine wild ones are not a
 * good hearing, so accuracy is weighted with reach rather than used alone. A
 * student who says nothing scores zero on both halves, which is the intended
 * answer — the alternative, an empty average of an empty set, reads as 100.
 */
const accurateAndActive = (correct, total, target) =>
  0.6 * ratio(correct, total) + 0.4 * ratio(total, target)

/* --- finding the record ----------------------------------------------------- */

/**
 * Pull the three sub-snapshots out of whatever arrived.
 *
 * Tolerant on purpose. This runs at the end of a hearing that may have lost its
 * socket half-built, and a report that throws on unload is a hearing with no
 * result at all. It also accepts a bare `courtroomState` snapshot — the engine's
 * older wire sent one — so a mismatched pair of versions degrades to a thin
 * report rather than an empty one.
 */
function readSnapshot(court) {
  const top = court && typeof court === 'object' ? court : {}
  // `state` is the nested court record. If it is absent but the top level has a
  // transcript, this is the flat older shape and it is its own record.
  const record = top.state && typeof top.state === 'object' ? top.state : top

  return {
    phase: top.phase ?? record.currentPhase ?? null,
    record,
    evidence: top.evidence && typeof top.evidence === 'object' ? top.evidence : null,
    seat: top.human && typeof top.human === 'object' ? top.human : null,
    events: isArray(top.eventHistory)
      ? top.eventHistory
      : isArray(record.eventHistory)
        ? record.eventHistory
        : [],
  }
}

/**
 * The lines a person spoke, as opposed to the lines an agent spoke.
 *
 * `played` is the engine's own flag, set when a decision came from the human
 * seat rather than from an agent, so this needs no guesswork about authorship.
 * The role is compared as well because the seat can change hands mid-hearing and
 * a student is answerable for their own turns only.
 */
const spokenBy = (transcript, role) =>
  isArray(transcript) && role
    ? transcript.filter((line) => line && line.played === true && line.role === role)
    : []

const countAction = (lines, action) => lines.filter((line) => line.action === action).length

/**
 * The exhibits this student put before the court, and what became of them.
 *
 * `introducedBy` is stamped by the evidence engine when counsel tenders an
 * exhibit, which is what makes this attributable at all — the court record's
 * `admittedEvidence` is a list of bare ids with no tenderer attached, and
 * counting those would credit one side for the other's documents.
 */
function exhibitsOf(evidence, role) {
  const items = evidence && isArray(evidence.items) ? evidence.items : []
  if (!role) return { tendered: 0, admitted: 0 }
  const mine = items.filter((item) => item && (item.introducedBy === role || item.proponent === role))
  return {
    tendered: mine.filter((item) => item.introducedBy === role).length,
    admitted: mine.filter((item) => item.status === ADMITTED).length,
  }
}

/**
 * The court record as text, for a human to read later.
 *
 * Converso stores this against the session and truncates it at 200 000
 * characters. Rendering it here rather than shipping the array is deliberate:
 * the column is a record of what was said, not a serialised state object, and a
 * reader six months from now should not need this app to make sense of it.
 */
export function renderTranscript(transcript) {
  if (!isArray(transcript)) return ''
  return transcript
    .filter((line) => line && line.text)
    .map((line) => {
      const who = line.played ? `${line.role} (you)` : line.role
      const where = line.witness ? `${line.phase} · ${line.witness}` : line.phase
      return `[${where}] ${who}: ${line.text}`
    })
    .join('\n')
}

/* --- the axes -------------------------------------------------------------- */

/**
 * Three numbers, each measuring the thing the seat actually does.
 *
 * A judge does not object and counsel does not rule, so the same axis is read
 * off different columns depending on which seat the student held. What stays
 * constant is that every figure is a count over a count: nothing here consults a
 * model, and nothing here can be true of a student who did not do it.
 *
 *   legalReasoning    counsel  objections sustained, weighted with how many were
 *                              made — spotting the ground and picking the moment.
 *                     judge    the share of objections raised in court that
 *                              reached a recorded ruling, weighted with how many
 *                              rulings were given. A bench that leaves calls
 *                              hanging is the failure mode being measured.
 *
 *   questioning       counsel  questions put in examination, over the target.
 *                     judge    interventions from the bench, over the target —
 *                              a judge's questioning is clarification, not
 *                              examination, so it has its own smaller target.
 *
 *   evidenceHandling  counsel  how much was tendered, and how much of it the
 *                              court admitted rather than excluded.
 *                     judge    the share of tendered exhibits the bench decided
 *                              either way. An undecided tender is the thing
 *                              being counted against.
 */
function performanceFor({ seat, human, snap, objections, correct, rulingsGiven }) {
  const questionsPut = countAction(
    human.filter((line) => EXAMINATION_PHASES.has(line.phase)),
    ACTION.QUESTION_WITNESS,
  )

  const rulings = isArray(snap.record.rulings) ? snap.record.rulings : []
  const objectionsInCourt = rulings.length + (snap.record.pendingObjection ? 1 : 0)

  if (seat === 'judge') {
    const interventions = countAction(human, ACTION.SPEAK) + countAction(human, ACTION.RULE)

    // Everything anyone put before the court, and how much of it the bench ruled
    // on. Read off the evidence engine's own tally, which counts every item by
    // status, so an exhibit still sitting at INTRODUCED counts against the bench.
    const items = snap.evidence && isArray(snap.evidence.items) ? snap.evidence.items : []
    const tenderedToCourt = items.filter((i) => i && i.introducedBy).length
    const decidedByCourt = items.filter(
      (i) => i && i.introducedBy && (i.status === ADMITTED || i.status === 'EXCLUDED'),
    ).length

    return {
      legalReasoning: pct(
        0.6 * ratio(rulingsGiven, objectionsInCourt) +
          0.4 * ratio(rulingsGiven, TARGET.objections),
      ),
      questioning: pct(ratio(interventions, TARGET.interventions)),
      evidenceHandling: pct(ratio(decidedByCourt, tenderedToCourt)),
    }
  }

  const exhibits = exhibitsOf(snap.evidence, seat)

  return {
    legalReasoning: pct(accurateAndActive(correct, objections, TARGET.objections)),
    questioning: pct(ratio(questionsPut, TARGET.questions)),
    // Both halves are this student's own: what they tendered, and how much of
    // what they tendered survived. `introducedBy` is what makes the second half
    // theirs rather than the court's average.
    evidenceHandling: pct(
      accurateAndActive(exhibits.admitted, exhibits.tendered, TARGET.evidence),
    ),
  }
}

/* --- the verdict ----------------------------------------------------------- */

/**
 * The finding, if the court actually made one.
 *
 * Converso accepts 'guilty' or 'not_guilty' and stores anything else as null,
 * and null is the honest answer far more often than it looks: the training
 * bench reserves judgment in most cases and delivers a reasoning event instead
 * of a finding. Reading a verdict out of a phase name — CASE_CLOSED means
 * something was decided, surely — would invent a conviction, so this only
 * reports what an event said in those words.
 */
function verdictFrom(events) {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i]
    if (!event || event.type !== 'VERDICT') continue
    const said = String(
      event.verdict ?? event.finding ?? event.outcome ?? event.text ?? '',
    ).toLowerCase()
    if (said.includes('not guilty') || said.includes('not_guilty')) return 'not_guilty'
    if (said.includes('guilty')) return 'guilty'
    return null
  }
  return null
}

/* --- the report ------------------------------------------------------------ */

/**
 * Derive the completion report.
 *
 * `court` is the trial snapshot exactly as it arrived on the wire. `role` is the
 * seat Converso stamped on the session — passed in rather than read from
 * `court.human.role`, because the session row is the authority on which seat was
 * sold and the engine's copy is downstream of it. They agree in practice; when
 * they do not, the booking wins.
 *
 * The shape returned is the one `normalizeCourtroomResult` expects. It is worth
 * knowing what that function will do to this object: clamp every count, clamp
 * `correctObjections` to `objectionsRaised`, clamp the axes to 0–100, truncate
 * the transcript, drop an unknown role and recompute the score from scratch. So
 * the numbers below are the *claim*, and none of them is load-bearing on trust.
 */
export function deriveCourtroomOutcome({ court, role = null, now = Date.now() } = {}) {
  const snap = readSnapshot(court)
  const seat = PLAYABLE_ROLES.includes(role) ? role : null

  const rulings = isArray(snap.record.rulings) ? snap.record.rulings : []
  const human = spokenBy(snap.record.transcript, seat)

  // Objections the student made, decided or still on the bench's desk. A call
  // that never got a ruling still cost them something to make, so it counts
  // towards how much they took part and not towards how often they were right.
  const mine = seat ? rulings.filter((r) => r && r.by === seat) : []
  const pendingIsMine = Boolean(seat && snap.record.pendingObjection?.by === seat)

  const objectionsRaised = seat === 'judge' ? 0 : mine.length + (pendingIsMine ? 1 : 0)
  const correctObjections = seat === 'judge' ? 0 : mine.filter((r) => r.ruling === SUSTAINED).length

  // Rulings the student gave from the bench. Counted off the transcript rather
  // than off `rulings`, because `rulings` holds every decision in the hearing
  // including the ones an agent judge made before the student took the seat,
  // and `played` is the engine's own record of which were a person's.
  const rulingsGiven = seat === 'judge' ? countAction(human, ACTION.RULE) : 0

  const exhibits = exhibitsOf(snap.evidence, seat)
  // Falls back to the transcript when the evidence snapshot is missing, which is
  // the older wire shape. Counting the spoken tender is less precise — it cannot
  // tell a re-tender from a new exhibit — so it is second choice, not first.
  const evidencePresented =
    exhibits.tendered ||
    countAction(human, ACTION.PRESENT_EVIDENCE) + countAction(human, ACTION.SHOW_EVIDENCE)

  const started = Date.parse(snap.record.startedAt ?? '')
  const duration = Number.isFinite(started) ? Math.max(0, Math.round((now - started) / 1000)) : 0

  const performance = performanceFor({
    seat,
    human,
    snap,
    objections: objectionsRaised,
    correct: correctObjections,
    rulingsGiven,
  })

  return {
    role: seat,
    verdict: verdictFrom(snap.events),
    completed: snap.phase === PHASE_CASE_CLOSED,
    objectionsRaised,
    correctObjections,
    evidencePresented,
    rulings: rulingsGiven,
    duration,
    performance,
    transcript: renderTranscript(snap.record.transcript),
  }
}

/**
 * The bookmark sent mid-hearing.
 *
 * Small on purpose. It exists so a student who comes back is told where they
 * were, not so Converso can second-guess the score — the phase, the depth of the
 * record, and how much the student has said is everything a "you were here"
 * line needs. It is written to the session row on every call, so it stays cheap.
 */
export function deriveCourtroomProgress({ court, role = null } = {}) {
  const snap = readSnapshot(court)
  const seat = PLAYABLE_ROLES.includes(role) ? role : null
  const human = spokenBy(snap.record.transcript, seat)

  return {
    phase: snap.phase,
    speaker: snap.record.currentSpeaker ?? null,
    witness: snap.record.activeWitness ?? null,
    lines: isArray(snap.record.transcript) ? snap.record.transcript.length : 0,
    turnsPlayed: snap.seat?.turnsPlayed ?? human.length,
    objections: isArray(snap.record.rulings) ? snap.record.rulings.length : 0,
    at: new Date().toISOString(),
  }
}

/** The axes this file fills in, exported so the verifier can check none is missed. */
export const AXES = PERFORMANCE_AXES
