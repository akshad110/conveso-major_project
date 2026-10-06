/**
 * Round-trip and, more importantly, the ways a token must fail.
 *
 * A signing test that only proves the happy path proves almost nothing: the
 * whole value of this module is what it refuses. So most of what follows is
 * forgeries.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sign, verify, peek } from './index.mjs'

const SECRET = 'a-test-secret-long-enough-to-pass'
const OTHER = 'a-different-secret-of-similar-size'

test('a fresh token verifies and carries its claims back', () => {
  const token = sign({ sessionId: 'sess-1', userId: 'user-1', kind: 'courtroom', role: 'defense' }, SECRET)
  const result = verify(token, SECRET)
  assert.equal(result.ok, true)
  assert.equal(result.claims.sessionId, 'sess-1')
  assert.equal(result.claims.userId, 'user-1')
  assert.equal(result.claims.kind, 'courtroom')
  assert.equal(result.claims.role, 'defense')
})

test('two tokens for the same session are still distinct', () => {
  const a = sign({ sessionId: 'sess-1', userId: 'user-1' }, SECRET)
  const b = sign({ sessionId: 'sess-1', userId: 'user-1' }, SECRET)
  assert.notEqual(a, b, 'each launch gets its own jti')
})

test('a token signed with another secret is refused', () => {
  const token = sign({ sessionId: 'sess-1', userId: 'user-1' }, OTHER)
  assert.deepEqual(verify(token, SECRET), { ok: false, error: 'BAD_TOKEN' })
})

test('editing the payload breaks the signature', () => {
  const token = sign({ sessionId: 'sess-1', userId: 'user-1' }, SECRET)
  const [v, body, sig] = token.split('.')
  const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
  claims.uid = 'someone-else'
  const forged = `${v}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.${sig}`
  assert.deepEqual(verify(forged, SECRET), { ok: false, error: 'BAD_TOKEN' })
})

test('an expired token is refused, and says so specifically', () => {
  const token = sign({ sessionId: 'sess-1', userId: 'user-1' }, SECRET, 60)
  const later = Math.floor(Date.now() / 1000) + 120
  assert.deepEqual(verify(token, SECRET, later), { ok: false, error: 'EXPIRED' })
})

test('a token one second short of expiry still works', () => {
  const token = sign({ sessionId: 'sess-1', userId: 'user-1' }, SECRET, 60)
  const almost = Math.floor(Date.now() / 1000) + 59
  assert.equal(verify(token, SECRET, almost).ok, true)
})

test('rubbish in every shape is refused without throwing', () => {
  for (const bad of ['', 'nonsense', 'v1.abc', 'v2.abc.def', 'v1..', '....', null, undefined, 42, {}]) {
    const result = verify(bad, SECRET)
    assert.equal(result.ok, false, `${JSON.stringify(bad)} must not verify`)
  }
})

test('a truncated signature is refused rather than crashing timingSafeEqual', () => {
  const token = sign({ sessionId: 'sess-1', userId: 'user-1' }, SECRET)
  const [v, body, sig] = token.split('.')
  assert.deepEqual(verify(`${v}.${body}.${sig.slice(0, 10)}`, SECRET), { ok: false, error: 'BAD_TOKEN' })
})

test('verifying with no secret configured fails closed', () => {
  const token = sign({ sessionId: 'sess-1', userId: 'user-1' }, SECRET)
  assert.deepEqual(verify(token, ''), { ok: false, error: 'NO_SECRET' })
})

test('signing refuses a weak secret rather than issuing a weak token', () => {
  assert.throws(() => sign({ sessionId: 's', userId: 'u' }, 'short'))
  assert.throws(() => sign({ sessionId: 's', userId: 'u' }, ''))
})

test('signing refuses incomplete claims', () => {
  assert.throws(() => sign({ userId: 'u' }, SECRET))
  assert.throws(() => sign({ sessionId: 's' }, SECRET))
})

test('peek reads the session id without vouching for it', () => {
  const forged = sign({ sessionId: 'sess-9', userId: 'user-9' }, OTHER)
  assert.equal(peek(forged).sessionId, 'sess-9', 'peek reads it')
  assert.equal(verify(forged, SECRET).ok, false, 'and verify still refuses it')
  assert.deepEqual(peek('rubbish'), { sessionId: null, userId: null, kind: null })
})
