/**
 * Locate the React frontend that this engine drives.
 *
 * The two projects sit side by side, but "side by side" has meant different things
 * at different times: the working layout has the engine at `Desktop/` alongside
 * `Desktop/courtroom_char_wth_animation/courtroom-sim`, while a packaged copy puts
 * them as plain siblings. Rather than bake either in, look for the frontend in the
 * places it is actually likely to be and say which one was used.
 *
 * A copy with `node_modules` wins over one without, because the bridge verifier
 * drives the frontend's real zustand store and cannot run against source alone.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const engineRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Relative to the engine root, in order of preference within each tier. */
const CANDIDATES = [
  // The suite layout: apps/courtroom-engine and apps/courtroom are siblings.
  '../courtroom',
  '../courtroom-sim',
  '../frontend',
  '../courtroom_char_wth_animation/courtroom-sim 2',
  '../courtroom_char_wth_animation/courtroom-sim',
]

const isFrontend = (dir) => fs.existsSync(path.join(dir, 'src/state/courtEvents.js'))
const isInstalled = (dir) => fs.existsSync(path.join(dir, 'node_modules/zustand'))

/**
 * @returns {{ path: string|null, installed: boolean, tried: string[] }}
 */
export function findFrontend(explicit = process.env.FRONTEND) {
  if (explicit) {
    const dir = path.resolve(explicit)
    return { path: isFrontend(dir) ? dir : null, installed: isInstalled(dir), tried: [dir] }
  }

  const tried = []
  const found = []
  for (const rel of CANDIDATES) {
    const dir = path.resolve(engineRoot, rel)
    tried.push(dir)
    if (isFrontend(dir)) found.push(dir)
  }

  // Prefer an installed copy; fall back to the first source-only one so callers can
  // give a precise "found it, but run npm install" message instead of "not found".
  const installed = found.find(isInstalled)
  const chosen = installed || found[0] || null
  return { path: chosen, installed: chosen ? isInstalled(chosen) : false, tried }
}
