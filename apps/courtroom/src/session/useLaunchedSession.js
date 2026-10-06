/**
 * Joining a hearing to the lesson that launched it.
 *
 * This is the only file in the courtroom that knows Converso exists. Everything
 * it does happens in a fixed order, and the order is the whole design:
 *
 *   1. exchange the token for the session          (launch.js)
 *   2. pin the cast from the session's config      (characterRegistry.js)
 *   3. let the scene mount
 *   4. take the seat Converso sold                 (SET_HUMAN_ROLE + START)
 *   5. bookmark where the student is, periodically (/progress)
 *   6. report counts when the court closes         (/complete)
 *   7. beacon an abandonment if they leave first   (/abandon)
 *
 * Steps 1 and 2 must both finish before step 3, because the cast decides which
 * GLB files get downloaded and a Canvas that has already mounted has already
 * started fetching them. That is why `App` gates the scene on this hook rather
 * than rendering the room and configuring it afterwards.
 *
 * Nothing here decides anything about the trial. The seat is the one Converso
 * stamped on the session row, the two commands sent are the same two the seat
 * screen sends, and the result is derived from the engine's own record. This
 * file's entire contribution is *when*.
 *
 * Standalone is untouched. With no `?session=&token=` in the URL, `isLaunched`
 * is false, every branch below returns early, and the courtroom behaves exactly
 * as it did before any of this existed — the engine's own case, the seat screen,
 * the debug panel.
 */
import { useCallback, useEffect, useRef } from 'react'
import { FRAME_MESSAGES, FRAME_SOURCE, SIMULATION_KIND } from '@converso/contracts'
import {
  isLaunched,
  openLaunchSession,
  reportAbandoned,
  reportComplete,
  reportProgress,
  launchTarget,
} from './launch'
import { deriveCourtroomOutcome, deriveCourtroomProgress } from './outcome'
import { useSessionStore } from './useSessionStore'
import { applySceneConfiguration, resetSceneConfiguration } from '../config/characterRegistry'
import { sendCourtCommand } from '../state/useCourtSocket'
import { useCourtStore } from '../state/useCourtStore'

const PHASE_CASE_CLOSED = 'CASE_CLOSED'

/**
 * Which refusals are worth a Retry button.
 *
 * A launch token is single-use and spent on the first exchange, so retrying an
 * expired or already-spent one cannot work — offering the button would be
 * telling the student something untrue about their own session. Only a Converso
 * that did not answer is worth asking twice.
 */
const RETRYABLE = new Set(['UNAVAILABLE'])

export function useLaunchedSession() {
  const mode = useSessionStore((s) => s.mode)
  const role = useSessionStore((s) => s.role)
  const refusal = useSessionStore((s) => s.refusal)
  const sessionCaseId = useSessionStore((s) => s.caseId)

  const connection = useCourtStore((s) => s.connection)
  const phase = useCourtStore((s) => s.court?.phase)
  const courtCaseId = useCourtStore((s) => s.court?.case?.id)

  /** Guards for the three things that must happen exactly once. */
  const handshake = useRef(false)
  const seated = useRef(false)
  const reported = useRef(false)

  /* --- 1 and 2: the handshake, and the cast ------------------------------- */

  const attempt = useCallback(async () => {
    const { beginLaunch, openSession, refuse } = useSessionStore.getState()
    beginLaunch()

    const result = await openLaunchSession()
    if (!result.ok) {
      refuse({ code: result.code, message: result.message })
      return
    }

    // Before the scene mounts, so the room downloads this case's cast and not
    // the whole registry. An unknown name in the column costs that character
    // and is reported here rather than thrown.
    const applied = applySceneConfiguration(result.simulation?.configuration ?? {})
    if (applied.ignored.length) {
      console.warn(
        '[session] configuration named characters the registry does not have:',
        applied.ignored.join(', '),
      )
    }

    openSession(result)
  }, [])

  useEffect(() => {
    if (!isLaunched || handshake.current) return
    handshake.current = true
    void attempt()
  }, [attempt])

  /** Ask again. Only offered for a Converso that did not answer. */
  const retry = useCallback(() => {
    if (!RETRYABLE.has(refusal?.code)) return
    void attempt()
  }, [attempt, refusal])

  /**
   * Hand the student back to the lesson.
   *
   * This app is in an iframe on a Converso page and has no idea which lesson
   * opened it, so it cannot navigate anywhere useful on its own — it asks the
   * page that framed it to take the panel back. Targeted at the configured
   * Converso origin rather than '*', because a message sent to '*' is a message
   * readable by whoever framed this instead.
   *
   * Both strings come from the contract rather than being written here. The
   * host recognises a scene by its tag, and while each side kept its own copy
   * of that tag, editing one of them broke the button silently.
   */
  const returnToLesson = useCallback(() => {
    if (!window.parent || window.parent === window) {
      if (launchTarget) window.location.assign(launchTarget)
      return
    }
    try {
      window.parent?.postMessage(
        {
          source: FRAME_SOURCE[SIMULATION_KIND.COURTROOM],
          type: FRAME_MESSAGES.RETURN_TO_LESSON,
        },
        launchTarget,
      )
    } catch {
      /* not framed, or a hostile parent. Nothing useful to do either way. */
    }
  }, [launchTarget])

  /* --- 4: taking the seat Converso sold ---------------------------------- */

  useEffect(() => {
    if (mode !== 'open' || seated.current) return
    // The engine has to hear this before the first turn is taken, and it cannot
    // hear anything until the socket is up. The socket says HOLD on connect, so
    // the court waits here for as long as this takes.
    if (connection !== 'open') return

    seated.current = true

    // Exactly the two commands the seat screen sends, in the same order. A role
    // of null is a student who was sold a seat in the gallery: the court still
    // has to be released, so START goes either way.
    if (role) sendCourtCommand({ type: 'SET_HUMAN_ROLE', role })
    sendCourtCommand({ type: 'START' })

    // Keeps the seat screen out of the way. Converso already asked which seat
    // they wanted, and asking twice would be the second question this app has
    // no business asking.
    useCourtStore.getState().dismissStart()
  }, [mode, connection, role])

  /* --- the case the engine is actually running --------------------------- */

  useEffect(() => {
    if (mode !== 'open' || !sessionCaseId || !courtCaseId) return
    if (sessionCaseId === courtCaseId) return
    // Worth saying out loud rather than scoring quietly. The engine's case is
    // fixed by COURT_CASE when the server starts and there is no command to
    // change it, so a lesson pointing at a different case gets the hearing the
    // engine was started with. Silently grading that as the requested case is
    // the failure this warning exists to prevent.
    console.warn(
      `[session] this lesson asked for "${sessionCaseId}" but the engine is running ` +
        `"${courtCaseId}". Start the engine with COURT_CASE=${sessionCaseId}.`,
    )
  }, [mode, sessionCaseId, courtCaseId])

  /* --- 5: the bookmark ---------------------------------------------------- */

  useEffect(() => {
    if (mode !== 'open') return undefined

    // Subscribed rather than read through a selector because the snapshot
    // changes on every turn and re-rendering App for a bookmark would be a
    // re-render for something nobody can see. `reportProgress` throttles to one
    // call every 15 seconds, so this fires far more often than it sends.
    const unsubscribe = useCourtStore.subscribe((state, previous) => {
      if (state.court === previous?.court) return
      const seat = useSessionStore.getState().role
      reportProgress(deriveCourtroomProgress({ court: state.court, role: seat }))
    })

    return unsubscribe
  }, [mode])

  /* --- 6: the result ----------------------------------------------------- */

  useEffect(() => {
    if (mode !== 'open' || reported.current) return
    if (phase !== PHASE_CASE_CLOSED) return

    // Once. The engine repeats CASE_CLOSED on every STATE message after the
    // verdict, and `reportComplete` guards against a second send as well — two
    // locks on the same door, because a duplicate result is the one mistake
    // here a student would actually notice.
    reported.current = true

    const court = useCourtStore.getState().court
    const seat = useSessionStore.getState().role
    const outcome = deriveCourtroomOutcome({ court, role: seat })

    // A final bookmark first, so a `/complete` that fails still leaves Converso
    // knowing the hearing reached its end.
    reportProgress(deriveCourtroomProgress({ court, role: seat }), { force: true })

    void reportComplete(outcome).then((stored) => {
      // What comes back is Converso's own arithmetic, including the score it
      // worked out from these counts. Null means the call failed, which is not
      // the student's problem to solve and not worth a dialog: the session is
      // still open server-side and the abandon beacon will close it.
      useSessionStore.getState().markReported(stored)
    })
  }, [mode, phase])

  /* --- 7: leaving early --------------------------------------------------- */

  useEffect(() => {
    if (!isLaunched) return undefined

    // `pagehide` rather than `beforeunload`: it fires for a tab being discarded
    // and for a page going into the back-forward cache, which `beforeunload`
    // does not, and it does not block the unload.
    const leave = () => reportAbandoned()
    window.addEventListener('pagehide', leave)

    return () => {
      window.removeEventListener('pagehide', leave)
      // An unmount that is not a page unload — Converso swapping the panel out
      // — still ends the hearing, and the cast belongs to the session that is
      // ending rather than to the next one.
      reportAbandoned()
      resetSceneConfiguration()
    }
  }, [])

  return {
    /** False for a standalone courtroom: App should render the room immediately. */
    launched: isLaunched,
    mode,
    role,
    refusal,
    canRetry: RETRYABLE.has(refusal?.code),
    retry,
    returnToLesson,
    /**
     * True once it is safe to mount the Canvas.
     *
     * A standalone courtroom is always ready. A launched one waits for the
     * handshake, because the cast is not known until it lands.
     */
    ready: !isLaunched || mode === 'open' || mode === 'finished',
  }
}
