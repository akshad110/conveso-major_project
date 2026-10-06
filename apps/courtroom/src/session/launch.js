/**
 * The launch handshake.
 *
 * A courtroom can be opened two ways, and this file is the difference between
 * them.
 *
 *   standalone   `npm run dev`, no query string. Nothing here runs. The app
 *                behaves exactly as it did before any of this existed: the
 *                engine's own case, the seat screen, the debug panel.
 *
 *   launched     opened by Converso with `?session=<uuid>&token=<v1...>`. The
 *                token is a signed, two-minute claim about who this student is.
 *                It is exchanged once for the session, and from then on it is
 *                the only credential this app holds.
 *
 * There is no login here and there must never be one. This app has no database
 * key, no Supabase URL and no Clerk secret — it has a token that Converso minted
 * and Converso will check again on every call. Everything it knows about the
 * student it learned from the exchange.
 *
 * The token is deliberately short-lived and single-use. Converso spends it on the
 * first exchange; a second attempt with the same token is a replay and is
 * refused. That is why a reload of a launched courtroom does not work and should
 * not: the student goes back to the lesson page and presses Start, which mints a
 * new one.
 */
import { LAUNCH_ERRORS, LAUNCH_ERROR_TEXT, SIMULATION_KIND } from '@converso/contracts'

/* --- where the query string came from ------------------------------------- */

const params = new URLSearchParams(window.location.search)

const SESSION_ID = params.get('session') || ''
const TOKEN = params.get('token') || ''

/** True when Converso opened this page. False for `npm run dev`. */
export const isLaunched = Boolean(SESSION_ID && TOKEN)

export const launchSessionId = SESSION_ID

/**
 * Which Converso to call back.
 *
 * An explicit build-time variable wins, and that ordering is the security of the
 * whole arrangement: if the origin were read out of the query string, a page
 * that framed this app could name its own server and be handed the student's
 * launch token. `VITE_CONVERSO_URL` cannot be rewritten by whoever opened the
 * iframe.
 *
 * The referrer is a fallback for the ordinary case where the two apps are served
 * from the same host in development and nobody has set anything. It is only
 * consulted when the variable is absent, and only its origin is used.
 */
function conversoOrigin() {
  const configured = import.meta.env?.VITE_CONVERSO_URL
  if (configured) return String(configured).replace(/\/+$/, '')

  if (document.referrer) {
    try {
      return new URL(document.referrer).origin
    } catch {
      /* not a URL; fall through */
    }
  }
  return window.location.origin
}

const ORIGIN = conversoOrigin()

/* --- calling home --------------------------------------------------------- */

const authHeaders = () => ({
  // The route accepts this header, `x-launch-token`, or `?token=`. A header is
  // the right one for a fetch: it stays out of logs and out of the address bar.
  authorization: `Bearer ${TOKEN}`,
  'content-type': 'application/json',
})

/**
 * Take the token out of the address bar.
 *
 * It has already been spent by the time this runs, so this is not what makes it
 * single-use — Converso's own `launch_jti` column does that. It is here because
 * a credential in a visible URL ends up in screenshots, in shared links and in
 * the back-forward history of a shared machine, and none of those are places it
 * needs to be.
 */
function scrubUrl() {
  try {
    const url = new URL(window.location.href)
    if (!url.searchParams.has('token')) return
    url.searchParams.delete('token')
    window.history.replaceState({}, '', url.toString())
  } catch {
    /* a browser that dislikes replaceState is not worth failing a trial over */
  }
}

const textFor = (code) => LAUNCH_ERROR_TEXT[code] || LAUNCH_ERROR_TEXT[LAUNCH_ERRORS.UNAVAILABLE]

/**
 * Exchange the token for the session.
 *
 * Resolves to `{ ok: true, session, simulation }` or `{ ok: false, code, message }`.
 * It never throws and it never rejects: a courtroom that cannot open should say
 * so on screen, not disappear behind an unhandled promise.
 */
export async function openLaunchSession() {
  if (!isLaunched) return { ok: false, code: LAUNCH_ERRORS.NO_TOKEN, message: textFor(LAUNCH_ERRORS.NO_TOKEN) }

  let res
  try {
    res = await fetch(`${ORIGIN}/api/simulations/${encodeURIComponent(SESSION_ID)}`, {
      method: 'GET',
      headers: authHeaders(),
      // No cookie is wanted or needed. The token is the whole credential, and
      // asking for credentials would require a CORS allow-credentials Converso
      // deliberately does not send.
      credentials: 'omit',
      cache: 'no-store',
    })
  } catch {
    return {
      ok: false,
      code: LAUNCH_ERRORS.UNAVAILABLE,
      message: 'Could not reach Converso. Check the connection and open the lesson again.',
    }
  }

  const body = await res.json().catch(() => ({}))

  if (!res.ok) {
    const code = body.code || (res.status === 403 ? LAUNCH_ERRORS.WRONG_USER : LAUNCH_ERRORS.BAD_TOKEN)
    return { ok: false, code, message: body.error || textFor(code) }
  }

  scrubUrl()

  const { session, simulation } = body
  if (simulation?.kind && simulation.kind !== SIMULATION_KIND.COURTROOM) {
    // Converso minted a classroom launch and it arrived here. Nothing about this
    // is the student's fault, so it is a configuration error stated plainly.
    return {
      ok: false,
      code: LAUNCH_ERRORS.UNAVAILABLE,
      message: `This session is a ${simulation.kind}, not a hearing. Check which scene URL the lesson points at.`,
    }
  }

  return { ok: true, session, simulation }
}

/* --- reporting back ------------------------------------------------------- */

const post = async (path, payload, { beacon = false } = {}) => {
  const url = `${ORIGIN}/api/simulations/${encodeURIComponent(SESSION_ID)}${path}`
  const body = JSON.stringify(payload ?? {})

  // On unload there is no time for a fetch and no one left to read the answer.
  // A beacon cannot carry the Authorization header, so the token rides in the
  // query string for this one call — the same token the route already accepts
  // there, and the page is going away regardless.
  if (beacon && navigator.sendBeacon) {
    const sealed = `${url}${path.includes('?') ? '&' : '?'}token=${encodeURIComponent(TOKEN)}`
    return navigator.sendBeacon(sealed, new Blob([body], { type: 'application/json' }))
  }

  try {
    const res = await fetch(url, { method: 'POST', headers: authHeaders(), body, credentials: 'omit' })
    return res.ok ? await res.json().catch(() => ({})) : null
  } catch {
    return null
  }
}

/**
 * A bookmark, not a grade.
 *
 * Converso stores this so a student who comes back sees where they were. It is
 * throttled because the court moves faster than anyone needs saving, and it is
 * fire-and-forget because a dropped bookmark costs a student nothing.
 */
let lastProgressAt = 0
const PROGRESS_EVERY_MS = 15_000

export function reportProgress(progress, { force = false } = {}) {
  if (!isLaunched) return
  const now = Date.now()
  if (!force && now - lastProgressAt < PROGRESS_EVERY_MS) return
  lastProgressAt = now
  void post('/progress', progress)
}

/**
 * The trial is over.
 *
 * Sent once. Converso re-derives the score from these counts and ignores any
 * score sent with them, which is the right way round — this is a browser, and a
 * browser can be told to say anything. What it reports are the engine's own
 * tallies, and what comes back is what they were worth.
 */
let completed = false

export async function reportComplete(result) {
  if (!isLaunched || completed) return null
  completed = true
  return post('/complete', result)
}

/** The student closed the tab mid-hearing. Best effort by nature. */
export function reportAbandoned() {
  if (!isLaunched || completed) return
  post('/abandon', {}, { beacon: true })
}

export const launchTarget = ORIGIN
