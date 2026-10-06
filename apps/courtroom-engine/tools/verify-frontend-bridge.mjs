/**
 * End-to-end bridge check: AI engine -> court event -> frontend renderer state.
 *
 * Runs a whole trial in-process and pipes every broadcast message through the
 * frontend's real `applyCourtEvent`, with the real event contract, the real
 * animation map and the real camera presets. The only things stubbed are the parts
 * that genuinely need a browser and a GPU: each character is a fake handle that
 * resolves clips exactly the way CharacterController does, against the clip list
 * read out of the actual GLB files rather than an assumed one.
 *
 * What that buys is the ten checks the spec asks for, verified together rather
 * than one at a time:
 *
 *   1  the AI produces structured actions
 *   2  the court engine validated every one of them
 *   3  the wire carries COURT_EVENT
 *   4  the frontend receives and normalises it
 *   5  the right character animation resolves to a clip that exists
 *   6  the right camera activates
 *   7  dialogue pauses and resumes around an interruption
 *   8  court state advances correctly
 *   9  evidence state stays consistent
 *  10  Developer Mode's keyboard actions still resolve
 *
 * Two more the architecture asks for rather than the spec:
 *
 *  11  the layering holds — no renderer in the engine, no rulings in the renderer
 *  12  the human seat proposes on the same terms as an agent, and is refused the
 *      same way when it proposes something the court will not have
 *
 * Usage:  node tools/verify-frontend-bridge.mjs [--verbose]
 *         FRONTEND=/path/to/courtroom-sim node tools/verify-frontend-bridge.mjs
 *
 * The frontend copy must have its dependencies installed (the store it drives is a
 * real zustand store), so run `npm install` in the frontend first. Where the
 * frontend lives is worked out by tools/find-frontend.mjs.
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

// Teaches Node the extensionless imports the frontend uses. Must come before any
// dynamic import of frontend code.
import './vite-resolve.mjs'
import { findFrontend } from './find-frontend.mjs'

import { TrialEngine } from '../src/trialEngine.js'
import { ROLE_ACTIONS, ACTION_LIST, ACTIONS, ACTION_ANIMATION, ROLE_ACTION_ANIMATION } from '../src/courtroomActions.js'
import { validateDecision, REJECTION } from '../src/actionValidator.js'
import { CourtroomState, PHASES } from '../src/courtroomState.js'
import { EvidenceEngine } from '../src/evidenceEngine.js'
import { PLAYABLE_ROLES } from '../src/humanSeat.js'

const VERBOSE = process.argv.includes('--verbose')

const located = findFrontend()
if (!located.path) {
  console.error('Could not find the frontend. Looked in:')
  for (const dir of located.tried) console.error(`  ${dir}`)
  console.error('\nSet FRONTEND=/path/to/courtroom-sim and try again.')
  process.exit(2)
}
if (!located.installed) {
  console.error(`Found the frontend at ${located.path}, but its dependencies are not installed.`)
  console.error('This check drives the frontend\'s real store, so run `npm install` there first.')
  process.exit(2)
}
const FRONTEND = located.path

const mod = (rel) => pathToFileURL(path.join(FRONTEND, 'src', rel)).href

// --- frontend modules, unmodified -------------------------------------------

const { applyCourtEvent, resetCourtroom } = await import(mod('state/courtEvents.js'))
const { useCourtStore } = await import(mod('state/useCourtStore.js'))
const { registerCharacter } = await import(mod('state/animationManager.js'))
const { resolveAction, clipMeta, ROLE_IDLE, DERIVED_CLIPS } = await import(mod('config/animationMap.js'))
const { CAMERA_PRESETS } = await import(mod('config/cameraPresets.js'))
const { CHARACTER_REGISTRY, ROLE_ORDER, characterPlacement, placeAt } = await import(mod('config/characterRegistry.js'))
const { WITNESS_STAND, laneRoute, SPAWN_POINTS } = await import(mod('config/courtroomLayout.js'))
const { advanceWalk } = await import(mod('three/walkPath.js'))
const { standOccupant, framing } = await import(mod('state/witnessStand.js'))

const { KEY_ACTIONS } = await import(mod('debug/useDebugControls.js'))
const { COURT_PHASES } = await import(mod('state/eventTypes.js'))

// --- clip names, read from the GLBs ----------------------------------------

/** Pull the animation names out of a .glb's JSON chunk. Never guesses. */
function glbClipNames(file) {
  const buf = fs.readFileSync(file)
  const chunkLength = buf.readUInt32LE(12)
  const json = JSON.parse(buf.subarray(20, 20 + chunkLength).toString('utf8'))
  return (json.animations || []).map((a) => a.name).filter(Boolean)
}

function availableClipsFor(role) {
  const placement = characterPlacement(role)
  const file = path.join(FRONTEND, 'public', placement.model.replace(/^\//, ''))
  const names = new Set(glbClipNames(file))
  // The controller derives subclips at load time for the roles whose exports are
  // too thin; the resolver sees those as available, so this must too.
  for (const [name, spec] of Object.entries(DERIVED_CLIPS[role] || {})) {
    if (names.has(spec.from)) names.add(name)
  }
  return names
}

// --- fake characters --------------------------------------------------------

/** Every play() that reached a character, in order. */
const plays = []

/** Every walk a character was asked to make, run to completion. */
const walks = []
/** `{named, effective}` per cut, so a redirected preset is not read as a miss. */
const cutsRequested = []

/** One frame at 60 fps, which is what the walk is paced against. */
const FRAME = 1 / 60
/** No walk across this room should need more than twenty seconds of frames. */
const MAX_FRAMES = 1200

/** Floor distance a walk covers, start to finish. */
function routeMetres(w) {
  let total = 0
  let prev = w.from
  for (const leg of w.legs) {
    total += Math.hypot(leg[0] - prev[0], leg[2] - prev[2])
    prev = leg
  }
  return total
}

function mountCharacter(role) {
  const available = availableClipsFor(role)
  const entry = CHARACTER_REGISTRY[role]
  const start = characterPlacement(role)
  let posture = entry.startPosture
  const idleName = (p) => ROLE_IDLE[role]?.[p] || 'IDLE'

  // The same pose the real controller keeps on its Object3D.
  const pose = { x: start.position[0], y: start.position[1], z: start.position[2], yaw: start.rotationY }

  const handle = {
    role,
    play(action, options = {}) {
      const requested = action === '__IDLE__' ? idleName(posture) : action
      const res = resolveAction(role, requested, available)
      const meta = clipMeta(res.clip)
      let bridged = null

      // Same posture bridge the real controller inserts.
      if (!options.force && !meta.transition && meta.posture !== posture) {
        const bridge = meta.posture === 'standing' ? 'STAND_UP' : 'SIT_DOWN'
        if (available.has(bridge)) bridged = bridge
        posture = meta.posture
      } else {
        posture = meta.posture
      }

      const record = { role, action: requested, requested: action, ...res, posture, bridged }
      plays.push(record)
      return record
    },
    getState: () => ({ role, posture, clips: [...available] }),

    /**
     * The walk, run for real.
     *
     * The renderer advances this one frame at a time; here it is advanced to
     * completion in a loop, through the frontend's own `advanceWalk`. That is
     * the point — the integrator that moves a body across the floor is the part
     * with no other way to be checked without a GPU, so it is checked here
     * rather than described.
     */
    walkTo(waypoints, facing = null, options = {}) {
      const legs = (waypoints || []).filter((p) => Array.isArray(p) && p.length === 3)
      const from = [pose.x, pose.y, pose.z]
      const walk = {
        legs,
        i: 0,
        facing: typeof facing === 'number' ? facing : null,
        heading: pose.yaw,
        speed: options.speed ?? WITNESS_STAND.speed,
        turnRate: options.turnRate ?? WITNESS_STAND.turnRate,
      }
      if (legs.length) handle.play(options.action || 'WALK')

      let frames = 0
      while (!advanceWalk(pose, walk, FRAME)) {
        frames += 1
        if (frames > MAX_FRAMES) break
      }

      walks.push({
        role,
        from,
        legs,
        to: [pose.x, pose.y, pose.z],
        facing: walk.facing,
        endYaw: pose.yaw,
        frames,
        seconds: frames * FRAME,
        finished: frames <= MAX_FRAMES,
      })
      if (frames <= MAX_FRAMES) handle.play('__IDLE__')
      options.onArrive?.()
      return true
    },
    walkHome: (options = {}) =>
      handle.walkTo([[...start.position]], start.rotationY, options),
    where: () => [pose.x, pose.y, pose.z],
    home: () => ({ position: [...start.position], rotationY: start.rotationY }),
  }

  registerCharacter(role, handle)
  return { role, available }
}


const mounted = ROLE_ORDER.map(mountCharacter)

// --- capture ----------------------------------------------------------------

const wire = []
const cameras = []
const dialogue = []
const phases = []
const evidenceStates = []

let previous = useCourtStore.getState()
useCourtStore.subscribe((next) => {
  if (next.camera !== previous.camera) cameras.push(next.camera)
  if (next.dialogue !== previous.dialogue) {
    dialogue.push({
      speaker: next.dialogue.speaker,
      text: next.dialogue.text,
      paused: next.dialogue.paused,
      streaming: next.dialogue.streaming,
    })
  }
  if (next.courtState !== previous.courtState) phases.push(next.courtState)
  if (next.evidence !== previous.evidence) {
    evidenceStates.push({ ...next.evidence })
  }
  previous = next
})

resetCourtroom()
plays.length = 0
cameras.length = 0
dialogue.length = 0
phases.length = 0
evidenceStates.length = 0

// --- run the trial ----------------------------------------------------------

// The case the server actually ships, so the verification covers the trial the
// player will see — script, exhibits and all. COURT_CASE points it elsewhere.
const CASE_ID = process.env.COURT_CASE || 'state-v-rane'
const trial = new TrialEngine({ caseId: CASE_ID, speed: 0, stream: true, log: () => {} })
trial.onBroadcast((message) => {
  wire.push(message)
  // Which preset this cut will actually land on. `framing()` redirects an agent's
  // own preset to the box while the court has that agent giving evidence, and
  // that is a state which only holds for part of the trial — so it has to be
  // asked here, as the message arrives, not afterwards.
  if (message.camera) {
    cutsRequested.push({ named: message.camera, effective: framing(message.camera, message.agent) })
  }
  // Exactly what the browser's ws.onmessage does, string and all.
  applyCourtEvent(JSON.stringify(message))
})

await trial.command({ type: 'START' })
const snapshot = trial.snapshot()

// --- checks -----------------------------------------------------------------

const results = []
const check = (n, name, pass, detail) => {
  results.push({ n, name, pass: Boolean(pass), detail })
}

const courtEvents = wire.filter((m) => m.type === 'COURT_EVENT')
const transcript = snapshot.state.transcript || []

// 1 — the AI produced structured actions, not prose.
{
  const known = transcript.filter((l) => ACTION_LIST.includes(l.action))
  check(1, 'AI generates structured actions',
    transcript.length > 10 && known.length === transcript.length,
    `${known.length}/${transcript.length} transcript lines carry a known action`)
}

// 2 — every action on the wire was one the role actually had standing to take,
//     and the five impossible actions the spec names are actually turned away.
//     A clean run proves nothing about the validator on its own: it has to be
//     shown refusing things, so these are put to it directly.
{
  const illegal = courtEvents.filter(
    (e) => !(ROLE_ACTIONS[e.agent] || []).includes(e.action),
  )

  const scene = (phase, { witness = null, objection = false } = {}) => {
    const state = new CourtroomState()
    state.setPhase(phase, { force: true })
    state.activeWitness = witness
    if (objection) state.raiseObjection?.({ by: 'defense', grounds: 'LEADING' })
    return state
  }
  const register = () => {
    const ev = new EvidenceEngine()
    ev.load([{ id: 'EXHIBIT_A', title: 'Exhibit A', type: 'DOCUMENT', proponent: 'prosecutor' }])
    return ev
  }

  const impossible = [
    ['witness cannot object',
      { role: 'witness', action: ACTIONS.OBJECT, speech: 'Objection!' },
      scene(PHASES.CROSS_EXAMINATION, { witness: 'witness' }),
      REJECTION.ROLE_NOT_PERMITTED],
    ['defendant cannot tender prosecution evidence',
      { role: 'defendant', action: ACTIONS.PRESENT_EVIDENCE, evidence: 'EXHIBIT_A' },
      scene(PHASES.EVIDENCE),
      [REJECTION.ROLE_NOT_PERMITTED, REJECTION.EVIDENCE_NOT_YOURS]],
    ['prosecutor cannot question a witness in the wrong phase',
      { role: 'prosecutor', action: ACTIONS.QUESTION_WITNESS, speech: 'Where were you?' },
      scene(PHASES.PROSECUTION_OPENING),
      [REJECTION.PHASE_NOT_PERMITTED, REJECTION.NO_WITNESS_ON_STAND]],
    ['judge cannot rule with no objection pending',
      { role: 'judge', action: ACTIONS.RULE, speech: 'Sustained.' },
      scene(PHASES.DIRECT_EXAMINATION, { witness: 'witness' }),
      REJECTION.NO_PENDING_OBJECTION],
    ['unadmitted evidence cannot be shown as admitted',
      { role: 'prosecutor', action: ACTIONS.SHOW_EVIDENCE, evidence: 'EXHIBIT_A' },
      scene(PHASES.CROSS_EXAMINATION, { witness: 'witness' }),
      REJECTION.EVIDENCE_NOT_ADMITTED],
  ]

  const missed = []
  for (const [label, decision, state, expected] of impossible) {
    const want = Array.isArray(expected) ? expected : [expected]
    const verdict = validateDecision(decision, { state, evidenceEngine: register() })
    const codes = verdict.rejections.map((r) => r.code)
    const refused = verdict.ok === false
      && codes.some((c) => want.includes(c))
      // The substitute must be safe: a different, silent action, with the words
      // the agent had prepared dropped rather than passed through.
      && verdict.decision.action !== decision.action
      && !verdict.decision.speech
    if (!refused) missed.push(`${label} (got ok=${verdict.ok} ${codes.join(',') || 'no code'} -> ${verdict.decision.action})`)
  }

  check(2, 'Court engine validates every decision',
    illegal.length === 0 && missed.length === 0,
    illegal.length ? `illegal on wire: ${illegal.map((e) => `${e.agent}:${e.action}`).join(', ')}`
      : missed.length ? `not refused: ${missed.join('; ')}`
        : `${courtEvents.length} events all within role standing; all ${impossible.length} impossible actions refused and safely replaced`)
}

// 3 — the wire carries COURT_EVENT, plus the stream and state messages.
{
  const types = new Set(wire.map((m) => m.type))
  const need = ['COURT_EVENT', 'STATE', 'STREAM_START', 'STREAM_END']
  const missing = need.filter((t) => !types.has(t))
  check(3, 'WebSocket contract carries COURT_EVENT',
    missing.length === 0,
    missing.length ? `missing ${missing.join(', ')}` : [...types].sort().join(' '))
}

// 4 — the frontend received and logged them.
{
  const log = useCourtStore.getState().log
  const last = useCourtStore.getState().lastEvent
  check(4, 'Frontend receives and normalises events',
    log.length > 0 && last && last.type && last.raw,
    `log holds ${log.length} normalised events; last was ${last?.type} ${last?.event || ''}`)
}

// 5 — every animation resolved to a clip that exists on that character, and the
//     engine only ever named semantic actions, never a GLB clip.
{
  const nulls = plays.filter((p) => !p.clip)
  const fallbacks = plays.filter((p) => p.fallback)
  const wrongCharacter = plays.filter((p) => {
    const own = mounted.find((m) => m.role === p.role)
    return own && p.clip && !own.available.has(p.clip)
  })

  // The engine has no idea what is inside the GLBs and must not pretend to. The
  // only names it may use are the semantic ones in courtroomActions.
  const vocabulary = new Set([
    ...Object.values(ACTION_ANIMATION),
    ...Object.values(ROLE_ACTION_ANIMATION).flatMap((m) => Object.values(m)),
  ])
  const invented = [...new Set(
    wire.map((m) => m.animation).filter(Boolean),
  )].filter((a) => !vocabulary.has(a))

  check(5, 'Correct character animation plays',
    plays.length > 0 && nulls.length === 0 && wrongCharacter.length === 0
      && invented.length === 0,
    invented.length
      ? `engine named non-semantic animations: ${invented.join(', ')}`
      : `${plays.length} plays from ${new Set(wire.map((m) => m.animation).filter(Boolean)).size} semantic names, ${fallbacks.length} graceful fallbacks, ${nulls.length} unresolved`)
}

// 6 — every camera named on the wire is a real preset, the frontend actually
//     moved the camera, and the objection beat cut to counsel and then the bench.
{
  const named = wire.map((m) => m.camera).filter(Boolean)
  const unknown = [...new Set(named)].filter((c) => !CAMERA_PRESETS[c])
  const objection = courtEvents.findIndex((e) => e.action === 'OBJECT')
  const ruling = courtEvents.findIndex((e, i) => i > objection && e.action === 'RULE')
  const cutToCounsel = objection >= 0
    && /^CAMERA_(PROSECUTOR|DEFENSE)$/.test(courtEvents[objection].camera)
  const cutToBench = ruling > 0 && courtEvents[ruling].camera === 'CAMERA_JUDGE'
  // The store is what the rig reads, so a preset named on the wire that never
  // reaches `camera` is a camera that never moved.
  //
  // One exception, and it is a redirect rather than a miss: while the court has
  // somebody in the box who does not live there, `framing()` sends that agent's
  // own preset to CAMERA_WITNESS, because their own preset is framed on a seat
  // they are not sitting in. CAMERA_POLICE is named on the wire and correctly
  // never applied for exactly as long as the officer is giving evidence. So the
  // test is that the redirect landed somewhere real, not that every named preset
  // was obeyed literally.
  const applied = new Set(cameras)
  const redirected = new Set(
    cutsRequested
      .filter((c) => c.effective !== c.named && applied.has(c.effective))
      .map((c) => c.named),
  )
  const unapplied = [...new Set(named)].filter((c) => !applied.has(c) && !redirected.has(c))

  check(6, 'Correct camera activates',
    unknown.length === 0 && cutToCounsel && cutToBench && unapplied.length === 0
      && applied.has('CAMERA_JUDGE'),
    unknown.length ? `unknown presets: ${unknown.join(', ')}`
      : unapplied.length ? `named but never applied to the store: ${unapplied.join(', ')}`
        : `${applied.size} presets applied over ${cameras.length} cuts${redirected.size ? `, ${[...redirected].join('/')} redirected to the box` : ''}; objection cut to ${courtEvents[objection]?.camera}, ruling to ${courtEvents[ruling]?.camera}`)
}

// 7 — dialogue paused for the interruption and the same speaker picked their own
//     sentence back up afterwards.
{
  const pauseAt = dialogue.findIndex((d) => d.paused)
  const parked = pauseAt >= 0 ? dialogue[pauseAt - 1] : null
  const resumedAt = pauseAt >= 0
    ? dialogue.findIndex((d, i) => i > pauseAt && !d.paused && d.speaker === parked?.speaker)
    : -1
  const carriedOn = resumedAt > 0 && dialogue
    .slice(resumedAt)
    .some((d) => d.speaker === parked.speaker && d.text.length > parked.text.length)
  const streamPause = wire.filter((m) => m.type === 'STREAM_PAUSE')
  const streamResume = wire.filter((m) => m.type === 'STREAM_RESUME')

  check(7, 'Dialogue pauses and resumes correctly',
    pauseAt >= 0 && carriedOn && streamPause.length === streamResume.length,
    `${streamPause.length} pause / ${streamResume.length} resume; ${parked?.speaker} was cut off at ${parked?.text.length} chars and finished the line`)
}

// 8 — the phase the HUD shows tracked the engine, in a legal order, to the end.
{
  const seen = phases.filter((p, i) => p !== phases[i - 1])
  const unknown = seen.filter((p) => !COURT_PHASES.includes(p))
  const order = seen.filter((p) => p !== 'OBJECTION' && p !== 'JUDGE_RULING')

  // A trial only moves forward, with one lawful exception: the court calls more
  // than one witness, so cross of one person is followed by direct of the next.
  // That step reads as backwards on a flat phase list and is not — so it is
  // allowed by name, and every other backwards step still fails the check.
  const RECALL = 'CROSS_EXAMINATION -> DIRECT_EXAMINATION'
  const monotonic = order.every((p, i) => {
    if (i === 0) return true
    if (`${order[i - 1]} -> ${p}` === RECALL) return true
    return COURT_PHASES.indexOf(p) >= COURT_PHASES.indexOf(order[i - 1])
      || p === order[i - 1]
  })

  // And the court did hear more than one person, which is what the recall is for.
  const witnessesHeard = new Set(
    (snapshot.state?.transcript || [])
      .filter((l) => l.action === 'ANSWER' && l.witness)
      .map((l) => l.witness),
  )

  check(8, 'Court state updates correctly',
    unknown.length === 0 && monotonic && seen.at(-1) === 'CASE_CLOSED'
      && snapshot.phase === 'CASE_CLOSED' && witnessesHeard.size > 1,
    unknown.length ? `unknown phases: ${unknown.join(', ')}`
      : `${witnessesHeard.size} witnesses examined; ${seen.join(' -> ')}`)
}

// 9 — the monitor only ever showed an exhibit the register had, and nothing was
//     described as admitted before the bench admitted it.
{
  const register = snapshot.evidence.items || snapshot.evidence || []
  const ids = new Set((Array.isArray(register) ? register : []).map((i) => i.id))
  const shown = evidenceStates.filter((e) => e.visible).map((e) => e.id)
  const strangers = shown.filter((id) => id && !ids.has(id))

  const admitIndex = courtEvents.findIndex((e) => e.action === 'ADMIT_EVIDENCE')
  const earlyClaim = courtEvents.findIndex(
    (e, i) => admitIndex >= 0 && i < admitIndex && e.action === 'SHOW_EVIDENCE',
  )
  const admitted = (Array.isArray(register) ? register : []).filter((i) => i.status === 'ADMITTED')

  check(9, 'Evidence state remains consistent',
    strangers.length === 0 && earlyClaim === -1 && admitted.length > 0
      && shown.length > 0,
    strangers.length
      ? `monitor showed unknown exhibits: ${strangers.join(', ')}`
      : `${shown.length} monitor cues, admitted: ${admitted.map((i) => i.id).join(', ') || 'none'}`)
}

// 10 — Developer Mode: every keyboard action still resolves for every role.
{
  const broken = []
  for (const role of ROLE_ORDER) {
    const available = availableClipsFor(role)
    for (const action of Object.values(KEY_ACTIONS)) {
      const wanted = action === 'IDLE'
        ? ROLE_IDLE[role]?.[CHARACTER_REGISTRY[role].startPosture] || 'IDLE'
        : action === 'NERVOUS' && role !== 'witness' && role !== 'defendant'
          ? 'REACT'
          : action
      const res = resolveAction(role, wanted, available)
      if (!res.clip) broken.push(`${role}:${action}`)
    }
  }
  check(10, 'Developer Mode keyboard controls still work',
    broken.length === 0,
    broken.length ? `unresolved: ${broken.join(', ')}` : `${ROLE_ORDER.length} roles x ${Object.keys(KEY_ACTIONS).length} keys all resolve`)
}

// 11 — the architecture rule itself, checked rather than trusted. "AI decides
//      WHAT, the state engine WHETHER, the event system WHEN, the frontend HOW."
//      The two halves are only genuinely separable if neither one imports the
//      other's concerns, and that is something source text can answer.
{
  const complaints = []

  // No Three.js, no GLB, no coordinates in the engine.
  const engineDir = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'src')
  const engineFiles = fs.readdirSync(engineDir, { recursive: true })
    .filter((f) => String(f).endsWith('.js'))
  for (const file of engineFiles) {
    const text = fs.readFileSync(path.join(engineDir, String(file)), 'utf8')
    const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    if (/\bfrom\s+['"]three|THREE\.|\.glb\b|new Vector3|useFrame|useGLTF/.test(code)) {
      complaints.push(`engine src/${file} reaches into the renderer`)
    }
  }

  // No camera coordinates on the wire — presets are named, never positioned.
  const positioned = wire.filter(
    (m) => m.position || m.target || (m.camera && typeof m.camera !== 'string'),
  ).filter((m) => typeof m.target !== 'string')
  if (positioned.length) complaints.push(`${positioned.length} messages carried camera geometry`)

  // And no courtroom rule-making on the renderer side: the frontend may react to
  // a ruling but must never decide one. Word-stem, not word-boundary — the first
  // version of this check looked for \bSUSTAIN\b and sailed straight past a
  // `Math.random() < 0.5 ? 'Sustained.' : 'Overruled.'` sitting in plain sight.
  const rendererText = fs.readFileSync(path.join(FRONTEND, 'src/state/courtEvents.js'), 'utf8')
  const rendererCode = rendererText.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const invents = rendererCode.match(/^.*(SUSTAIN|OVERRUL)\w*.*$/gim) || []
  // Reacting to an event named SUSTAINED/OVERRULED is fine; producing the words is
  // not, and neither is any randomness anywhere in this file.
  const authored = invents.filter((l) => /['"`]\s*(Sustained|Overruled)/i.test(l))
  if (authored.length) complaints.push(`courtEvents.js authors rulings: ${authored.map((l) => l.trim()).join(' | ')}`)
  if (/Math\.random/.test(rendererCode)) complaints.push('courtEvents.js decides outcomes by coin flip')

  check(11, 'Layering holds (engine has no Three.js, frontend has no rulings)',
    complaints.length === 0,
    complaints.length ? complaints.join('; ')
      : `${engineFiles.length} engine modules renderer-free; wire carries named presets only; renderer makes no rulings`)
}

// 12 — the human seat, on the same terms as an agent.
//      A second trial is run with the prosecution played by a person, and every
//      answer is composed from the frontend's *own store* — so this also proves the
//      YOUR_TURN payload carries enough for a client to answer with. The first
//      answer is deliberately illegal: a prosecutor purporting to rule. What must
//      happen is that validateDecision refuses it, the court asks again with the
//      reason, and the illegal action never reaches the wire.
{
  const { PLAYABLE_SEATS } = await import(mod('state/eventTypes.js'))

  const hwire = []
  const asks = []
  const refusals = []
  let illegalSent = 0
  let handOffs = 0
  let objectionsRaised = 0
  const tendered = []
  const waitingSeen = []

  resetCourtroom()
  const human = new TrialEngine({ caseId: CASE_ID, speed: 0, stream: false, log: () => {} })

  /** Answer from what the frontend holds, exactly as the panel does. */
  const answer = () => {
    const seat = useCourtStore.getState().human
    const prompt = seat.prompt
    if (!prompt) return
    waitingSeen.push(seat.waiting)
    asks.push(prompt.kind)
    if (prompt.rejection) refusals.push(prompt.rejection.code)

    // An objection offer: raise the first ground the objection engine found, then
    // let every later question stand.
    if (prompt.kind === 'OBJECTION') {
      if (objectionsRaised === 0 && prompt.grounds?.length) {
        objectionsRaised += 1
        human.command({
          type: 'HUMAN_ACTION',
          action: 'OBJECT',
          category: prompt.grounds[0].category,
          speech: 'Objection, Your Honour.',
        })
      } else {
        human.command({ type: 'HUMAN_PASS' })
      }
      return
    }

    // The illegal move, once: prosecuting counsel trying to rule from the floor.
    if (illegalSent === 0 && !prompt.rejection) {
      illegalSent += 1
      human.command({ type: 'HUMAN_ACTION', action: 'RULE', ruling: 'SUSTAIN', speech: 'Sustained.' })
      return
    }

    // One turn handed to the AI, to prove the button.
    if (asks.length === 4 && handOffs === 0) {
      handOffs += 1
      human.command({ type: 'HUMAN_HANDOFF' })
      return
    }

    const action = prompt.actions?.includes(prompt.expect) ? prompt.expect : prompt.actions?.[0]
    // The panel makes the person choose when the court offers several exhibits, and
    // will not send until they have. This stands in for that choice.
    const candidates = prompt.evidenceOptions?.[action] || []
    if (candidates.length) tendered.push(candidates[0])
    human.command({
      type: 'HUMAN_ACTION',
      action,
      evidence: candidates.length ? candidates[0] : undefined,
      speech: 'If it please the court, the prosecution proceeds.',
    })
  }

  human.onBroadcast((message) => {
    hwire.push(message)
    applyCourtEvent(JSON.stringify(message))
    // The socket answers on its own tick, the way a browser would.
    if (message.type === 'YOUR_TURN') setImmediate(answer)
  })

  await human.command({ type: 'SET_HUMAN_ROLE', role: 'prosecutor' })
  await human.command({ type: 'START' })
  const hsnap = human.snapshot()
  const hstore = useCourtStore.getState().human

  const hEvents = hwire.filter((m) => m.type === 'COURT_EVENT')
  const played = (hsnap.state.transcript || []).filter((l) => l.played)
  const outsideStanding = played.filter((l) => !(ROLE_ACTIONS[l.role] || []).includes(l.action))
  const impersonated = played.filter((l) => l.role !== 'prosecutor')
  // The refused action must never appear on the wire for that role.
  const illegalOnWire = hEvents.filter((e) => e.agent === 'prosecutor' && e.action === 'RULE')

  const complaints = []
  if (hstore.role !== 'prosecutor' || hstore.label !== 'Prosecutor') {
    complaints.push(`frontend seat is ${hstore.label || hstore.role || 'unclaimed'}`)
  }
  if (!asks.length) complaints.push('the court never asked the person anything')
  if (!waitingSeen.length || waitingSeen.some((w) => w !== true)) {
    complaints.push('the store was not waiting when the prompt arrived')
  }
  if (hstore.waiting || hstore.prompt) complaints.push('a question was left open at the end')
  if (illegalSent && !refusals.includes('ROLE_NOT_PERMITTED')) {
    complaints.push(`the illegal ruling was not refused (${refusals.join(',') || 'no refusal seen'})`)
  }
  // Anything else refused means the panel offered a move the court was never going
  // to take — the court is right, the panel is wrong, and this is where that shows.
  const unexpected = refusals.filter((c) => c !== 'ROLE_NOT_PERMITTED')
  if (unexpected.length) {
    complaints.push(`${unexpected.length} avoidable refusals: ${[...new Set(unexpected)].join(',')}`)
  }
  if (tendered.length && !played.some((l) => l.action === 'PRESENT_EVIDENCE')) {
    complaints.push('the exhibit the person tendered never reached the record')
  }
  if (illegalOnWire.length) complaints.push(`${illegalOnWire.length} refused actions reached the wire`)
  if (!played.length) complaints.push('no human decision was recorded')
  if (outsideStanding.length) {
    complaints.push(`recorded outside role standing: ${outsideStanding.map((l) => l.action).join(',')}`)
  }
  if (impersonated.length) complaints.push(`recorded under another role: ${impersonated.map((l) => l.role).join(',')}`)
  if (hstore.handOffs < 1 || hsnap.human.handOffs < 1) complaints.push('the hand-off never took')
  if (hstore.turnsPlayed < 1) complaints.push('the frontend counted no turns played')
  if (hsnap.phase !== 'CASE_CLOSED') complaints.push(`trial ended at ${hsnap.phase}`)
  if (PLAYABLE_SEATS.length !== PLAYABLE_ROLES.length
    || PLAYABLE_SEATS.some((s) => !PLAYABLE_ROLES.includes(s.role))) {
    complaints.push('the start screen offers seats the engine does not')
  }

  // And the panel must remain a renderer: it may show what the engine said is
  // allowed, but it may not hold an opinion about it.
  for (const file of ['ui/TurnPanel.jsx', 'ui/RoleSelect.jsx']) {
    const text = fs.readFileSync(path.join(FRONTEND, 'src', file), 'utf8')
    const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    if (/ROLE_ACTIONS|PHASE_ACTIONS|validateDecision|REJECTION\b|Math\.random/.test(code)) {
      complaints.push(`${file} carries courtroom rules`)
    }
    if (/['"](COURT_EVENT|DISPATCH)['"]/.test(code)) {
      complaints.push(`${file} puts events on the wire directly`)
    }
  }

  check(12, 'Human seat proposes, the court still decides',
    complaints.length === 0,
    complaints.length ? complaints.join('; ')
      : `${asks.length} prompts (${[...new Set(asks)].join('/')}), ${played.length} decisions recorded as played, `
        + `1 refused as ${refusals.join(',')} and never reached the wire, ${hsnap.human.handOffs} handed to the AI, `
        + `${objectionsRaised} objection raised; trial closed at ${hsnap.phase}`)
}

// 13 — the box holds one person, and whoever the court is examining walks into
//      it. The engine names the role in its snapshot and nothing more; the walk,
//      the route and the clip are the renderer's business, so what is checked
//      here is that the renderer did them and did them safely — every walk
//      terminates, lands square in the box, keeps clear of the furniture, and
//      never leaves two people standing in the same box.
{
  const complaints = []
  const box = placeAt('police', 'WITNESS_POSITION')
  const boxCentre = SPAWN_POINTS.WITNESS_POSITION.position
  const near = (a, b, tol) => Math.hypot(a[0] - b[0], a[2] - b[2]) <= tol
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2])

  // Every obstacle in the room worth walking around, taken from the layout
  // rather than guessed: the two boxes, the two counsel tables, the clerk's
  // desk and the bench are all at a named spawn point.
  const obstacles = Object.entries(SPAWN_POINTS).map(([name, s]) => ({ name, at: s.position }))
  const CLEARANCE = 0.9
  const SAMPLE = 0.1

  if (!walks.length) complaints.push('nobody was walked anywhere during the whole trial')

  const stalled = walks.filter((w) => !w.finished)
  if (stalled.length) {
    complaints.push(`${stalled.length} walk(s) never reached the target (${stalled[0].role})`)
  }

  // Route safety: sample each leg and keep away from anything that is not this
  // walk's own start or finish.
  for (const w of walks) {
    let prev = w.from
    for (const leg of w.legs) {
      const span = dist(prev, leg)
      const steps = Math.max(1, Math.ceil(span / SAMPLE))
      for (let i = 0; i <= steps; i += 1) {
        const t = i / steps
        const p = [prev[0] + (leg[0] - prev[0]) * t, 0, prev[2] + (leg[2] - prev[2]) * t]
        for (const o of obstacles) {
          // A seat you are leaving or arriving at is not an obstacle.
          if (dist(o.at, w.from) < 1 || dist(o.at, w.to) < 1) continue
          if (dist(o.at, p) < CLEARANCE) {
            complaints.push(`${w.role} walked within ${dist(o.at, p).toFixed(2)}m of ${o.name}`)
          }
        }
      }
      prev = leg
    }
  }

  // Arrivals: anyone the court seats has to end up square in the box.
  const arrivals = walks.filter((w) => near(w.to, boxCentre, 0.6))
  for (const w of arrivals) {
    if (!near(w.to, box.position, 0.35)) {
      complaints.push(`${w.role} stopped short of the box at [${w.to.map((n) => n.toFixed(2))}]`)
    }
    const off = Math.abs(Math.atan2(Math.sin(w.endYaw - w.facing), Math.cos(w.endYaw - w.facing)))
    if (w.facing === null || off > 1e-6) {
      complaints.push(`${w.role} ended the walk facing ${(off * 180 / Math.PI).toFixed(1)} deg off`)
    }
  }

  // One box, one person. Replayed in walk order, because that is the order the
  // court called them in.
  const standing = new Map()
  for (const role of ROLE_ORDER) standing.set(role, characterPlacement(role).position)
  for (const w of walks) {
    standing.set(w.role, w.to)
    const inBox = [...standing].filter(([, p]) => near(p, boxCentre, 0.6)).map(([r]) => r)
    if (inBox.length > 1) complaints.push(`${inBox.join(' and ')} both in the box`)
  }

  const whoTookTheStand = [...new Set(arrivals.map((w) => w.role))]
  if (!whoTookTheStand.includes('police')) {
    complaints.push('the officer was never walked into the box')
  }

  const metres = walks.reduce((n, w) => n + routeMetres(w), 0)
  check(13, 'The witness box is walked into, one person at a time',
    complaints.length === 0,
    complaints.length ? [...new Set(complaints)].slice(0, 4).join('; ')
      : `${walks.length} walks, ${metres.toFixed(1)}m, longest ${Math.max(...walks.map((w) => w.seconds)).toFixed(1)}s; `
        + `${arrivals.length} arrivals in the box by ${whoTookTheStand.join(', ')}; `
        + `current occupant ${standOccupant()}`)
}

// --- report -----------------------------------------------------------------

if (VERBOSE) {
  console.log('\n--- court events ---')
  for (const e of courtEvents) {
    console.log(
      `${String(e.phase).padEnd(20)} ${String(e.agent).padEnd(11)} ${String(e.action).padEnd(17)} ${String(e.animation).padEnd(17)} ${String(e.camera).padEnd(19)} ${e.speech ? `"${e.speech}"` : ''}`,
    )
  }
  console.log('\n--- animation resolutions ---')
  for (const p of plays) {
    console.log(
      `${p.role.padEnd(11)} ${String(p.action).padEnd(17)} -> ${String(p.clip).padEnd(18)} ${p.fallback ? `(${p.reason})` : ''}${p.bridged ? ` [via ${p.bridged}]` : ''}`,
    )
  }
  console.log('\n--- camera cuts ---')
  console.log(cameras.join(' -> '))
}

console.log('')
console.log(`frontend: ${FRONTEND}`)
let failed = 0
for (const r of results) {
  if (!r.pass) failed += 1
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${String(r.n).padStart(2)}. ${r.name}`)
  console.log(`        ${r.detail}`)
}

console.log(`\n${results.length - failed}/${results.length} checks passed`)
console.log(
  `wire: ${Object.entries(
    wire.reduce((acc, m) => ({ ...acc, [m.type]: (acc[m.type] || 0) + 1 }), {}),
  ).map(([t, n]) => `${t}=${n}`).join(' ')}`,
)

process.exit(failed ? 1 : 0)
