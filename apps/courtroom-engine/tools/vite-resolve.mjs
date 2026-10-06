/**
 * Node resolve hook that understands Vite's extensionless imports.
 *
 * The frontend is written for a bundler, so `import { x } from './animationMap'`
 * has no file extension. Node's ESM resolver requires one. Rather than edit the
 * frontend to suit a test harness — the source has to stay exactly what the browser
 * runs — this hook does what Vite does and tries the extensions in turn.
 *
 * Register with:  node --import ./tools/vite-resolve.mjs your-script.mjs
 */
import { register } from 'node:module'
import { pathToFileURL } from 'node:url'
import fs from 'node:fs'

const EXTENSIONS = ['.js', '.jsx', '.mjs', '.ts', '.tsx', '/index.js', '/index.jsx']

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context)
  } catch (err) {
    const relative = specifier.startsWith('.') || specifier.startsWith('/')
    if (!relative) throw err
    const base = new URL(specifier, context.parentURL)
    for (const ext of EXTENSIONS) {
      const candidate = new URL(base.href + ext)
      if (fs.existsSync(candidate)) {
        return { url: candidate.href, shortCircuit: true, format: 'module' }
      }
    }
    throw err
  }
}

// Self-registering: importing this file installs the hook in the main thread.
if (!process.env.VITE_RESOLVE_REGISTERED) {
  process.env.VITE_RESOLVE_REGISTERED = '1'
  register(pathToFileURL(import.meta.filename))
}
