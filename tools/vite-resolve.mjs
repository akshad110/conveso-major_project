/**
 * Let Node import the app's source the way Vite does.
 *
 * The courtroom is a Vite app, so its modules import each other without a file
 * extension — `from './courtroomLayout'`. Node's ESM resolver requires the
 * extension and throws ERR_MODULE_NOT_FOUND on those specifiers, which would
 * otherwise put every module in `apps/courtroom/src` permanently out of reach of
 * the verifier. Registering this hook is what makes the registry testable
 * offline without a bundler and without editing the app to suit the test.
 *
 * It only ever appends `.js` / `.jsx` to a relative specifier that failed, so it
 * cannot change the meaning of a specifier that already resolves.
 *
 * Usage:  node --import ./tools/vite-resolve.mjs some-script.mjs
 */
import { register } from 'node:module'
import { pathToFileURL } from 'node:url'

const SUFFIXES = ['.js', '.jsx', '/index.js', '/index.jsx']

export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context)
  } catch (error) {
    if (error?.code !== 'ERR_MODULE_NOT_FOUND' || !specifier.startsWith('.')) throw error
    for (const suffix of SUFFIXES) {
      try {
        return await next(specifier + suffix, context)
      } catch {
        // Try the next suffix.
      }
    }
    throw error
  }
}

register(pathToFileURL(import.meta.filename))
