/**
 * The spec's verification points, run as a test.
 *
 * The work is done by tools/verify-frontend-bridge.mjs, which needs the frontend
 * checkout and its installed dependencies (the store it drives is a real zustand
 * store). That is a reasonable thing for a developer's machine to have and an
 * unreasonable thing to require of the engine's own test suite, so when the
 * frontend is missing or uninstalled the test skips with the reason rather than
 * failing.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { findFrontend } from '../tools/find-frontend.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const script = path.join(here, '..', 'tools', 'verify-frontend-bridge.mjs')

const located = findFrontend()
const skip = !located.path
  ? `frontend not found (looked in ${located.tried.length} places)`
  : !located.installed
    ? `frontend at ${located.path} has no node_modules; run npm install there`
    : false

test('AI engine drives the 3D frontend correctly (spec verification checks)', { skip }, () => {
  const run = spawnSync(process.execPath, [script], {
    env: { ...process.env, FRONTEND: located.path },
    encoding: 'utf8',
    timeout: 60_000,
  })

  const output = `${run.stdout || ''}${run.stderr || ''}`
  assert.equal(run.status, 0, `bridge verification failed:\n${output}`)
  assert.doesNotMatch(output, /^FAIL/m, output)
  // Every check must pass, and there must be a double-digit number of them — a
  // regression that silently stopped registering checks would otherwise pass.
  assert.match(output, /\b(\d+)\/\1 checks passed/, output)
  assert.match(output, /\b\d\d\/\d\d checks passed/, output)
})
