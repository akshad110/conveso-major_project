import { useEffect, useState } from 'react'
import { useCourtStore } from '../state/useCourtStore'

/**
 * The court has gone quiet.
 *
 * Shown only once a hearing has begun. Before that, `court` is null and a
 * courtroom with no engine running is not a courtroom that lost its engine —
 * it is the standalone room, which works, and telling a developer it was
 * disconnected from something it never asked for would be noise.
 *
 * It says what is happening and what is not lost, in that order, because the
 * second part is the part a student sitting in front of a frozen courtroom
 * actually wants: the record is the engine's and it survives this. The scene
 * stays exactly where it is behind this panel — nothing unmounts, nothing
 * re-downloads, and when the socket returns the engine's own snapshot is what
 * puts the court back on screen.
 *
 * There is no Retry button. The socket is already retrying on a backoff and a
 * button that raced it would only ever make the outage longer.
 */

const GRACE_MS = 1200

export default function ConnectionNotice() {
  const connection = useCourtStore((s) => s.connection)
  const reconnect = useCourtStore((s) => s.reconnect)
  const started = useCourtStore((s) => Boolean(s.court))

  const down = started && connection !== 'open' && connection !== 'mock'

  /**
   * A short grace period before saying anything.
   *
   * Most drops are over inside a second — a laptop lid, a Wi-Fi handover, the
   * engine restarting on a file save during development. A panel that appears
   * and vanishes for every one of those is worse than no panel, because it
   * trains a student to ignore it by the time it means something.
   */
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    if (!down) {
      setVisible(false)
      return undefined
    }
    const timer = setTimeout(() => setVisible(true), GRACE_MS)
    return () => clearTimeout(timer)
  }, [down])

  /** A countdown has to tick, and nothing else in the store changes each second. */
  const [, tick] = useState(0)
  useEffect(() => {
    if (!visible || !reconnect?.at) return undefined
    const timer = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(timer)
  }, [visible, reconnect?.at])

  if (!visible) return null

  const seconds = reconnect?.at ? Math.max(0, Math.ceil((reconnect.at - Date.now()) / 1000)) : null

  const status =
    connection === 'connecting'
      ? 'Reconnecting'
      : seconds === null
        ? 'Reconnecting'
        : seconds > 0
          ? `Trying again in ${seconds}s`
          : 'Trying again'

  return (
    <div className="quiet" role="status" aria-live="polite">
      <div className="quiet-inner">
        <span className="quiet-mark" aria-hidden="true" />
        <div>
          <div className="quiet-title">The court has gone quiet</div>
          <div className="quiet-body">
            The connection to the engine dropped. Nothing you have done is lost — the
            record is kept by the court and comes back with the connection.
          </div>
        </div>
        <div className="quiet-status">
          {status}
          {reconnect?.attempt ? <span className="quiet-attempt">attempt {reconnect.attempt}</span> : null}
        </div>
      </div>
    </div>
  )
}
