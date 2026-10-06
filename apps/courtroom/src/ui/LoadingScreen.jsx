import { useEffect, useMemo, useRef, useState } from 'react'
import { useProgress } from '@react-three/drei'
import { activeRoles } from '../config/characterRegistry'
import { useCourtStore } from '../state/useCourtStore'

/**
 * Loading curtain. The courtroom GLB is ~105 MB, so this is load-bearing rather
 * than decorative — without it the first paint is a black screen for seconds.
 *
 * The five lines it shows are not a progress animation. Each one reads a signal
 * something in the app actually sets, which is why they can disagree with each
 * other: the room and every character sit behind their own Suspense boundary in
 * CourtroomScene, so they resolve independently and in whatever order the network
 * delivers them. A 105 MB room routinely finishes after a 7 MB prosecutor. The
 * list is drawn in the order a person would expect to read it and each line tells
 * its own truth, rather than a sequence being faked to look orderly.
 *
 *   Environment     `courtroomLoaded`, set by Courtroom.jsx once the room's
 *                   meshes have been walked and shadow flags applied.
 *   Characters      every role in this case's cast has left 'pending'.
 *   Animations      every role that loaded came with at least one clip. A GLB
 *                   can arrive intact and animate nothing, and that is worth
 *                   telling apart from a GLB that did not arrive.
 *   AI Connection   the socket to the engine.
 *   Ready           the four above, except one. See below.
 *
 * The curtain lifts on the assets alone and never waits for the engine. A
 * student should be looking at the courtroom while the connection is still being
 * made — the room is the thing that took 105 MB to fetch, and holding it behind
 * a socket would mean a black screen for as long as the engine takes to answer,
 * for no gain. The AI Connection line stays on the list because it is honest to
 * show what is still outstanding; it simply has no veto.
 */

/** Long enough that a slow connection is not cut off, short enough to be a rescue. */
const RESCUE_AFTER_MS = 12_000

export default function LoadingScreen() {
  const { active, progress, item, errors } = useProgress()

  const courtroomLoaded = useCourtStore((s) => s.courtroomLoaded)
  const characters = useCourtStore((s) => s.characters)
  const connection = useCourtStore((s) => s.connection)

  /**
   * The cast this hearing is actually mounting.
   *
   * Read once. It is module state pinned by the launch handshake before the
   * Canvas mounted, and re-reading it per frame would be re-deriving a constant.
   */
  const cast = useMemo(() => activeRoles(), [])

  const settled = cast.filter((role) => {
    const status = characters[role]?.status
    // 'missing' is a role with no model file, which is settled by definition.
    // 'error' is a fetch that failed. Neither will ever become 'ready', and a
    // curtain that waits for them waits forever.
    return status === 'ready' || status === 'missing' || status === 'error'
  })
  const loaded = cast.filter((role) => characters[role]?.status === 'ready')
  const animated = loaded.filter((role) => (characters[role]?.clips?.length ?? 0) > 0)

  const environmentDone = courtroomLoaded
  const charactersDone = settled.length === cast.length
  const animationsDone = charactersDone && animated.length === loaded.length
  const connectionDone = connection === 'open' || connection === 'mock'

  const assetsDone = environmentDone && charactersDone && animationsDone

  /**
   * The rescue.
   *
   * A GLB that 404s leaves its character on 'pending' and there is no event for
   * "this will never arrive" — drei counts an error but the Suspense boundary
   * simply never resolves. Without this, one missing file is a permanent
   * curtain, which is the worst possible way to report a missing file: the
   * student sees nothing at all and has nothing to say about it. So once the
   * loader has gone quiet and stayed quiet, the curtain lifts anyway. A room
   * with somebody missing from it is a room, and the console says who.
   */
  const [rescued, setRescued] = useState(false)
  const quietSince = useRef(null)

  useEffect(() => {
    if (assetsDone || active) {
      quietSince.current = null
      return undefined
    }
    // Nothing is in flight and the assets are still not done — either a fetch
    // failed or a boundary is stuck. Start counting.
    if (quietSince.current === null) quietSince.current = Date.now()
    const timer = setTimeout(() => setRescued(true), RESCUE_AFTER_MS)
    return () => clearTimeout(timer)
  }, [assetsDone, active])

  useEffect(() => {
    if (!rescued) return
    const missing = cast.filter((role) => characters[role]?.status === 'pending')
    console.warn(
      '[loading] lifting the curtain with the scene incomplete.' +
        (missing.length ? ` Never arrived: ${missing.join(', ')}.` : '') +
        (errors?.length ? ` Loader errors: ${errors.join(', ')}.` : ''),
    )
    // Once, on the transition. `characters` is deliberately not a dependency:
    // this is a report about the moment the curtain lifted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rescued])

  if (assetsDone || rescued) return null

  const stages = [
    { label: 'Environment', done: environmentDone, detail: 'the room' },
    {
      label: 'Characters',
      done: charactersDone,
      detail: `${settled.length} of ${cast.length}`,
    },
    {
      label: 'Animations',
      done: animationsDone,
      detail: animationsDone ? 'all clips read' : `${animated.length} of ${cast.length}`,
    },
    {
      label: 'AI Connection',
      done: connectionDone,
      // Said out loud, because a line that stays unticked while the curtain
      // lifts would otherwise look like something went wrong.
      detail: connectionDone ? connection : 'court opens without it',
    },
  ]

  return (
    <div className="loading">
      <div className="loading-inner">
        <div className="loading-rule" />
        <div className="loading-title">AI Courtroom Simulator</div>
        <div className="loading-sub">Court is assembling</div>
        <div className="loading-bar">
          <div className="loading-fill" style={{ width: `${Math.max(4, progress).toFixed(0)}%` }} />
        </div>

        <ul className="loading-stages">
          {stages.map((stage) => (
            <li
              key={stage.label}
              className="loading-stage"
              data-state={stage.done ? 'done' : 'waiting'}
            >
              <span className="loading-stage-mark" aria-hidden="true" />
              <span className="loading-stage-label">{stage.label}</span>
              <span className="loading-stage-detail">{stage.detail}</span>
            </li>
          ))}
        </ul>

        <div className="loading-meta">
          {progress.toFixed(0)}% · {String(item || '').split('/').pop() || 'preparing the room'}
        </div>
      </div>
    </div>
  )
}
