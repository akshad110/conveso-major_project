/**
 * Court event handler — turns a wire event into animation, camera, evidence and
 * dialogue. This is the single entry point the AI engine's socket feeds.
 *
 * The division of labour, which this file is the seam of:
 *
 *   the AI decides WHAT should happen
 *   the Courtroom State Engine decides WHETHER it is allowed
 *   the Event Queue decides WHEN it happens
 *   the WebSocket transports it
 *   this file decides HOW it looks
 *
 * So there is no courtroom logic below. Nothing here rules on an objection, picks
 * a ruling, decides whether evidence is admitted or works out whose turn it is —
 * by the time a message arrives all of that has been settled upstream. What is
 * left is presentation: which camera, which clip, when the text reveals, when a
 * character comes back to rest.
 *
 * Two producers feed this. The AI trial sends COURT_EVENT + STREAM_* and is
 * rendered literally, beat by beat, because it sends every beat itself. The mock
 * feed and Developer Mode send the older coarse EVENT names (OBJECTION,
 * ESCORT_DEFENDANT) which stand for a whole passage of action, so those are
 * expanded into the local composite sequences below. `engineDriven` is what tells
 * the two apart, and it flips the first time an engine-only message arrives.
 *
 * Defensive throughout: unknown agents, unknown animations and unknown events all
 * degrade to something sensible and land in the event log rather than throwing.
 */
import { playAnimation, playSequence, cancelSequence } from './animationManager'
import { useCourtStore } from './useCourtStore'
import {
  normalizeEvent, logicalAction, EVENT_TYPES, ENGINE_TYPES, NAMED_EVENTS,
  isKnownAgent, REST,
} from './eventTypes'
import { cameraForRole } from '../config/cameraPresets'
import { getExhibit } from '../config/exhibits'
import { setStandOccupant, resetStand, framing } from './witnessStand'

const store = () => useCourtStore.getState()

/**
 * Cut to a preset. Pass the agent whose beat this is and the cut follows them
 * if the court has moved them — the officer called to give evidence is framed
 * in the box rather than in the corner her own preset looks at.
 */
function cut(camera, agent) {
  if (camera) store().setCamera(framing(camera, agent))
}

function speak(agent, text) {
  store().setDialogue({ speaker: agent, text, paused: false, streaming: false })
}

// --- engine mode -------------------------------------------------------------

/**
 * True once the AI engine has spoken. Not a preference — a statement about which
 * producer is driving, because the same EVENT name means different things
 * depending on who sent it (see the header).
 */
let engineDriven = false

export function isEngineDriven() {
  return engineDriven
}

/** Used by the mock feed to hand the floor back to the local composites. */
export function setEngineDriven(on) {
  engineDriven = Boolean(on)
}

// --- dialogue streaming ------------------------------------------------------

/**
 * The line currently being delivered, and the one an interruption pushed aside.
 *
 * An objection cuts across a witness mid-sentence, and the engine then resumes
 * that witness from the exact character they were cut off at — so the partial
 * line has to survive the interruption. One level deep is enough: the engine does
 * not allow an objection to an objection.
 */
let line = { agent: null, full: '', shown: '', pose: null }
let heldLine = null

/** Agents holding a one-shot pose until their line finishes. */
const heldPose = new Map()

function resetDialogueState() {
  line = { agent: null, full: '', shown: '', pose: null }
  heldLine = null
  heldPose.clear()
}

/** Return a character to their resting pose if they were holding one for a line. */
function releasePose(agent) {
  if (!agent || !heldPose.has(agent)) return
  heldPose.delete(agent)
  playAnimation(agent, REST, { fade: 0.4 })
}

/* --- the court going quiet --------------------------------------------------
 *
 * A dropped socket is not an event, so nothing above will ever be told about it.
 * Left alone, whatever was in flight when the connection went stays in flight
 * for good: a half-streamed line keeps its streaming flag and never finishes, a
 * character keeps the one-shot pose it took for a sentence that will not arrive,
 * and a local composite sequence carries on playing beats for a passage of
 * action the engine has moved past.
 *
 * So the drop is turned into the one thing this file already knows how to do —
 * a pause — using exactly the machinery STREAM_PAUSE uses. That is deliberate:
 * an interruption the engine asks for and an interruption the network causes
 * look the same on screen, and the one that already works is the one to reuse.
 *
 * What neither of these does is replay. On reconnect the server sends the full
 * snapshot as its first two messages, so the record, the phase, the evidence
 * register and an open question are all restored from the engine's own copy.
 * Anything this file tried to reconstruct locally would be a second version of
 * events, and the wrong one.
 */

/** The court has gone quiet. Park everything in flight; rebuild nothing. */
export function holdPresentation() {
  // A local composite is a guess about what comes next, and after a drop it is a
  // guess with nothing behind it.
  cancelSequence()

  // Park the line the way STREAM_PAUSE parks it, so a speaker who is still
  // mid-sentence when the socket returns is picked up rather than restarted.
  if (line.agent && line.shown !== line.full) heldLine = { ...line }

  // Let every held pose go. A character frozen in a one-shot gesture reads as a
  // bug; the same character at rest reads as a court waiting, which is the truth.
  for (const agent of [...heldPose.keys()]) releasePose(agent)

  store().setDialogue({ paused: true, streaming: false })
}

/**
 * The socket is back.
 *
 * Only the pause is lifted. The engine's snapshot has already arrived by the
 * time anything calls this, and the next COURT_EVENT or STREAM_* will set the
 * dialogue itself — so putting text back on screen here would be this file
 * narrating from memory alongside an engine narrating from the record.
 */
export function releasePresentation() {
  if (heldLine) {
    line = heldLine
    heldLine = null
  }
  store().setDialogue({ paused: false })
}

// --- literal rendering (AI engine) -------------------------------------------

/**
 * Render one validated court event exactly as sent: camera, then animation, then
 * dialogue. No sequencing, no invention — the engine's queue already paced this
 * beat and will send the next one when it is due.
 */
function renderCourtEvent(e) {
  if (e.phase) store().setCourtState(e.phase)
  cut(e.camera, e.agent)

  let pose = null
  if (e.agent && e.animation && isKnownAgent(e.agent)) {
    pose = logicalAction(e.agent, e.animation)
    if (pose) {
      // A speaking beat holds its pose: snapping back to idle halfway through a
      // sentence reads as a glitch. STREAM_END releases it.
      const holds = e.speaks
      playAnimation(e.agent, pose, {
        autoReturn: holds ? false : undefined,
        timeScale: e.raw?.timeScale,
      })
      if (holds) heldPose.set(e.agent, pose)
    }
  }

  if (e.speaks && e.speech) {
    // The STREAM_* messages that follow own the reveal. Setting the full line
    // here as well means a producer that does not stream still shows something.
    line = { agent: e.agent, full: e.speech, shown: e.speech, pose }
    store().setDialogue({
      speaker: e.agent, text: e.speech, paused: false, streaming: false,
    })
  }

  if (e.evidence && e.action === 'ADMIT_EVIDENCE') {
    // Presentation only: the engine's evidence register decided this already.
    const ex = getExhibit(e.evidence)
    store().showEvidence({ id: e.evidence, ...ex, status: 'ADMITTED' })
  }
}

function streamStart(e) {
  const streaming = e.streaming
  line = {
    agent: e.agent,
    full: e.text || '',
    shown: streaming ? '' : e.text || '',
    // The pose was set by the COURT_EVENT this stream belongs to, which arrived
    // immediately before it. Keep it so a resume can put the character back.
    pose: line.agent === e.agent ? line.pose : null,
  }
  store().setDialogue({
    speaker: e.agent, text: line.shown, paused: false, streaming,
  })
  cut(e.camera, e.agent)
}

function streamToken(e) {
  if (e.agent && e.agent !== line.agent) {
    line = { agent: e.agent, full: '', shown: '', pose: null }
  }
  line.shown += e.token || ''
  store().setDialogue({ speaker: line.agent, text: line.shown, paused: false })
}

function streamPause(e) {
  // Park the line rather than abandon it; the speaker gets it back.
  heldLine = { ...line }
  store().setDialogue({ paused: true })
  if (e.agent) releasePose(e.agent)
}

function streamResume(e) {
  if (heldLine) {
    line = heldLine
    heldLine = null
  }
  if (typeof e.from === 'number' && e.from >= 0 && line.full) {
    // Trust the engine's offset over our own count.
    line.shown = line.full.slice(0, e.from) || line.shown
  }
  store().setDialogue({
    speaker: line.agent, text: line.shown, paused: false, streaming: true,
  })
  if (line.agent && line.pose) {
    playAnimation(line.agent, line.pose, { autoReturn: false })
    heldPose.set(line.agent, line.pose)
  }
}

function streamEnd(e) {
  const text = e.text || line.shown
  if (!e.agent || e.agent === line.agent) {
    line.shown = text
    store().setDialogue({ speaker: line.agent || e.agent, text, streaming: false })
  }
  releasePose(e.agent || line.agent)
}

// --- the person at the table --------------------------------------------------

/**
 * The human seat, mirrored into the store so the UI can show it.
 *
 * Note what is *not* here: no decision, no validation, no list of what the person
 * may do. `YOUR_TURN` arrives with the legal actions already worked out by the
 * Courtroom State Engine, and the panel renders that list rather than computing
 * one — a frontend that decided what was allowed would be the frontend making
 * courtroom rulings.
 */
function humanRole(e) {
  store().setHumanSeat({
    role: e.role,
    label: e.raw?.label || null,
    seats: e.raw?.seats || [],
  })
}

function yourTurn(e) {
  const prompt = e.raw || {}
  store().setHumanPrompt(prompt)
  // Presentation only: put the camera on whoever is being asked, so the person
  // can see the seat they are speaking from. An objection window keeps its own
  // framing — the witness who is mid-answer is the thing worth looking at.
  if (prompt.kind === 'TURN' && e.role && isKnownAgent(e.role)) cut(cameraForRole(e.role), e.role)
}

function yourTurnEnd(e) {
  store().endHumanTurn({
    id: e.raw?.id ?? null,
    resolution: e.raw?.resolution || null,
    reason: e.reason,
  })
}

// --- composite sequences (mock feed / Developer Mode) ------------------------

/**
 * The objection beat, expanded locally from a single coarse EVENT. The AI engine
 * never takes this path — it sends each beat as its own COURT_EVENT, including the
 * ruling, which is not a decision this side is allowed to make.
 *
 * Which is why the ruling here has to be *given* to us. A producer that sends the
 * coarse EVENT is standing in for the engine and owns the outcome; if it does not
 * supply one, the bench simply reacts and says nothing rather than this file
 * inventing a ruling it has no standing to make.
 */
function objectionSequence({ agent = 'prosecutor', text, ruling }) {
  store().setCourtState('OBJECTION')
  store().setDialogue({ paused: true })

  playSequence(
    [
      { at: 0, run: () => cut(cameraForRole(agent), agent) },
      // STAND is a posture transition; the controller bridges seated -> standing.
      { at: 60, role: agent, action: 'STAND' },
      { at: 900, role: agent, action: 'OBJECTION', options: { autoReturn: false } },
      { at: 950, run: () => speak(agent, text || 'Objection, your honour!') },
      { at: 2200, run: () => cut(cameraForRole('judge')) },
      { at: 2400, role: 'judge', action: 'GAVEL' },
      ...(ruling ? [{ at: 2500, run: () => speak('judge', ruling) }] : []),
      { at: 4200, run: () => cut(cameraForRole(agent), agent) },
      { at: 4300, role: agent, action: 'IDLE_SITTING' },
      {
        at: 5200,
        run: () => {
          cut('CAMERA_WIDE')
          store().setDialogue({ paused: false })
          store().setCourtState('IN_SESSION')
        },
      },
    ],
  )
}

/** Camera to the wall display, exhibit up, counsel presents, then back. */
function showEvidenceSequence({ agent = 'prosecutor', evidence, camera }) {
  const ex = getExhibit(evidence)
  store().setCourtState('EVIDENCE_PRESENTATION')

  playSequence([
    { at: 0, role: agent, action: 'PRESENT_EVIDENCE', options: { autoReturn: false } },
    {
      at: 250,
      run: () => {
        store().showEvidence({ id: evidence, ...ex })
        cut(camera || 'CAMERA_EVIDENCE')
      },
    },
    {
      at: 300,
      run: () => speak(agent, `The court's attention to ${ex.exhibit}.`),
    },
    { at: 3400, run: () => cut(cameraForRole(agent), agent) },
    {
      at: 5200,
      run: () => {
        store().setCourtState('IN_SESSION')
        store().setDialogue({ paused: false })
      },
    },
  ])
}

/** Police walks the defendant in; the defendant takes the dock. */
function escortSequence() {
  store().setCourtState('PRE_SESSION')
  playSequence([
    { at: 0, run: () => cut(cameraForRole('police')) },
    { at: 100, role: 'police', action: 'ESCORT' },
    { at: 100, role: 'defendant', action: 'STAND' },
    { at: 3200, role: 'police', action: 'IDLE_STANDING' },
    { at: 3200, role: 'defendant', action: 'SIT' },
    { at: 4400, run: () => cut('CAMERA_WIDE') },
  ])
}

/** Clerk calls the witness; the witness takes the box and is sworn in. */
function callWitnessSequence({ text }) {
  store().setCourtState('DIRECT_EXAMINATION')
  playSequence([
    { at: 0, run: () => cut(cameraForRole('clerk')) },
    { at: 100, role: 'clerk', action: 'SPEAK' },
    { at: 150, run: () => speak('clerk', text || 'The court calls its next witness.') },
    { at: 1800, run: () => cut(cameraForRole('witness'), 'witness') },
    { at: 1900, role: 'witness', action: 'NOD' },
    { at: 3200, role: 'clerk', action: 'WRITE' },
    { at: 3400, role: 'witness', action: 'IDLE' },
  ])
}

// --- main dispatcher ---------------------------------------------------------

export function applyCourtEvent(raw) {
  const e = normalizeEvent(raw)
  store().pushEvent(e)

  if (ENGINE_TYPES.has(e.type)) engineDriven = true

  if (e.agent && !isKnownAgent(e.agent)) {
    console.warn(`[courtEvents] unknown agent "${e.agent}"`, e)
  }

  switch (e.type) {
    case EVENT_TYPES.COURT_EVENT: {
      renderCourtEvent(e)
      break
    }

    case EVENT_TYPES.STREAM_START: {
      streamStart(e)
      break
    }

    case EVENT_TYPES.STREAM_TOKEN: {
      streamToken(e)
      break
    }

    case EVENT_TYPES.STREAM_PAUSE: {
      streamPause(e)
      break
    }

    case EVENT_TYPES.STREAM_RESUME: {
      streamResume(e)
      break
    }

    case EVENT_TYPES.STREAM_END: {
      streamEnd(e)
      break
    }

    case EVENT_TYPES.HUMAN_ROLE: {
      humanRole(e)
      break
    }

    case EVENT_TYPES.YOUR_TURN: {
      yourTurn(e)
      break
    }

    case EVENT_TYPES.YOUR_TURN_END: {
      yourTurnEnd(e)
      break
    }

    case EVENT_TYPES.ANIMATION: {
      if (!e.agent || !e.animation) break
      cut(e.camera, e.agent)
      playAnimation(e.agent, logicalAction(e.agent, e.animation), {
        timeScale: e.raw?.timeScale,
        autoReturn: e.raw?.autoReturn,
      })
      break
    }

    case EVENT_TYPES.DIALOGUE: {
      if (e.agent) {
        cut(e.camera || cameraForRole(e.agent), e.agent)
        playAnimation(e.agent, logicalAction(e.agent, e.animation || 'SPEAK'))
        speak(e.agent, e.text || '')
      }
      break
    }

    case EVENT_TYPES.CAMERA: {
      cut(e.camera)
      break
    }

    case EVENT_TYPES.STATE: {
      // The AI engine sends the phase as a string plus its whole snapshot; the
      // legacy engine sends only a snapshot, whose `phase` is its own vocabulary
      // and does not belong in the courtroom HUD.
      if (e.court) store().setCourt(e.court)
      if (e.state && e.stateIsPhase) store().setCourtState(e.state)
      // Who the court is examining. The engine names the role and nothing more;
      // walking that person into the box, and walking the last one out, is the
      // room's business — see state/witnessStand.js.
      if (e.court?.state) setStandOccupant(e.court.state.activeWitnessRole || null)
      // Catch-up for a client that connected mid-session: the snapshot carries the
      // seat and any question still open. Only ever adds — a stale snapshot must
      // not close a question that a live YOUR_TURN opened.
      if (e.court?.human) {
        const seat = e.court.human
        const held = store().human
        if (seat.role !== held.role) {
          store().setHumanSeat({ role: seat.role, label: seat.label, seats: seat.seats })
        }
        if (seat.waiting && seat.prompt && !held.waiting) store().setHumanPrompt(seat.prompt)
      }
      break
    }

    case EVENT_TYPES.ERROR: {
      console.warn(`[courtEvents] engine error: ${e.message || 'unknown'}`, e)
      // Refusals of a human move come back this way ("The court is not waiting on
      // you", a seat that is not playable). Shown to the person as sent.
      store().setHumanError(e.message)
      break
    }

    case EVENT_TYPES.EVENT: {
      switch (e.event) {
        case NAMED_EVENTS.SHOW_EVIDENCE:
          if (engineDriven) {
            // The engine sends this alongside a COURT_EVENT that already carries
            // the camera, the animation and counsel's actual words, so all that is
            // wanted here is the monitor.
            store().showEvidence({ id: e.evidence, ...getExhibit(e.evidence) })
            cut(e.camera || 'CAMERA_EVIDENCE')
          } else {
            showEvidenceSequence({
              agent: e.agent || 'prosecutor', evidence: e.evidence, camera: e.camera,
            })
          }
          break
        case NAMED_EVENTS.HIDE_EVIDENCE:
          store().hideEvidence()
          cut(e.camera || 'CAMERA_WIDE')
          break
        case NAMED_EVENTS.OBJECTION:
          if (engineDriven) renderCourtEvent(e)
          else objectionSequence({ agent: e.agent || 'prosecutor', text: e.text, ruling: e.ruling })
          break
        case NAMED_EVENTS.SUSTAINED:
        case NAMED_EVENTS.OVERRULED:
          cut(e.camera || cameraForRole('judge'))
          playAnimation('judge', 'GAVEL')
          // The bench has already ruled — this is only the picture of it. If the
          // producer sent no words, the gavel speaks for itself; putting a line in
          // the judge's mouth from here would be this file doing the ruling.
          if (e.text) speak('judge', e.text)
          break
        case NAMED_EVENTS.GAVEL:
          cut(e.camera || cameraForRole('judge'))
          playAnimation('judge', 'GAVEL')
          break
        case NAMED_EVENTS.CALL_WITNESS:
        case NAMED_EVENTS.SWEAR_IN_WITNESS:
          if (engineDriven) renderCourtEvent(e)
          else callWitnessSequence({ text: e.text })
          break
        case NAMED_EVENTS.ESCORT_DEFENDANT:
          escortSequence()
          break
        case NAMED_EVENTS.RECESS:
          store().setCourtState('RECESS')
          cancelSequence()
          cut('CAMERA_WIDE')
          break
        case NAMED_EVENTS.VERDICT:
          store().setCourtState('VERDICT')
          cut(cameraForRole('judge'))
          playAnimation('judge', 'SPEAK')
          if (e.text) speak('judge', e.text)
          break
        case NAMED_EVENTS.RESET:
          resetCourtroom()
          break
        default:
          // The legacy engine puts its own event vocabulary here (OBJECTION,
          // RULING, TESTIMONY...). In engine mode anything unrecognised is still
          // renderable as long as it names an agent and an animation.
          if (e.agent && e.animation) renderCourtEvent(e)
          else console.warn(`[courtEvents] unhandled EVENT "${e.event}"`, e)
      }
      break
    }

    default:
      console.warn(`[courtEvents] unhandled type "${e.type}"`, e)
  }

  return e
}

/** Everyone back to their opening positions and poses. */
export function resetCourtroom() {
  cancelSequence()
  resetDialogueState()
  engineDriven = false
  const s = store()
  s.hideEvidence()
  s.setCamera('CAMERA_WIDE')
  s.setCourtState('PRE_SESSION')
  s.setCourt(null)
  s.setDialogue({ speaker: null, text: '', paused: false, streaming: false })
  // The engine releases the seat on RESET too, so the choice is offered again.
  s.resetHuman()
  s.closeTranscript()
  // The box goes back to the witness, and anyone who was called out of their own
  // seat walks back to it.
  resetStand()
  playAnimation('judge', 'IDLE')
  playAnimation('clerk', 'IDLE_SITTING')
  playAnimation('prosecutor', 'IDLE_SITTING')
  playAnimation('defense', 'IDLE_SITTING')
  playAnimation('witness', 'IDLE')
  playAnimation('defendant', 'IDLE_SITTING')
  playAnimation('police', 'IDLE_STANDING')
}

export const SEQUENCES = {
  objectionSequence,
  showEvidenceSequence,
  escortSequence,
  callWitnessSequence,
}

if (typeof window !== 'undefined') {
  window.courtEvents = {
    applyCourtEvent, resetCourtroom, SEQUENCES, isEngineDriven, setEngineDriven,
  }
}
