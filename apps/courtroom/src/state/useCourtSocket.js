/**
 * WebSocket client for the AI engine.
 *
 * Defaults to the engine's own address (ws://127.0.0.1:4177 — see
 * courtroom-simulation-engine/server/index.js), so starting the engine and
 * starting the app is all it takes. If nothing is listening the retry backoff
 * simply keeps trying and the connection pill reads "offline"; the courtroom, the
 * keyboard controls and the mock feed all work regardless.
 *
 * Override with VITE_COURT_WS_URL, or set it to "off" to stay disconnected.
 *
 * Nothing else in the app cares whether events arrive from a socket or from the
 * local mock feed — both funnel through applyCourtEvent, which is the whole point
 * of the seam.
 *
 * A drop is handled as a pause, not as a reset. The scene is never rebuilt: the
 * Canvas has no dependency on this hook, and remounting it over a network blip
 * would mean re-downloading 105 MB of room to recover from something that is
 * usually over in a second. What happens instead is that the presentation is
 * parked (see holdPresentation in courtEvents.js) and the engine's own snapshot
 * — which the server sends as the first two messages on every connection —
 * restores the record when the socket returns.
 */
import { useEffect, useRef } from 'react'
import { applyCourtEvent, holdPresentation, releasePresentation } from './courtEvents'
import { useCourtStore } from './useCourtStore'

const ENGINE_URL = 'ws://127.0.0.1:4177'
/** The hearing process. The 3D site and the classroom are not this. */
const PRODUCTION_ENGINE = 'wss://courtroom-engine.onrender.com'
const NOT_THE_ENGINE = new Set([
  'conveso-major-project.onrender.com',
  'conveso-major-project-1.onrender.com',
  'conveso-major-project-2.onrender.com',
])
const OFF = /^(off|none|false|0|disabled)$/i

function configuredUrl() {
  const configured = import.meta.env?.VITE_COURT_WS_URL
  const pageHost = typeof window !== 'undefined' ? window.location.hostname : ''
  const deployed = pageHost.endsWith('.onrender.com')
  if (configured === undefined || configured === '') {
    return deployed ? PRODUCTION_ENGINE : ENGINE_URL
  }
  const raw = String(configured).trim()
  if (OFF.test(raw)) return null

  // A site URL pasted into the socket setting becomes wss://https//host and
  // the browser refuses it. Peel every stacked scheme, then keep the host.
  let rest = raw
  for (let i = 0; i < 4; i++) {
    const next = rest
      .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
      .replace(/^[a-z][a-z0-9+.-]*\/\//i, '')
    if (next === rest) break
    rest = next
  }
  const host = rest.replace(/^\/+/, '').split(/[/?#]/)[0]
  const bare = (host || '').split(':')[0]
  const local = !bare || bare.startsWith('localhost') || bare.startsWith('127.0.0.1')
  // A missing setting, or the classroom / LMS address pasted in by mistake,
  // leaves this room as a model with no hearing. On Render, use the engine.
  if (deployed && (local || NOT_THE_ENGINE.has(bare))) return PRODUCTION_ENGINE
  if (!host) return deployed ? PRODUCTION_ENGINE : ENGINE_URL
  return `${local ? 'ws' : 'wss'}://${host}`
}

const DEFAULT_URL = configuredUrl()
const RETRY_MS = [1000, 2000, 4000, 8000, 15000]

let socket = null

/** Send a message back to the engine (START, PAUSE, RESUME, STEP, DISPATCH...). */
export function sendCourtCommand(payload) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    console.warn('[courtSocket] not connected; dropping', payload)
    return false
  }
  socket.send(typeof payload === 'string' ? payload : JSON.stringify(payload))
  return true
}

export function isCourtSocketOpen() {
  return Boolean(socket && socket.readyState === WebSocket.OPEN)
}

export function useCourtSocket({ url = DEFAULT_URL, enabled = true } = {}) {
  const attempt = useRef(0)
  const closed = useRef(false)
  /**
   * Whether the presentation is currently parked.
   *
   * Tracked here rather than read back off the store because the store's
   * `connection` passes through 'connecting' and 'error' on the way round, and
   * parking an already-parked court would re-park a line that the first drop
   * already dealt with.
   */
  const held = useRef(false)

  useEffect(() => {
    const store = useCourtStore.getState()
    const setConnection = store.setConnection
    const setReconnect = store.setReconnect

    /**
     * Park the court, once per outage.
     *
     * Only if there is something to park: before the first connection there is
     * no hearing on screen, and a courtroom opened with no engine running at all
     * would otherwise start life behind a "reconnecting" notice, which is not
     * what is happening — nothing has been lost, because nothing had begun.
     */
    const hold = () => {
      if (held.current || !useCourtStore.getState().court) return
      held.current = true
      holdPresentation()
    }

    const release = () => {
      if (!held.current) return
      held.current = false
      releasePresentation()
    }

    if (!url || !enabled) {
      setConnection('offline')
      setReconnect({ attempt: 0, at: null })
      return undefined
    }

    closed.current = false
    let timer = null

    const connect = () => {
      if (closed.current) return
      setConnection('connecting')
      let ws
      try {
        ws = new WebSocket(url)
      } catch (err) {
        console.warn('[courtSocket] could not open', err)
        setConnection('error')
        hold()
        schedule()
        return
      }
      socket = ws

      ws.onopen = () => {
        attempt.current = 0
        setConnection('open')
        setReconnect({ attempt: 0, at: null })
        // "Wait for me." This client offers a seat at the table before the first
        // turn is taken, so the court must not open while somebody is still
        // choosing one. The engine holds indefinitely once it hears this; a client
        // that never sends it (the engine's own plain browser page) autostarts as
        // before. Sent on every connect, including a reconnect, because the server
        // is the one keeping the flag.
        try {
          ws.send(JSON.stringify({ type: 'HOLD' }))
        } catch (err) {
          console.warn('[courtSocket] could not hold the court', err)
        }
        // After HOLD, so the court is not opening while the screen catches up.
        // The server's first two messages are the full snapshot, so by the time
        // anything is visible again it is the engine's version of events.
        release()
      }
      ws.onmessage = (msg) => {
        applyCourtEvent(msg.data)
      }
      ws.onerror = () => setConnection('error')
      ws.onclose = () => {
        if (socket === ws) socket = null
        if (closed.current) return
        setConnection('offline')
        hold()
        schedule()
      }
    }

    const schedule = () => {
      const delay = RETRY_MS[Math.min(attempt.current, RETRY_MS.length - 1)]
      attempt.current += 1
      // So the notice can say when, rather than saying "soon" and hoping.
      setReconnect({ attempt: attempt.current, at: Date.now() + delay })
      timer = setTimeout(connect, delay)
    }

    connect()

    return () => {
      closed.current = true
      if (timer) clearTimeout(timer)
      if (socket) {
        socket.onclose = null
        socket.close()
        socket = null
      }
      // Leaving is not an outage. Releasing here stops a court that was parked
      // by a drop from being left parked in a store that outlives this hook.
      release()
      setConnection('offline')
      setReconnect({ attempt: 0, at: null })
    }
  }, [url, enabled])
}
