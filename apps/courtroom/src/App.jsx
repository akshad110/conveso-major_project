/**
 * The whole application, which is deliberately almost nothing.
 *
 * Every panel here subscribes to the store itself, so App does not pass data
 * around — it decides what is on screen and in what order, and nothing else. No
 * courtroom rule lives in this file: the engine says what happened, the store
 * holds it, and each panel reads the part it cares about.
 *
 * The one piece of sequencing App does own is the two cutscenes, because they
 * are the only thing that has to sit on top of everything else and know where
 * the trial is.
 *
 * Launched from a Converso lesson, App owns one more piece of sequencing: the
 * scene does not mount until the launch handshake has landed. The session says
 * which characters this case needs, and a Canvas that has already mounted has
 * already started downloading the ones it does not. `useLaunchedSession` does
 * all of that; App's whole contribution is the `ready` gate below.
 *
 * With no `?session=&token=` in the URL none of this applies: `launched` is
 * false, `ready` is true on the first render, and the file behaves exactly as it
 * did before any of it existed.
 */
import { useCallback, useState, useEffect, useRef } from 'react'
import CourtroomScene from './three/CourtroomScene'
import { disposeCourtroom } from './three/dispose'
import ControlPanel from './debug/ControlPanel'
import useDebugControls from './debug/useDebugControls'
import { useLaunchedSession } from './session/useLaunchedSession'
import { useCourtSocket } from './state/useCourtSocket'
import { useCourtStore } from './state/useCourtStore'
import DialogueBar from './ui/DialogueBar'
import ConnectionNotice from './ui/ConnectionNotice'
import LaunchGate from './ui/LaunchGate'
import LoadingScreen from './ui/LoadingScreen'
import RoleSelect from './ui/RoleSelect'
import TurnPanel from './ui/TurnPanel'
import TranscriptPanel from './ui/TranscriptPanel'
import Cutscene from './ui/Cutscene'

export default function App() {
  const [showControls, setShowControls] = useState(false)
  /**
   * Which cutscene is on screen: 'opening', 'closing', or null for none.
   *
   * The opening plays first and covers the seat-selection screen underneath it,
   * which is the right way round — you should know what the case is before you
   * choose who to be in it. Nothing is lost by covering that screen because the
   * socket holds the court closed until a seat is taken.
   */
  const [cutscene, setCutscene] = useState(null)
  /**
   * The closing plays once. A ref rather than state because the trial can report
   * CASE_CLOSED more than once — every STATE message after the verdict carries
   * it — and a second showing after the player has skipped past the first would
   * be a bug, not a feature.
   */
  const closingPlayed = useRef(false)
  const toggleControls = useCallback(() => setShowControls((v) => !v), [])

  const waiting = useCourtStore((s) => s.human.waiting)
  const seatLabel = useCourtStore((s) => s.human.label)
  /* Read only so the seat tag can wear the suite's colour for this role. The
     seven registry ids are the pack's seven [data-seat] values. */
  const seatRole = useCourtStore((s) => s.human.role)
  const transcriptOpen = useCourtStore((s) => s.transcriptOpen)
  const clerkHover = useCourtStore((s) => s.clerkHover)
  const phase = useCourtStore((s) => s.court?.phase)
  const startDismissed = useCourtStore((s) => s.human.startDismissed)

  useEffect(() => {
    if (phase !== 'CASE_CLOSED' || closingPlayed.current) return
    closingPlayed.current = true
    setCutscene('closing')
  }, [phase])

  useCourtSocket()

  /**
   * Handing the room back when this app goes away.
   *
   * Placed here, above the Canvas, because React runs a parent's cleanup before
   * it detaches the children — so at this moment the scene still contains
   * everything that needs freeing. A component inside the Canvas would run too
   * late and find an empty scene. See three/dispose.js for what is freed and,
   * more importantly, what is left to R3F.
   */
  useEffect(() => () => { disposeCourtroom() }, [])

  /**
   * The lesson this hearing belongs to, if there is one.
   *
   * Called unconditionally and before the gate returns, because it is a hook —
   * and because the handshake it starts has to be in flight while the gate is on
   * screen, not after it comes off.
   */
  const session = useLaunchedSession()

  // A developer's keyboard, for a developer's courtroom. See the hook.
  useDebugControls({ onToggleOverlay: toggleControls, enabled: !session.launched })

  /*
   * The gate, and the early return that makes the cast load-bearing.
   *
   * Returning before `<CourtroomScene />` is the point: the alternative is
   * rendering the room and narrowing the cast afterwards, which narrows nothing
   * because the fetches are already away. Everything else in the tree is cheap
   * to delay by the length of one fetch to Converso.
   */
  if (!session.ready) {
    return (
      <div className="app" data-controls="closed" data-turn="closed" data-record="closed">
        <LaunchGate
          mode={session.mode}
          refusal={session.refusal}
          canRetry={session.canRetry}
          onRetry={session.retry}
          onReturn={session.returnToLesson}
        />
      </div>
    )
  }

  return (
    <div
      className="app"
      data-controls={showControls ? 'open' : 'closed'}
      data-turn={waiting ? 'open' : 'closed'}
      data-record={transcriptOpen ? 'open' : 'closed'}
      data-launched={session.launched ? 'yes' : 'no'}
    >
      {/* Above everything, including the seat-selection screen. */}
      {cutscene ? (
        <Cutscene
          key={cutscene}
          type={cutscene}
          onComplete={() => setCutscene(null)}
        />
      ) : null}

      <CourtroomScene />
      <DialogueBar />

      {/* Over the room, never instead of it. See the component. */}
      <ConnectionNotice />

      {/*
        * The seat screen asks which seat you want. A launched hearing has
        * already been asked that in the lesson and answered on the session row,
        * so asking again would be this app overruling Converso — and a student
        * could answer differently from the seat they are being graded in. The
        * hook dismisses it; this keeps it out of the tree entirely.
        *
        * Nothing about RoleSelect itself changed. It is simply not on screen.
        */}
      {session.launched ? null : <RoleSelect />}

      <TurnPanel />
      <TranscriptPanel />

      {seatLabel && !waiting ? (
        <div className="seat-tag" data-seat={seatRole || undefined}>
          <span>You are</span>
          {seatLabel}
        </div>
      ) : null}

      {/* The clerk is the way into the record, so say so when pointed at. */}
      {clerkHover && !transcriptOpen ? (
        <div className="pick-hint">Court session transcript</div>
      ) : null}

      {/*
        * The debug panel is a developer's tool: it drives characters and clips
        * directly, which is exactly what a student being graded should not have.
        * Standalone keeps it, and keeps the H key.
        */}
      {session.launched || !startDismissed ? null : showControls ? (
        <ControlPanel onClose={toggleControls} />
      ) : (
        <button className="cp-launch grain" onClick={toggleControls} title="Open controls (H)">
          <span className="cp-launch-mark" aria-hidden="true" />
          Controls
          <span className="cp-launch-key">H</span>
        </button>
      )}
      <LoadingScreen />
    </div>
  )
}
