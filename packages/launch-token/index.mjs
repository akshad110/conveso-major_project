/**
 * @converso/launch-token — the doorway between Converso and a heavy app.
 *
 * The problem this solves: the courtroom and the classroom are separate
 * programs, possibly on separate origins, and neither may have a login screen.
 * So Converso — which does know who you are, via Clerk — mints a token that
 * says "this person, this session, for the next two minutes" and puts it in
 * the launch URL.
 *
 * Three properties matter, and each one is a deliberate choice:
 *
 *   The signing secret never leaves the server. This module imports
 *   node:crypto at the top level precisely so that bundling it into a client
 *   component fails loudly at build time instead of quietly shipping a secret.
 *
 *   The token is opaque to the browser. The heavy app does not verify it
 *   itself — it hands it back to Converso's own API, which verifies and
 *   answers with the session. That way the verifying secret exists in exactly
 *   one place, and a compromised courtroom deployment cannot mint its own.
 *
 *   It expires in two minutes. It is a doorway, not a session. The session
 *   lives in the database with its own, longer, lifetime.
 *
 * Format: `v1.<base64url payload>.<base64url HMAC-SHA256>`. Chosen over JWT so
 * there is no algorithm field for an attacker to set to "none", and no
 * dependency to install in a workspace where npm is not always reachable.
 */

import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'

const VERSION = 'v1'

const b64url = (buf) => Buffer.from(buf).toString('base64url')
const unb64url = (str) => Buffer.from(str, 'base64url')

function mac(secret, body) {
  return createHmac('sha256', secret).update(body).digest()
}

/**
 * Mint a token.
 *
 * @param {object} claims  { sessionId, userId, kind, role? }
 * @param {string} secret  SIMULATION_LAUNCH_SECRET — server-side only
 * @param {number} ttlSeconds
 */
export function sign(claims, secret, ttlSeconds = 120) {
  if (!secret || typeof secret !== 'string' || secret.length < 16) {
    throw new Error('launch-token: a signing secret of at least 16 characters is required')
  }
  if (!claims?.sessionId) throw new Error('launch-token: sessionId is required')
  if (!claims?.userId) throw new Error('launch-token: userId is required')

  const now = Math.floor(Date.now() / 1000)
  const payload = {
    sid: String(claims.sessionId),
    uid: String(claims.userId),
    knd: claims.kind ? String(claims.kind) : 'courtroom',
    rol: claims.role ? String(claims.role) : null,
    iat: now,
    exp: now + Math.max(1, Math.floor(ttlSeconds)),
    jti: randomUUID(),
  }

  const body = `${VERSION}.${b64url(JSON.stringify(payload))}`
  return `${body}.${b64url(mac(secret, body))}`
}

/**
 * Check a token. Never throws — a malformed token is an expected input here,
 * not an exception, and the caller wants a code it can turn into one sentence
 * for a student rather than a stack trace.
 *
 * @returns {{ok: true, claims: object} | {ok: false, error: string}}
 */
export function verify(token, secret, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!secret) return { ok: false, error: 'NO_SECRET' }
  if (typeof token !== 'string' || !token) return { ok: false, error: 'NO_TOKEN' }

  const parts = token.split('.')
  if (parts.length !== 3) return { ok: false, error: 'BAD_TOKEN' }
  const [version, body64, sig64] = parts
  if (version !== VERSION) return { ok: false, error: 'BAD_TOKEN' }

  const expected = mac(secret, `${version}.${body64}`)
  let given
  try {
    given = unb64url(sig64)
  } catch {
    return { ok: false, error: 'BAD_TOKEN' }
  }
  // Length has to match before timingSafeEqual will look at the bytes, and a
  // length mismatch is itself a rejection — so compare it first and return the
  // same generic code either way.
  if (given.length !== expected.length) return { ok: false, error: 'BAD_TOKEN' }
  if (!timingSafeEqual(given, expected)) return { ok: false, error: 'BAD_TOKEN' }

  let claims
  try {
    claims = JSON.parse(unb64url(body64).toString('utf8'))
  } catch {
    return { ok: false, error: 'BAD_TOKEN' }
  }

  if (typeof claims?.exp !== 'number' || typeof claims?.sid !== 'string') {
    return { ok: false, error: 'BAD_TOKEN' }
  }
  if (claims.exp <= nowSeconds) return { ok: false, error: 'EXPIRED' }

  return {
    ok: true,
    claims: {
      sessionId: claims.sid,
      userId: claims.uid,
      kind: claims.knd,
      role: claims.rol,
      issuedAt: claims.iat,
      expiresAt: claims.exp,
      id: claims.jti,
    },
  }
}

/**
 * Read the session id without checking the signature.
 *
 * Only for logging and for choosing which row to look at *before* deciding
 * whether to trust it. Never let this decide access — verify() does that.
 */
export function peek(token) {
  try {
    const body64 = String(token).split('.')[1]
    const claims = JSON.parse(unb64url(body64).toString('utf8'))
    return { sessionId: claims.sid ?? null, userId: claims.uid ?? null, kind: claims.knd ?? null }
  } catch {
    return { sessionId: null, userId: null, kind: null }
  }
}
