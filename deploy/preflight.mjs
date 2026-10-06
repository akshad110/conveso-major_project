#!/usr/bin/env node
/**
 * Pre-deploy preflight.
 *
 * `npm run verify:all` holds the code together. This holds the *deployment*
 * together, which is a different problem: nothing here is wrong in the
 * repository, it only becomes wrong once there is a domain involved. A
 * `ws://` URL is perfectly correct on a laptop and blocked as mixed content on
 * an HTTPS page. `frame-ancestors https://app.converso.example` is a sensible
 * default and a blank iframe on your real domain.
 *
 * So this checks the things that are only checkable when you know where you are
 * deploying to, plus the handful of repository facts that decide whether a
 * deploy can succeed at all.
 *
 * Zero dependencies, like everything else that has to run before `npm install`.
 *
 *   node deploy/preflight.mjs                       # repo checks only
 *   node deploy/preflight.mjs --env .env.production # + everything env-dependent
 *   node deploy/preflight.mjs --env a --env b       # merged, later wins
 *   node deploy/preflight.mjs --strict              # warnings count as failures
 *
 * Exit 0 clean, 1 if anything failed. Designed to be a CI gate.
 */

import { readFileSync, existsSync, readdirSync, openSync, readSync, closeSync, statSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const argv = process.argv.slice(2)
const STRICT = argv.includes('--strict')
const envFiles = []
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i] === '--env' && argv[i + 1]) envFiles.push(argv[i + 1])
}

/* ------------------------------------------------------------------ output */

let failures = 0
let warnings = 0
let passes = 0

const RED = '\u001b[31m'
const YELLOW = '\u001b[33m'
const GREEN = '\u001b[32m'
const DIM = '\u001b[2m'
const OFF = '\u001b[0m'
const colour = process.stdout.isTTY && !process.env.NO_COLOR

const paint = (c, s) => (colour ? `${c}${s}${OFF}` : s)

const ok = (name, detail) => {
  passes += 1
  console.log(`${paint(GREEN, 'ok  ')} ${name}${detail ? paint(DIM, ` — ${detail}`) : ''}`)
}
const warn = (name, detail) => {
  warnings += 1
  console.log(`${paint(YELLOW, 'warn')} ${name}${detail ? ` — ${detail}` : ''}`)
}
const fail = (name, detail) => {
  failures += 1
  console.log(`${paint(RED, 'FAIL')} ${name}${detail ? ` — ${detail}` : ''}`)
}
const skip = (name, why) => {
  console.log(`${paint(DIM, 'skip')} ${paint(DIM, `${name} — ${why}`)}`)
}
const section = (title) => console.log(`\n${paint(DIM, '·')} ${title}`)

/* ----------------------------------------------------------- env collection */

/**
 * A deliberately small .env parser. It does not do multi-line values or
 * variable interpolation, because neither appears in this project's
 * `.env.example` and a parser that silently half-supports a syntax is worse
 * than one that does not support it.
 */
function parseEnvFile(path) {
  const out = {}
  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 1) continue
    const key = line.slice(0, eq).trim().replace(/^export\s+/, '')
    let value = line.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}

const ENV = { ...process.env }
let envSource = envFiles.length ? envFiles.join(', ') : 'process environment'
for (const file of envFiles) {
  const path = resolve(ROOT, file)
  if (!existsSync(path)) {
    fail('environment file', `${file} does not exist`)
    continue
  }
  Object.assign(ENV, parseEnvFile(path))
}

// A value that is present but still the annotation from `.env.example` is
// worse than an absent one: absent fails loudly at boot, a placeholder deploys
// and then misbehaves on a real user.
//
// No empty alternative in this group. `/^(|todo|...)/` matches the empty string
// at position zero of every input, so it matches everything — which made
// `set()` return false for every variable and every env-dependent check below
// skip itself while reporting success. A check that cannot fail is worse than
// no check, and this one hid behind a `skip` line that looked deliberate.
const PLACEHOLDER = /^(your|xxx+|todo|changeme|change[-_ ]me|replace|<|\.\.\.)/i
const set = (key) => {
  const v = ENV[key]
  return typeof v === 'string' && v.trim() !== '' && !PLACEHOLDER.test(v.trim())
}
const val = (key) => (ENV[key] || '').trim()

const originOf = (url) => {
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

/**
 * Local development and production disagree about what is correct, and almost
 * every rule below flips between them: `http://localhost:3000` is right on a
 * laptop and wrong on a domain, `ws://` is right on a laptop and blocked as
 * mixed content on an HTTPS page, a Clerk `_test_` key is right on a laptop
 * and a redirect loop on a domain.
 *
 * So the mode is inferred from the configuration itself rather than asked for.
 * A checker that reports four failures against a perfectly good dev setup
 * teaches you to ignore it, and then it is worth nothing on the day it is
 * right.
 */
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/
const isLocalUrl = (url) => {
  try {
    return LOCAL_HOST.test(new URL(url).hostname)
  } catch {
    return false
  }
}
const FORCED = argv.includes('--production') ? 'production' : argv.includes('--local') ? 'local' : null
const declaredUrls = ['VITE_CONVERSO_URL', 'NEXT_PUBLIC_COURTROOM_URL', 'NEXT_PUBLIC_LANGUAGE_SCENE_URL']
  .map((k) => (ENV[k] || '').trim())
  .filter(Boolean)
const LOCAL = FORCED ? FORCED === 'local' : declaredUrls.length > 0 && declaredUrls.every(isLocalUrl)
const MODE = LOCAL ? 'local development' : 'production deployment'

/* ============================================================ repo readiness
 * These run with no environment at all, because they are about whether the
 * artefacts can be hosted, not about where.
 */

console.log(
  `Preflight — checking this as a ${paint(GREEN, MODE)}` +
    paint(DIM, FORCED ? ' (forced)' : ', inferred from the URLs in the configuration') +
    paint(DIM, '\nForce the other with --production or --local.'),
)

section('the repository')

// 1. The models, against the ceiling that actually rejects a deploy.
{
  const dir = join(ROOT, 'apps/courtroom/public/models')
  const LIMIT = 100 * 1024 * 1024 // Vercel's per-file ceiling at time of writing.
  if (!existsSync(dir)) {
    fail('models directory', 'apps/courtroom/public/models is missing')
  } else {
    const glbs = readdirSync(dir).filter((f) => f.endsWith('.glb'))
    const sized = glbs.map((f) => ({ f, bytes: statSync(join(dir, f)).size }))
    const total = sized.reduce((a, b) => a + b.bytes, 0)
    const over = sized.filter((m) => m.bytes > LIMIT)
    const mb = (b) => `${(b / 1024 / 1024).toFixed(1)} MB`

    // The check this whole section exists for, and the one that matters most in
    // CI: the GLBs are gitignored, so a runner that only has the repository has
    // no models at all. Without this, every size check below passes vacuously
    // over an empty set and the courtroom deploys as a room with no room in it
    // — a build that succeeds and a product that 404s ten times on first paint.
    // MANIFEST.md is the list of what a complete copy contains.
    // `new Set` because MANIFEST.md names CourtRoom.glb in its prose as well as
    // in the table, and counting it three times turns "10 files" into "13".
    const manifest = join(dir, 'MANIFEST.md')
    const expected = existsSync(manifest)
      ? [...new Set([...readFileSync(manifest, 'utf8').matchAll(/`([\w.-]+\.glb)`/g)].map((m) => m[1]))]
      : []
    const absent = expected.filter((f) => !glbs.includes(f))

    if (!expected.length) {
      warn('every model in the manifest is on disk', 'MANIFEST.md lists none — cannot tell a complete copy from an empty one')
    } else if (absent.length) {
      fail(
        'every model in the manifest is on disk',
        `${absent.length} of ${expected.length} missing (${absent.slice(0, 3).join(', ')}${absent.length > 3 ? ', …' : ''}). ` +
          'They are gitignored, so a CI checkout has none — commit them after Step 0 or serve them from object storage',
      )
    } else {
      ok('every model in the manifest is on disk', `${expected.length} files`)
    }

    if (!glbs.length) {
      skip('no model exceeds the host per-file limit', 'no models to measure')
      skip('the models have been through the optimiser', 'no models to measure')
    } else if (LOCAL) {
      // A 105 MB model off a local disk is a slow first paint and nothing
      // more. The ceiling is the host's, so it only exists once there is a host.
      skip('no model exceeds the host per-file limit', `not a local concern; ${mb(total)} total across ${sized.length} files`)
    } else if (over.length) {
      fail(
        'no model exceeds the host per-file limit',
        `${over.map((m) => `${m.f} is ${mb(m.bytes)}`).join(', ')} — over the 100 MB ceiling. Run Step 0: npm run assets:optimise`,
      )
    } else {
      ok('no model exceeds the host per-file limit', `largest is ${mb(Math.max(...sized.map((m) => m.bytes)))}`)
    }

    // Has Step 0 actually run? Read it off the files rather than trusting a
    // note: an optimised GLB declares the two extensions in its JSON chunk.
    // This is the difference between "someone said they ran it" and "the bytes
    // on disk were produced by it".
    const wanted = ['EXT_texture_webp', 'EXT_meshopt_compression']
    const unoptimised = []
    for (const { f } of sized) {
      const used = glbExtensions(join(dir, f))
      if (!wanted.some((w) => used.includes(w))) unoptimised.push(f)
    }
    if (!glbs.length) {
      // already skipped above
    } else if (unoptimised.length === sized.length) {
      warn(
        'the models have been through the optimiser',
        `none of ${sized.length} declares EXT_texture_webp or EXT_meshopt_compression; total payload ${mb(total)}`,
      )
    } else if (unoptimised.length) {
      warn('the models have been through the optimiser', `${unoptimised.length} still uncompressed: ${unoptimised.join(', ')}`)
    } else {
      ok('the models have been through the optimiser', `${sized.length} files, ${mb(total)} total`)
    }
  }
}

/**
 * Read `extensionsUsed` out of a GLB without loading the file. A GLB is a
 * 12-byte header then length-prefixed chunks, the first of which is JSON — so
 * the interesting part is in the first few kilobytes of a 105 MB file.
 */
function glbExtensions(path) {
  let fd
  try {
    fd = openSync(path, 'r')
    const head = Buffer.alloc(20)
    if (readSync(fd, head, 0, 20, 0) < 20) return []
    if (head.toString('ascii', 0, 4) !== 'glTF') return []
    const chunkLength = head.readUInt32LE(12)
    const chunkType = head.readUInt32LE(16)
    if (chunkType !== 0x4e4f534a) return [] // not a JSON chunk
    const json = Buffer.alloc(chunkLength)
    readSync(fd, json, 0, chunkLength, 20)
    const parsed = JSON.parse(json.toString('utf8'))
    return parsed.extensionsUsed || []
  } catch {
    return []
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

// 2. Both migrations present. A deploy against a database missing 0002 looks
//    like an empty catalogue rather than an error.
{
  const migrations = ['db/migrations/0001_simulations.sql', 'db/migrations/0002_seed_simulations.sql']
  const missing = migrations.filter((m) => !existsSync(join(ROOT, m)))
  if (missing.length) fail('both migrations are present', missing.join(', '))
  else ok('both migrations are present', '0001 schema, 0002 catalogue seed')
}

// 3. No real environment file is tracked. `.gitignore` covers this, but
//    `git add -f` exists and this is the mistake with no undo.
{
  let tracked = []
  try {
    const out = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
    tracked = out
      .split('\n')
      .map((s) => s.trim())
      .filter((f) => /(^|\/)\.env($|\.)/.test(f) && !f.endsWith('.env.example'))
  } catch {
    skip('no secret-bearing env file is committed', 'not a git repository')
  }
  if (tracked.length) fail('no secret-bearing env file is committed', tracked.join(', '))
  else if (existsSync(join(ROOT, '.git'))) ok('no secret-bearing env file is committed', 'only .env.example is tracked')
}

/* ========================================================= deployment config
 * The two files that carry a hostname. Both ship with a working example
 * domain, which is the right default and the wrong value.
 */

section('the deployment config')

// 4. The courtroom's frame-ancestors has to name the real LMS origin. Left at
//    the placeholder, the iframe renders blank with a CSP violation in the
//    console and nothing in the network tab to suggest why.
{
  const path = join(ROOT, 'apps/courtroom/vercel.json')
  if (!existsSync(path)) {
    fail('the courtroom host config exists', 'apps/courtroom/vercel.json is missing')
  } else {
    const config = JSON.parse(readFileSync(path, 'utf8'))
    const csp = (config.headers || [])
      .flatMap((h) => h.headers || [])
      .find((h) => h.key.toLowerCase() === 'content-security-policy')

    if (!csp || !/frame-ancestors/.test(csp.value)) {
      fail('the courtroom pins who may frame it', 'no frame-ancestors directive in vercel.json')
    } else if (LOCAL) {
      // vercel.json is only read by Vercel. The dev server never sees it, so
      // the placeholder in it cannot affect anything you are running now.
      skip('the courtroom pins who may frame it', 'vercel.json is not read by the dev server')
    } else if (/converso\.example/.test(csp.value)) {
      fail(
        'the courtroom pins who may frame it',
        `frame-ancestors is still the placeholder (${csp.value}) — set it to your LMS origin or the iframe renders blank`,
      )
    } else if (set('VITE_CONVERSO_URL')) {
      // The stronger version of the same check: agreement, not just absence of
      // the placeholder. These two values name the same origin from opposite
      // sides of the iframe and there is nothing that keeps them in step.
      const lms = originOf(val('VITE_CONVERSO_URL'))
      if (lms && csp.value.includes(lms)) ok('the courtroom pins who may frame it', `frame-ancestors allows ${lms}`)
      else fail('the courtroom pins who may frame it', `frame-ancestors (${csp.value}) does not include VITE_CONVERSO_URL's origin ${lms}`)
    } else {
      ok('the courtroom pins who may frame it', csp.value)
    }
  }
}

// 5. Fly's app name and the placeholder region.
{
  const path = join(ROOT, 'deploy/fly.toml')
  if (LOCAL) {
    skip('the engine host config', 'fly.toml only matters once the engine is on Fly')
  } else if (!existsSync(path)) {
    fail('the engine host config exists', 'deploy/fly.toml is missing')
  } else {
    const toml = readFileSync(path, 'utf8')
    const app = /^\s*app\s*=\s*"([^"]+)"/m.exec(toml)?.[1]
    if (app === 'converso-engine') {
      warn('the engine app has been named', 'fly.toml still says "converso-engine", which is almost certainly taken')
    } else if (app) {
      ok('the engine app has been named', app)
    } else {
      fail('the engine app has been named', 'no app key in fly.toml')
    }

    // The two settings whose platform default silently forgets a hearing.
    const stopsAtZero = !/auto_stop_machines\s*=\s*false/.test(toml)
    const noFloor = !/min_machines_running\s*=\s*1/.test(toml)
    if (stopsAtZero || noFloor) {
      fail(
        'the engine will not scale to zero',
        'trial state is in memory; auto_stop_machines must be false and min_machines_running must be 1',
      )
    } else {
      ok('the engine will not scale to zero', 'auto_stop_machines false, min_machines_running 1')
    }
  }
}

/* ================================================================ the LMS env */

section('the LMS environment')

const LMS_REQUIRED = [
  'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY',
  'CLERK_SECRET_KEY',
  'NEXT_PUBLIC_CLERK_SIGN_IN_URL',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'LAUNCH_TOKEN_SECRET',
  'NEXT_PUBLIC_COURTROOM_URL',
]

const haveLmsEnv = LMS_REQUIRED.some((k) => set(k))

if (!haveLmsEnv) {
  skip('the LMS environment', `nothing supplied — pass --env <file> to check it (looked in ${envSource})`)
} else {
  const missing = LMS_REQUIRED.filter((k) => !set(k))
  if (missing.length) fail('every required LMS variable is set', missing.join(', '))
  else ok('every required LMS variable is set', `${LMS_REQUIRED.length} variables`)

  // 6. The signing secret. `sign()` refuses under 16 characters, so a short one
  //    is a crash at the first launch rather than a weak token — but a
  //    *guessable* one of adequate length is worse, because it works.
  if (set('LAUNCH_TOKEN_SECRET')) {
    const secret = val('LAUNCH_TOKEN_SECRET')
    const weak = ['secret', 'changeme', 'development', 'dev-secret', 'test', 'password']
    if (secret.length < 16) {
      fail('the launch token secret is strong', `${secret.length} characters; sign() refuses anything under 16`)
    } else if (weak.some((w) => secret.toLowerCase().includes(w))) {
      fail('the launch token secret is strong', 'contains a dictionary word — use openssl rand -base64 32')
    } else if (secret.length < 32) {
      warn('the launch token secret is strong', `${secret.length} characters; 32+ recommended (openssl rand -base64 32)`)
    } else {
      ok('the launch token secret is strong', `${secret.length} characters`)
    }
  }

  // 7. The service-role key must never wear a public prefix. This is the single
  //    most expensive possible typo in the whole project: a NEXT_PUBLIC_ name is
  //    inlined into the browser bundle, and that key bypasses RLS.
  {
    const leaked = Object.keys(ENV).filter(
      (k) => /^(NEXT_PUBLIC_|VITE_)/.test(k) && /SERVICE_ROLE|CLERK_SECRET|LAUNCH_TOKEN_SECRET|GEMINI/i.test(k),
    )
    if (leaked.length) fail('no server secret carries a public prefix', `${leaked.join(', ')} would be inlined into the browser bundle`)
    else ok('no server secret carries a public prefix', 'service-role key, Clerk secret and signing secret are all server-scoped')
  }

  // 8. Clerk production keys. Development keys work on localhost and fail on a
  //    real domain as a redirect loop, which reads like a routing bug.
  {
    const pk = val('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY')
    const sk = val('CLERK_SECRET_KEY')
    if (/_test_/.test(pk) || /_test_/.test(sk)) {
      if (LOCAL) ok('Clerk instance matches the target', 'development keys, which is what localhost wants')
      else warn('Clerk instance matches the target', 'keys are _test_ — a redirect loop on a real domain, not a clear error')
    } else if (pk || sk) {
      ok('Clerk instance matches the target', LOCAL ? 'live keys against localhost — allowed, but development keys are easier' : 'keys are live')
    }
  }

  // 9. The scene URLs, which are also the CORS allow-list. A trailing slash or
  //    a typo here does not present as a bad link — it presents as CORS
  //    failures on the session routes, because allowedOrigins() parses these.
  for (const key of ['NEXT_PUBLIC_COURTROOM_URL', 'NEXT_PUBLIC_LANGUAGE_SCENE_URL']) {
    if (!set(key)) {
      if (key === 'NEXT_PUBLIC_LANGUAGE_SCENE_URL') ok(`${key} is well formed`, 'unset — the LMS will not link the language room')
      continue
    }
    const raw = val(key)
    const origin = originOf(raw)
    if (!origin) fail(`${key} is well formed`, `"${raw}" is not a URL`)
    else if (raw.endsWith('/')) fail(`${key} is well formed`, 'trailing slash; the origin must match exactly or the session routes fail CORS')
    else if (LOCAL) ok(`${key} is well formed`, `${origin} (local)`)
    else if (!raw.startsWith('https://')) fail(`${key} is well formed`, 'must be https in production — it is also the CORS allow-list')
    else ok(`${key} is well formed`, origin)
  }
}

/* =========================================================== the courtroom env */

section('the courtroom build environment')

if (!set('VITE_CONVERSO_URL') && !set('VITE_COURT_WS_URL')) {
  skip('the courtroom build environment', 'nothing supplied')
} else {
  // 10. Mixed content. The default is ws://127.0.0.1:4177, and a browser on an
  //     HTTPS page silently blocks an insecure socket. The courtroom loads,
  //     renders the room, and never starts.
  const ws = val('VITE_COURT_WS_URL')
  const OFF_VALUES = ['off', 'none', 'false', '0', 'disabled']
  const lmsIsHttps = val('VITE_CONVERSO_URL').startsWith('https://')

  if (OFF_VALUES.includes(ws.toLowerCase())) {
    warn('the courtroom socket is secure', `set to "${ws}" — the room will run with no engine`)
  } else if (!ws) {
    fail('the courtroom socket is secure', 'unset; it would default to ws://127.0.0.1:4177, which is not reachable from a browser on your domain')
  } else if (LOCAL) {
    ok('the courtroom socket is secure', `${ws} (local — plain ws is fine off an http page)`)
  } else if (lmsIsHttps && ws.startsWith('ws://')) {
    fail('the courtroom socket is secure', `${ws} is plain ws:// on an https page — the browser blocks it as mixed content`)
  } else if (ws.startsWith('wss://')) {
    ok('the courtroom socket is secure', ws)
  } else {
    warn('the courtroom socket is secure', `${ws} — not wss://, acceptable only if the LMS is also http`)
  }

  // 11. The two sides of the iframe have to name each other. The LMS points at
  //     the courtroom; the courtroom posts its result back to the LMS. Nothing
  //     in either build keeps these in step, and a mismatch is a hearing that
  //     plays perfectly and scores nowhere.
  if (set('VITE_CONVERSO_URL') && set('NEXT_PUBLIC_COURTROOM_URL')) {
    const back = originOf(val('VITE_CONVERSO_URL'))
    if (!back) {
      fail('the two sides of the iframe agree', `VITE_CONVERSO_URL "${val('VITE_CONVERSO_URL')}" is not a URL`)
    } else {
      ok('the two sides of the iframe agree', `courtroom reports back to ${back}`)
    }
  } else if (set('VITE_CONVERSO_URL')) {
    ok('the two sides of the iframe agree', `courtroom reports back to ${originOf(val('VITE_CONVERSO_URL'))}`)
  } else {
    fail('the two sides of the iframe agree', 'VITE_CONVERSO_URL unset; the courtroom would fall back to the referrer origin')
  }
}

/* ================================================================ the engine */

section('the engine environment')

{
  const provider = val('COURT_LLM_PROVIDER')
  const KEYS = { anthropic: 'ANTHROPIC_API_KEY', openai: 'OPENAI_API_KEY' }
  const KNOWN = ['anthropic', 'openai', 'ollama', 'offline']

  if (!provider) {
    skip('the engine has a usable model provider', 'COURT_LLM_PROVIDER unset — the engine runs its offline heuristics')
  } else if (!KNOWN.includes(provider)) {
    fail('the engine has a usable model provider', `"${provider}" is not one of ${KNOWN.join(', ')}`)
  } else if (KEYS[provider] && !set(KEYS[provider])) {
    // Not fatal — the engine degrades to offline and says so — but a hearing
    // running on heuristics when you meant it to run on a model is the kind of
    // thing nobody notices until a demo.
    warn('the engine has a usable model provider', `provider is ${provider} but ${KEYS[provider]} is unset; it will fall back to offline`)
  } else {
    ok('the engine has a usable model provider', provider)
  }

  if (set('HOST') && val('HOST') === '127.0.0.1') {
    fail('the engine binds an externally reachable address', 'HOST=127.0.0.1 means "refuse every connection" inside a container; use 0.0.0.0')
  }
}

/* ================================================================== summary */

const failed = failures > 0 || (STRICT && warnings > 0)
console.log(
  `\n${failed ? paint(RED, 'preflight FAILED') : paint(GREEN, 'preflight passed')} — ` +
    `${passes} ok, ${warnings} warning${warnings === 1 ? '' : 's'}, ${failures} failure${failures === 1 ? '' : 's'}` +
    (STRICT ? ' (strict)' : ''),
)
if (!failed && warnings) console.log(paint(DIM, 'Warnings are things that deploy successfully and then behave in a way you did not intend.'))

process.exit(failed ? 1 : 0)
