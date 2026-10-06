/**
 * @converso/contracts — the words the four runtimes agree on.
 *
 * Converso (Next 15), the classroom (Next 14), the courtroom (Vite) and the
 * courtroom engine (plain Node) are four separate programs that never share a
 * process. The only thing they share is vocabulary, and this file is it.
 *
 * Two rules keep it honest:
 *
 *   1. Zero dependencies and node builtins only, so the engine — which is
 *      deliberately install-free — can read it without an npm tree.
 *
 *   2. The engine does **not** import this at runtime. It keeps its own
 *      constants in src/courtroomActions.js and stays independently
 *      deployable; tools/verify-contracts.mjs imports both and fails if they
 *      drift. A shared vocabulary enforced by a test beats a shared import
 *      that makes one program unable to start without the other.
 *
 * Nothing here knows about Three.js, GLB clips, bones or camera coordinates.
 * The engine names an intent, the renderer decides what it looks like.
 */

/* ===========================================================================
   Identity and sessions
   =========================================================================== */

/**
 * A simulation session moves in one direction and never goes back.
 *
 *   pending    created, launch token issued, nobody has arrived yet
 *   active     the heavy app validated the session and is running it
 *   completed  a result was accepted and written
 *   abandoned  the student left without finishing
 *   expired    the window closed before anyone arrived
 */
export const SESSION_STATUS = {
  PENDING: 'pending',
  ACTIVE: 'active',
  COMPLETED: 'completed',
  ABANDONED: 'abandoned',
  EXPIRED: 'expired',
}

export const SESSION_STATUS_LIST = Object.values(SESSION_STATUS)

/** A session may only move forward, and only along these edges. */
export const SESSION_TRANSITIONS = {
  [SESSION_STATUS.PENDING]: [SESSION_STATUS.ACTIVE, SESSION_STATUS.EXPIRED, SESSION_STATUS.ABANDONED],
  [SESSION_STATUS.ACTIVE]: [SESSION_STATUS.COMPLETED, SESSION_STATUS.ABANDONED],
  [SESSION_STATUS.COMPLETED]: [],
  [SESSION_STATUS.ABANDONED]: [],
  [SESSION_STATUS.EXPIRED]: [],
}

export function canTransition(from, to) {
  return (SESSION_TRANSITIONS[from] || []).includes(to)
}

/** What kind of heavy experience a session launches. */
export const SIMULATION_KIND = {
  COURTROOM: 'courtroom',
  CLASSROOM: 'classroom',
}

export const SIMULATION_KIND_LIST = Object.values(SIMULATION_KIND)

/** How long a launch token is good for. Short, because it is a doorway. */
export const LAUNCH_TOKEN_TTL_SECONDS = 120

/** How long an unfinished session stays resumable before it expires. */
export const SESSION_TTL_SECONDS = 60 * 60 * 3

/* ===========================================================================
   The frame protocol
   ---------------------------------------------------------------------------
   A scene runs in an iframe on a Converso page, served from another origin. It
   cannot navigate the page that framed it and must not be able to, so "put me
   away" is a message rather than a redirect.

   Both halves of that message live here because a protocol with one
   participant is not a protocol. While the source tag was a string literal in
   the scene and a second literal in the listener, editing one of them broke the
   button with no error anywhere — the listener simply stopped recognising its
   own scene.

   The host checks three things before it acts on a message, and only the tag is
   in this file: the message must come from the window the host itself mounted,
   from the origin that window is served from, and carry one of these tags. The
   first check is the one that cannot be forged; the tag makes an accident as
   unlikely as an attack.
   =========================================================================== */

/** The `source` tag each scene stamps on every message it sends its host. */
export const FRAME_SOURCE = {
  [SIMULATION_KIND.COURTROOM]: 'converso-courtroom',
  [SIMULATION_KIND.CLASSROOM]: 'converso-classroom',
}

/** The tags a Converso page will listen to. Anything else is not ours. */
export const SIMULATION_FRAME_SOURCES = Object.values(FRAME_SOURCE)

/** Every message type a scene may send. Currently one, and that is enough. */
export const FRAME_MESSAGES = {
  RETURN_TO_LESSON: 'RETURN_TO_LESSON',
}

/* ===========================================================================
   Courtroom vocabulary
   =========================================================================== */

/** Every action an agent — human or model — may propose. */
export const COURT_ACTIONS = [
  'SPEAK', 'STAND', 'SIT', 'QUESTION_WITNESS', 'ANSWER', 'OBJECT', 'RULE',
  'PRESENT_EVIDENCE', 'SHOW_EVIDENCE', 'GAVEL', 'POINT', 'REACT',
  'ADMIT_EVIDENCE', 'EXCLUDE_EVIDENCE', 'LISTEN', 'WAIT',
]

/** Everyone in the room. */
export const COURT_ROLES = [
  'judge', 'prosecutor', 'defense', 'witness', 'defendant', 'clerk', 'police',
]

/** The seats a person may take. Everything else is the engine's. */
export const PLAYABLE_ROLES = ['judge', 'prosecutor', 'defense']

/** Message types the engine sends down the socket. */
export const ENGINE_MESSAGES = [
  'STATE', 'EVENT', 'COURT_EVENT', 'ANIMATION', 'DIALOGUE', 'CAMERA',
  'STREAM_START', 'STREAM_TOKEN', 'STREAM_PAUSE', 'STREAM_RESUME', 'STREAM_END',
  'ERROR', 'HUMAN_ROLE', 'YOUR_TURN', 'YOUR_TURN_END',
]

/** Commands the frontend sends back up. */
export const CLIENT_MESSAGES = [
  'START', 'HOLD', 'RESET', 'SET_HUMAN_ROLE', 'HUMAN_ACTION', 'HUMAN_HANDOFF',
  'HUMAN_PASS', 'RESUME',
]

/**
 * Semantic camera names. Presets, never coordinates — the renderer owns where
 * the lens actually sits.
 */
export const CAMERA_PRESETS = [
  'CAMERA_WIDE', 'CAMERA_JUDGE', 'CAMERA_PROSECUTOR', 'CAMERA_DEFENSE',
  'CAMERA_WITNESS', 'CAMERA_DEFENDANT', 'CAMERA_CLERK', 'CAMERA_POLICE',
  'CAMERA_EVIDENCE', 'CAMERA_BENCH_REVERSE',
]

/**
 * The animation clips each role is allowed to be asked for, straight from the
 * integration plan's Phase 7. The manifest loader reads this to decide what to
 * pull off disk: a clip that is not on its role's list is never fetched.
 *
 * These are *logical* names. The frontend resolves each one against the clips
 * a GLB actually contains and degrades honestly when one is missing — which is
 * why the engine can name PRESENT_EVIDENCE for an officer whose pack has no
 * such clip without anything breaking.
 */
export const ROLE_ANIMATIONS = {
  judge: ['IDLE', 'SPEAK', 'LISTEN', 'RULING', 'GAVEL', 'POINT', 'STAND', 'SIT'],
  prosecutor: ['IDLE', 'STAND', 'SIT', 'SPEAK', 'SPEAK_GESTURE', 'OBJECTION', 'PRESENT_EVIDENCE', 'LISTEN'],
  defense: ['IDLE', 'STAND', 'SIT', 'SPEAK', 'SPEAK_GESTURE', 'QUESTION_WITNESS', 'OBJECTION', 'PRESENT_EVIDENCE', 'LISTEN'],
  witness: ['IDLE', 'SPEAK', 'LISTEN', 'NOD', 'SHAKE_HEAD', 'NERVOUS'],
  defendant: ['IDLE', 'STAND', 'SIT', 'LISTEN', 'NERVOUS', 'REACT'],
  police: ['IDLE', 'WALK', 'ESCORT', 'LISTEN', 'SPEAK', 'REACT'],
  clerk: ['IDLE', 'SPEAK', 'LISTEN', 'WRITE'],
}

/* ===========================================================================
   Classroom vocabulary
   =========================================================================== */

export const CLASSROOM_LANGUAGES = ['ja', 'hi', 'es', 'fr', 'de', 'ko']
export const CLASSROOM_REGISTERS = ['formal', 'casual']

/* ===========================================================================
   Result validation
   ---------------------------------------------------------------------------
   The browser is not trusted with a score. It reports what happened; the
   server decides what that is worth. These helpers run on the server side of
   the API route, and the same file is imported by the frontend only so it can
   show the student the same numbers without inventing a second formula.
   =========================================================================== */

const clampInt = (value, lo, hi) => {
  const n = Math.round(Number(value))
  if (!Number.isFinite(n)) return lo
  return Math.min(hi, Math.max(lo, n))
}

/** The performance axes a courtroom result is scored on. */
export const PERFORMANCE_AXES = ['legalReasoning', 'questioning', 'evidenceHandling']

/**
 * Turn a browser's claim into a record the server is willing to write.
 *
 * Every number is re-derived from the counts rather than copied: `score` as the
 * browser reported it is thrown away and recomputed here, so a tampered client
 * gains nothing. The counts themselves are clamped to the bounds the engine
 * could physically have produced, and `transcript` is truncated — a result is
 * a record of a hearing, not an upload endpoint.
 */
export function normalizeCourtroomResult(raw = {}, limits = {}) {
  const maxObjections = limits.maxObjections ?? 40
  const maxEvidence = limits.maxEvidence ?? 40
  const maxRulings = limits.maxRulings ?? 40
  const maxDuration = limits.maxDuration ?? 60 * 60 * 4
  const maxTranscript = limits.maxTranscript ?? 200_000

  const objectionsRaised = clampInt(raw.objectionsRaised, 0, maxObjections)
  const correctObjections = clampInt(raw.correctObjections, 0, objectionsRaised)
  const evidencePresented = clampInt(raw.evidencePresented, 0, maxEvidence)
  const rulings = clampInt(raw.rulings, 0, maxRulings)
  const duration = clampInt(raw.duration, 0, maxDuration)

  const performance = {}
  for (const axis of PERFORMANCE_AXES) {
    performance[axis] = clampInt(raw?.performance?.[axis], 0, 100)
  }

  const transcript = typeof raw.transcript === 'string'
    ? raw.transcript.slice(0, maxTranscript)
    : ''

  return {
    kind: SIMULATION_KIND.COURTROOM,
    role: PLAYABLE_ROLES.includes(raw.role) ? raw.role : null,
    verdict: raw.verdict === 'guilty' || raw.verdict === 'not_guilty' ? raw.verdict : null,
    completed: raw.completed === true,
    objectionsRaised,
    correctObjections,
    evidencePresented,
    rulings,
    duration,
    performance,
    transcript,
    score: scoreCourtroom({ objectionsRaised, correctObjections, evidencePresented, rulings, performance, completed: raw.completed === true }),
  }
}

/**
 * The score, computed server-side and nowhere else.
 *
 * Three quarters of it is the three performance axes, which the engine derives
 * from what actually happened in the hearing. The last quarter is participation
 * — did the student object at all, tender anything, and see it through — because
 * a hearing sat through in silence is not a 75.
 */
export function scoreCourtroom(r) {
  const axes = PERFORMANCE_AXES.map((a) => r.performance?.[a] ?? 0)
  const craft = axes.reduce((s, n) => s + n, 0) / axes.length

  const accuracy = r.objectionsRaised > 0 ? r.correctObjections / r.objectionsRaised : 0
  const took_part = Math.min(1, (r.objectionsRaised + r.evidencePresented + r.rulings) / 6)
  const finished = r.completed ? 1 : 0

  const participation = (accuracy * 0.4 + took_part * 0.35 + finished * 0.25) * 100

  return clampInt(craft * 0.75 + participation * 0.25, 0, 100)
}

/** The same discipline for the classroom: counts in, score out, server-side. */
export function normalizeClassroomResult(raw = {}, limits = {}) {
  const maxQuestions = limits.maxQuestions ?? 500
  const maxDuration = limits.maxDuration ?? 60 * 60 * 4

  const questionsAsked = clampInt(raw.questionsAsked, 0, maxQuestions)
  const phrasesPractised = clampInt(raw.phrasesPractised, 0, maxQuestions)
  const duration = clampInt(raw.duration, 0, maxDuration)
  const language = CLASSROOM_LANGUAGES.includes(raw.language) ? raw.language : null
  const register = CLASSROOM_REGISTERS.includes(raw.register) ? raw.register : null

  return {
    kind: SIMULATION_KIND.CLASSROOM,
    language,
    register,
    questionsAsked,
    phrasesPractised,
    duration,
    completed: raw.completed === true,
    score: scoreClassroom({ questionsAsked, phrasesPractised, duration, completed: raw.completed === true }),
  }
}

export function scoreClassroom(r) {
  // Ten questions is a full lesson's worth of asking; past that the score is
  // earned by practising what came back rather than by asking more.
  const asking = Math.min(1, r.questionsAsked / 10) * 55
  const practice = Math.min(1, r.phrasesPractised / 10) * 30
  const finished = r.completed ? 15 : 0
  return clampInt(asking + practice + finished, 0, 100)
}

/* ===========================================================================
   Shape guards
   ---------------------------------------------------------------------------
   Small, boring, and worth having: every one of these returns a list of
   problems rather than throwing, so an API route can answer 400 with something
   a developer can act on and a log line worth reading.
   =========================================================================== */

export function problemsWithSessionRequest(body = {}) {
  const problems = []
  if (!body.simulationId || typeof body.simulationId !== 'string') {
    problems.push('simulationId is required and must be a string')
  }
  if (body.kind && !SIMULATION_KIND_LIST.includes(body.kind)) {
    problems.push(`kind must be one of ${SIMULATION_KIND_LIST.join(', ')}`)
  }
  if (body.role && !PLAYABLE_ROLES.includes(body.role)) {
    problems.push(`role must be one of ${PLAYABLE_ROLES.join(', ')}`)
  }
  return problems
}

export function problemsWithResult(body = {}, kind = SIMULATION_KIND.COURTROOM) {
  const problems = []
  if (typeof body !== 'object' || body === null) return ['result must be an object']
  if (kind === SIMULATION_KIND.COURTROOM) {
    if (body.performance && typeof body.performance !== 'object') {
      problems.push('performance must be an object')
    }
    if (body.transcript != null && typeof body.transcript !== 'string') {
      problems.push('transcript must be a string')
    }
  }
  if (kind === SIMULATION_KIND.CLASSROOM) {
    if (body.language != null && !CLASSROOM_LANGUAGES.includes(body.language)) {
      problems.push(`language must be one of ${CLASSROOM_LANGUAGES.join(', ')}`)
    }
  }
  return problems
}

/* ===========================================================================
   Error codes the heavy apps may show a student
   ---------------------------------------------------------------------------
   Deliberately coarse. An AI provider's own error text, a database message or
   a stack trace never reaches a browser; it is logged server-side and one of
   these goes out instead.
   =========================================================================== */

export const LAUNCH_ERRORS = {
  NO_TOKEN: 'NO_TOKEN',
  BAD_TOKEN: 'BAD_TOKEN',
  EXPIRED: 'EXPIRED',
  NOT_FOUND: 'NOT_FOUND',
  WRONG_USER: 'WRONG_USER',
  ALREADY_COMPLETED: 'ALREADY_COMPLETED',
  UNAVAILABLE: 'UNAVAILABLE',
}

export const LAUNCH_ERROR_TEXT = {
  NO_TOKEN: 'This page needs to be opened from a lesson.',
  BAD_TOKEN: 'This launch link is not valid. Start the simulation again from the lesson.',
  EXPIRED: 'This launch link has expired. Start the simulation again from the lesson.',
  NOT_FOUND: 'That session no longer exists.',
  WRONG_USER: 'That session belongs to a different account.',
  ALREADY_COMPLETED: 'This session has already been marked complete.',
  UNAVAILABLE: 'The simulation service is not responding.',
}
