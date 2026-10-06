#!/usr/bin/env node
/**
 * Offline checks on the seam between Converso, the courtroom and the classroom.
 *
 * Nothing here needs a database, a browser or a network. Every check reads a file
 * the suite ships and asserts that two places which have to agree actually do —
 * the kind of agreement that is easy to break in an edit and invisible until a
 * student hits it.
 *
 *   node tools/verify-integration.mjs [--verbose]
 *
 * Exits non-zero on the first failing category, so it is usable in CI.
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  SESSION_STATUS_LIST,
  SIMULATION_KIND_LIST,
  SIMULATION_KIND,
  PLAYABLE_ROLES,
  CLASSROOM_LANGUAGES,
  CLASSROOM_REGISTERS,
  LAUNCH_ERROR_TEXT,
  FRAME_SOURCE,
  SIMULATION_FRAME_SOURCES,
  FRAME_MESSAGES,
  normalizeCourtroomResult,
  normalizeClassroomResult,
  scoreCourtroom,
  scoreClassroom,
} from '../packages/contracts/index.mjs'
import { sign, verify, peek } from '../packages/launch-token/index.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const VERBOSE = process.argv.includes('--verbose')

let passed = 0
const failures = []

const read = (rel) => {
  const path = join(ROOT, rel)
  if (!existsSync(path)) throw new Error(`missing file: ${rel}`)
  return readFileSync(path, 'utf8')
}

const check = (label, fn) => {
  try {
    const detail = fn()
    passed += 1
    if (VERBOSE) console.log(`  ok   ${label}${detail ? ` — ${detail}` : ''}`)
  } catch (err) {
    failures.push({ label, message: err.message })
    console.log(`  FAIL ${label}\n         ${err.message}`)
  }
}

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

const heading = (text) => console.log(`\n${text}`)

/**
 * Source with its comments removed.
 *
 * Needed by the ordering checks below, which compare where two things appear.
 * A comment that names the thing it sits above — "returning before
 * `<CourtroomScene />` is the point" — is exactly the sort of comment worth
 * writing, and it would otherwise register as an earlier occurrence of the code
 * it describes and fail a check about the code's real position.
 */
const codeOnly = (source) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')

/* ===========================================================================
   1. The migration and the contracts agree on every enumerated value
   ---------------------------------------------------------------------------
   A check constraint and a JavaScript list are two copies of the same decision.
   When they drift, the symptom is a Postgres 23514 at the worst possible moment
   — after a student has finished a hearing.
   =========================================================================== */

heading('Migration ↔ contracts')

/**
 * Drop `--` comments before scanning.
 *
 * Every check below looks for a statement by matching text, and a comment is
 * text. Without this, prose explaining a decision counts as the decision: the
 * line `-- WHY user_id IS text` reads as a column declaration, and a
 * commented-out `create policy` would read as a live policy. Only what Postgres
 * would execute should be able to pass or fail a check.
 */
const stripComments = (sql) =>
  sql
    .split('\n')
    .map((line) => {
      // Naive but sufficient: these files contain no `--` inside a string literal.
      const at = line.indexOf('--')
      return at === -1 ? line : line.slice(0, at)
    })
    .join('\n')

const migration = stripComments(read('db/migrations/0001_simulations.sql'))

/** Pull the quoted values out of `check (col in ('a','b'))`. */
const constraintValues = (column) => {
  const pattern = new RegExp(`check\\s*\\(\\s*${column}\\s+in\\s*\\(([^)]*)\\)`, 'i')
  const found = migration.match(pattern)
  if (!found) throw new Error(`no check constraint found for column \`${column}\``)
  return found[1]
    .split(',')
    .map((s) => s.trim().replace(/^'|'$/g, ''))
    .filter(Boolean)
}

const sameSet = (a, b, what) => {
  const left = [...new Set(a)].sort()
  const right = [...new Set(b)].sort()
  assert(
    left.length === right.length && left.every((v, i) => v === right[i]),
    `${what}: sql has [${left}] but contracts say [${right}]`,
  )
  return left.join(', ')
}

check('status constraint matches SESSION_STATUS_LIST', () =>
  sameSet(constraintValues('status'), SESSION_STATUS_LIST, 'status'))

check('kind constraint matches SIMULATION_KIND_LIST', () =>
  sameSet(constraintValues('kind'), SIMULATION_KIND_LIST, 'kind'))

check('role constraint matches PLAYABLE_ROLES', () =>
  sameSet(constraintValues('role'), PLAYABLE_ROLES, 'role'))

check('language constraint matches CLASSROOM_LANGUAGES', () =>
  sameSet(constraintValues('language'), CLASSROOM_LANGUAGES, 'language'))

check('register constraint matches CLASSROOM_REGISTERS', () =>
  sameSet(constraintValues('register'), CLASSROOM_REGISTERS, 'register'))

/** The column list inside `create table … public.<name> ( … );`, comments gone. */
const tableBody = (name) => {
  const start = migration.indexOf(`public.${name} (`)
  if (start === -1) throw new Error(`no create table for ${name}`)
  const end = migration.indexOf('\n);', start)
  if (end === -1) throw new Error(`unterminated create table for ${name}`)
  return migration.slice(start, end)
}

check('user_id is text everywhere, never uuid', () => {
  // Three of the four tables carry a user_id. `simulations` does not, and must
  // not: it is the catalogue of hearings and rooms that exist, the same rows for
  // everybody. A user_id there would turn a shared catalogue into per-student
  // copies of the same two cases.
  const owned = ['simulation_sessions', 'simulation_results', 'classroom_sessions']
  for (const table of owned) {
    const column = tableBody(table).match(/user_id\s+(\w+)/)
    assert(column, `${table} has no user_id column`)
    assert(column[1] === 'text', `${table}.user_id is ${column[1]} — Clerk ids are not uuids`)
  }
  assert(!/user_id/.test(tableBody('simulations')), 'the simulations catalogue has a user_id column')
  return `${owned.length} text columns, catalogue has none`
})

/* ===========================================================================
   2. The database is closed to the browser
   =========================================================================== */

heading('Database exposure')

const TABLES = ['simulations', 'simulation_sessions', 'simulation_results', 'classroom_sessions']

check('RLS is enabled on all four tables', () => {
  for (const table of TABLES) {
    const pattern = new RegExp(`alter table public\\.${table}\\s+enable row level security`, 'i')
    assert(pattern.test(migration), `no RLS statement for ${table}`)
  }
  return TABLES.length + ' tables'
})

check('no permissive policy undoes it', () => {
  // A policy here could only be `using (true)`: identity is Clerk's, so there is
  // no Supabase JWT for a policy to judge. Absence is the protection.
  assert(!/create\s+policy/i.test(migration), 'a policy exists; the anon key would get in')
  return 'zero policies, service-role only'
})

check('no asset bytes or file paths in the schema or the seed', () => {
  const seedSql = stripComments(read('db/migrations/0002_seed_simulations.sql'))
  for (const [name, sql] of [['0001', migration], ['0002', seedSql]]) {
    const hits = sql.match(/\.(glb|gltf|png|jpe?g|mp4|webm|bin|ktx2?|wav|mp3)\b/gi)
    assert(!hits, `${name} mentions asset files: ${hits && [...new Set(hits)].join(', ')}`)
    assert(!/\bbytea\b/i.test(sql), `${name} declares a bytea column`)
  }
  return 'names and numbers only'
})

/* ===========================================================================
   3. The seed can only ask for things that exist
   =========================================================================== */

heading('Seed ↔ the apps')

const seed = read('db/migrations/0002_seed_simulations.sql')

check('every seeded case_id has a case file', () => {
  const dir = join(ROOT, 'apps/courtroom-engine/cases')
  const onDisk = new Set(
    readdirSync(dir)
      .filter((f) => f.endsWith('.json') && !f.endsWith('.script.json'))
      .map((f) => f.replace(/\.json$/, '')),
  )
  // Matches both the slug and the case_id line, hence the dedupe.
  const seeded = [...new Set([...seed.matchAll(/^\s*'(state-v-[a-z-]+)',\s*$/gm)].map((m) => m[1]))]
  assert(seeded.length > 0, 'no case ids found in the seed')
  for (const id of seeded) {
    assert(onDisk.has(id), `seed names case \`${id}\` but cases/${id}.json does not exist`)
  }
  return seeded.join(', ')
})

check('every seeded character is a role the registry knows', () => {
  const registry = read('apps/courtroom/src/config/characterRegistry.js')
  // The top-level keys of CHARACTERS: `  judge: {`
  const roles = new Set([...registry.matchAll(/^ {2}([a-z_]+):\s*\{/gm)].map((m) => m[1]))
  assert(roles.size >= 7, `expected 7 roles in the registry, found ${roles.size}`)

  const blocks = [...seed.matchAll(/'characters',\s*jsonb_build_array\(([^)]*)\)/g)]
  assert(blocks.length > 0, 'no characters array found in the seed')

  for (const block of blocks) {
    const named = [...block[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1])
    for (const role of named) {
      assert(roles.has(role), `seed asks for character \`${role}\`, which the registry has no entry for`)
    }
  }
  return `${roles.size} roles known`
})

check('the seed names no animation clips', () => {
  // The registry holds the clip list each GLB actually contains, measured from
  // the export. A clip named in SQL is a clip that can be wrong, and a missing
  // clip is a silent T-pose rather than an error.
  assert(!/'animations'/.test(seed), "seed contains an 'animations' key; clip names belong in the registry")
  return 'clips stay in characterRegistry.js'
})

check('seeded variants exist in the registry', () => {
  const registry = read('apps/courtroom/src/config/characterRegistry.js')
  const variants = [...seed.matchAll(/'(witness|defendant)',\s*'(male|female)'/g)]
  assert(variants.length > 0, 'no variants pinned in the seed')
  for (const [, role, variant] of variants) {
    const block = registry.split(new RegExp(`^ {2}${role}:`, 'm'))[1] || ''
    assert(
      new RegExp(`${variant}:\\s*M\\(`).test(block.slice(0, 600)),
      `registry has no \`${variant}\` variant for ${role}`,
    )
  }
  return variants.map(([, r, v]) => `${r}=${v}`).join(', ')
})

/* ===========================================================================
   4. The secret stays on the server
   =========================================================================== */

heading('Secret handling')

const walk = (rel, exts, out = []) => {
  const dir = join(ROOT, rel)
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const next = join(rel, entry.name)
    if (entry.isDirectory()) walk(next, exts, out)
    else if (exts.some((e) => entry.name.endsWith(e))) out.push(next)
  }
  return out
}

const lmsFiles = walk('apps/lms', ['.ts', '.tsx', '.js', '.jsx', '.mjs'])

check('LAUNCH_TOKEN_SECRET is read in exactly one file', () => {
  const readers = lmsFiles.filter((f) => /process\.env\.LAUNCH_TOKEN_SECRET/.test(read(f)))
  assert(readers.length === 1, `read in ${readers.length} files: ${readers.join(', ')}`)
  assert(readers[0] === 'apps/lms/lib/launch.ts', `read in ${readers[0]}, expected lib/launch.ts`)
  return readers[0]
})

check('the secret is never NEXT_PUBLIC_', () => {
  for (const file of lmsFiles) {
    assert(
      !/NEXT_PUBLIC_[A-Z_]*(SECRET|TOKEN_SECRET|SERVICE_ROLE)/.test(read(file)),
      `${file} exposes a secret through a NEXT_PUBLIC_ variable`,
    )
  }
  return `${lmsFiles.length} files clean`
})

check('lib/launch.ts is marked server-only', () => {
  const source = read('apps/lms/lib/launch.ts')
  assert(/^import ["']server-only["']/m.test(source), 'no `import "server-only"` at the top')
  return 'the build fails if a client component imports it'
})

check('no client component imports the token library', () => {
  for (const file of lmsFiles) {
    const source = read(file)
    if (!/^\s*["']use client["']/m.test(source)) continue
    assert(
      !/@converso\/launch-token/.test(source),
      `${file} is a client component and imports @converso/launch-token`,
    )
    assert(
      !/@\/lib\/launch/.test(source),
      `${file} is a client component and imports lib/launch`,
    )
  }
  return 'client bundles carry no signing code'
})

check('the service-role key never reaches a client component', () => {
  for (const file of lmsFiles) {
    const source = read(file)
    if (!/^\s*["']use client["']/m.test(source)) continue
    assert(
      !/SUPABASE_SERVICE_ROLE_KEY/.test(source),
      `${file} is a client component and names the service-role key`,
    )
  }
  return 'admin client stays server-side'
})

/* ===========================================================================
   5. The token-authed routes all do the same three things
   =========================================================================== */

heading('Route guards')

const TOKEN_ROUTES = [
  'apps/lms/app/api/simulations/[sessionId]/route.ts',
  'apps/lms/app/api/simulations/[sessionId]/complete/route.ts',
  'apps/lms/app/api/simulations/[sessionId]/progress/route.ts',
  'apps/lms/app/api/classroom/session/route.ts',
]

check('every cross-origin route verifies a launch token', () => {
  for (const route of TOKEN_ROUTES) {
    assert(/readLaunchToken\(/.test(read(route)), `${route} does not call readLaunchToken`)
  }
  return `${TOKEN_ROUTES.length} routes`
})

check('path-scoped routes compare the token to the path', () => {
  // A valid token for session A must not open session B.
  for (const route of TOKEN_ROUTES.filter((r) => r.includes('[sessionId]'))) {
    assert(
      /claims\.sessionId\s*!==\s*sessionId/.test(read(route)),
      `${route} never compares claims.sessionId with the sessionId in the path`,
    )
  }
  return '3 routes'
})

check('every cross-origin route answers preflight', () => {
  for (const route of TOKEN_ROUTES) {
    assert(/export async function OPTIONS/.test(read(route)), `${route} has no OPTIONS handler`)
    assert(/corsHeaders\(/.test(read(route)), `${route} does not send CORS headers`)
  }
  return `${TOKEN_ROUTES.length} routes`
})

check('CORS is never a wildcard', () => {
  const launch = read('apps/lms/lib/launch.ts')
  assert(
    !/Access-Control-Allow-Origin["']?\s*[:=]\s*["']\*/.test(launch),
    'Allow-Origin is `*`; these endpoints answer with a student\'s session',
  )
  assert(/allowedOrigins\(\)\.includes\(origin\)/.test(launch), 'origins are not checked against an allow-list')
  return 'echoes known origins only'
})

check('internal errors never reach the browser', () => {
  for (const route of TOKEN_ROUTES) {
    const source = read(route)
    // `err` may be logged; it may not be serialised into a response body.
    const leaks = source.match(/(?:message|error|detail)\s*:\s*(?:err|error)\b(?!or)/g)
    assert(!leaks, `${route} puts a caught error into a response: ${leaks?.join(', ')}`)
  }
  return 'coarse codes out, detail to the log'
})

/* ===========================================================================
   6. The score is the server's
   =========================================================================== */

heading('Result integrity')

check("the data layer never writes the browser's score", () => {
  const actions = read('apps/lms/lib/actions/simulation.actions.ts')
  assert(
    /normalizeCourtroomResult|normalizeClassroomResult/.test(actions),
    'results are written without going through a normalizer',
  )
  assert(
    !/score:\s*(?:body|raw|result|payload)\./.test(actions),
    'a score is read straight off the request',
  )
  return 'normalizer is the only path in'
})

check('a claimed score of 100 is discarded', () => {
  const claimed = normalizeCourtroomResult({
    score: 100,
    completed: false,
    objectionsRaised: 0,
    correctObjections: 0,
    evidencePresented: 0,
    rulings: 0,
    performance: { legalReasoning: 0, questioning: 0, evidenceHandling: 0 },
  })
  assert(claimed.score === 0, `expected 0, got ${claimed.score}`)
  return 'claimed 100 → stored 0'
})

check('impossible counts are clamped, not trusted', () => {
  const lying = normalizeCourtroomResult({
    objectionsRaised: 3,
    correctObjections: 9999,   // more correct than raised
    evidencePresented: 1e6,
    rulings: -40,
    duration: 60 * 60 * 24 * 7,
    performance: { legalReasoning: 500, questioning: -20, evidenceHandling: 50 },
  })
  assert(lying.correctObjections === 3, `correctObjections was ${lying.correctObjections}`)
  assert(lying.evidencePresented === 40, `evidencePresented was ${lying.evidencePresented}`)
  assert(lying.rulings === 0, `rulings was ${lying.rulings}`)
  assert(lying.performance.legalReasoning === 100, 'an axis exceeded 100')
  assert(lying.performance.questioning === 0, 'an axis went below 0')
  assert(lying.score <= 100 && lying.score >= 0, `score out of range: ${lying.score}`)
  return `score ${lying.score}`
})

check('a transcript cannot be used as an upload endpoint', () => {
  const huge = normalizeCourtroomResult({ transcript: 'x'.repeat(500_000) })
  assert(huge.transcript.length === 200_000, `stored ${huge.transcript.length} characters`)
  return '500k → 200k'
})

check('a classroom score is earned, not asserted', () => {
  const claimed = normalizeClassroomResult({ score: 95, questionsAsked: 0, phrasesPractised: 0 })
  assert(claimed.score === 0, `expected 0, got ${claimed.score}`)
  const real = normalizeClassroomResult({
    questionsAsked: 10, phrasesPractised: 10, completed: true, language: 'ja', register: 'formal',
  })
  assert(real.score === 100, `a full lesson scored ${real.score}`)
  return 'claimed 95 → 0; a full lesson → 100'
})

check('an unknown language is dropped rather than stored', () => {
  const result = normalizeClassroomResult({ language: 'xx', register: 'shouting' })
  assert(result.language === null, `language came through as ${result.language}`)
  assert(result.register === null, `register came through as ${result.register}`)
  return 'nulls, not a constraint violation'
})

check('participation is worth something on its own', () => {
  // Three quarters craft, one quarter participation: a hearing sat through in
  // silence with perfect axes is not a 100.
  const silent = scoreCourtroom({
    performance: { legalReasoning: 100, questioning: 100, evidenceHandling: 100 },
    objectionsRaised: 0, correctObjections: 0, evidencePresented: 0, rulings: 0, completed: false,
  })
  assert(silent === 75, `silent-but-perfect scored ${silent}, expected 75`)
  return 'silent but perfect → 75'
})

/* ---------------------------------------------------------------------------
   Progress, which is a different thing from a result
   ---------------------------------------------------------------------------
   A result is a mark. Progress is the student's journey — in Converso that is
   `session_history`, the same append-only log a voice session writes, read back
   by the dashboard and the profile. These three checks exist because the
   progress step runs after the two writes that matter, from a request with no
   Clerk cookie, and both of those facts are easy to undo by accident.
   --------------------------------------------------------------------------- */

check('finishing a simulation advances the student’s journey', () => {
  const actions = codeOnly(read('apps/lms/lib/actions/simulation.actions.ts'))

  assert(
    /recordCompanionProgress\(/.test(actions),
    'nothing records progress when a simulation completes',
  )
  assert(
    /from\("session_history"\)[\s\S]{0,200}?\.insert\(/.test(actions),
    'progress is not written to session_history, the table the dashboard reads',
  )

  // The same two columns companion.actions.ts writes, and no others. A third
  // column here would be a schema change to a table this integration does not
  // own.
  const insert = actions.match(/from\("session_history"\)[\s\S]{0,200}?\.insert\(\{([^}]*)\}/)
  assert(insert, 'could not read the session_history insert')
  const columns = insert[1].split(',').map((s) => s.split(':')[0].trim()).filter(Boolean).sort()
  assert(
    columns.join(' ') === 'companion_id user_id',
    `writes ${columns.join(', ')}; companion.actions.ts writes companion_id, user_id`,
  )

  return 'one row in session_history, same shape as a voice session'
})

check('progress is taken from the verified claim, not the cookie', () => {
  const actions = codeOnly(read('apps/lms/lib/actions/simulation.actions.ts'))
  const fn = actions.slice(actions.indexOf('const recordCompanionProgress'))
  const body = fn.slice(0, fn.indexOf('\n};'))

  // /complete is reached from an iframe on another origin. There is no Clerk
  // cookie there, so auth() returns null and every hearing's progress would be
  // dropped without a word.
  assert(!/auth\(\)/.test(body), 'reads auth() on a path that has no Clerk cookie')
  assert(
    /recordCompanionProgress\(\s*[^)]*,\s*userId\s*\)/.test(actions),
    'the verified user id is not what gets passed in',
  )
  return 'userId comes from the token claim'
})

check('a failed journey entry cannot cost a student their mark', () => {
  const actions = codeOnly(read('apps/lms/lib/actions/simulation.actions.ts'))
  const complete = actions.slice(actions.indexOf('const completeSimulationSession'))
  const body = complete.slice(0, complete.indexOf('\n};'))

  // Ordering is the whole guarantee: the result row and the status change are
  // already committed before progress is attempted, and the attempt swallows
  // its own failure. Reversed, a dashboard write would 500 a graded hearing.
  const resultWrite = body.indexOf('simulation_results')
  const statusWrite = body.indexOf('SESSION_STATUS.COMPLETED,')
  const progress = body.indexOf('recordCompanionProgress(')
  assert(resultWrite !== -1 && statusWrite !== -1 && progress !== -1, 'one of the three writes is gone')
  assert(progress > resultWrite, 'progress is recorded before the result is stored')
  assert(progress > statusWrite, 'progress is recorded before the session is closed')

  const fn = actions.slice(actions.indexOf('const recordCompanionProgress'))
  assert(/catch\s*\(/.test(fn.slice(0, fn.indexOf('\n};'))), 'progress failure is left to propagate')
  return 'result → status → progress, and progress cannot throw'
})

check('two posts of one result cannot count twice', () => {
  const actions = codeOnly(read('apps/lms/lib/actions/simulation.actions.ts'))
  const complete = actions.slice(actions.indexOf('const completeSimulationSession'))
  const body = complete.slice(0, complete.indexOf('\n};'))

  // The ALREADY_COMPLETED check reads the status three round-trips before the
  // write, so on its own it does not stop two concurrent posts — both read
  // 'active', both pass. The status write has to be the decision: a
  // compare-and-set that reports whether this call is the one that closed the
  // session, with progress conditional on having won.
  assert(
    /\.neq\("status",\s*SESSION_STATUS\.COMPLETED\)/.test(body),
    'the status write is not a compare-and-set — a double-post closes twice',
  )
  assert(
    /\.select\("id"\)[\s\S]{0,40}maybeSingle\(\)/.test(body),
    'the status write does not report whether it changed anything',
  )

  const lost = body.search(/if \(!closed\) return \{ ok: false, reason: "ALREADY_COMPLETED" \}/)
  const progress = body.indexOf('recordCompanionProgress(')
  assert(lost !== -1, 'losing the race is not handled')
  assert(lost < progress, 'progress is recorded before the race is settled')

  // And the result row itself must stay keyed, so the loser's write is a no-op
  // rather than a second row.
  assert(
    /onConflict:\s*"session_id"/.test(body),
    'simulation_results is no longer keyed on session_id',
  )
  return 'compare-and-set on status; only the winner writes progress'
})

check('progress credits the companion the student actually launched from', () => {
  const actions = codeOnly(read('apps/lms/lib/actions/simulation.actions.ts'))

  // createSimulationSession already resolves `companionId ?? simulation.companionId`
  // and freezes it onto the row. Re-doing that resolution here can only change
  // the answer when the catalogue row was edited mid-session, and then it credits
  // a companion the session has no record of.
  assert(
    /recordCompanionProgress\(\s*session\.companionId\s*,/.test(actions),
    'progress is not taken from the session row',
  )
  assert(
    !/recordCompanionProgress\([^)]*simulation\.companionId/.test(actions),
    'falls back to the catalogue’s companion, which the session may not have used',
  )
  return 'session.companionId, no fallback'
})

check('a simulation with no companion writes no progress row', () => {
  const actions = codeOnly(read('apps/lms/lib/actions/simulation.actions.ts'))
  const fn = actions.slice(actions.indexOf('const recordCompanionProgress'))
  const body = fn.slice(0, fn.indexOf('\n};'))

  // The catalogue allows a hearing that belongs to no companion. Inserting for
  // one would put a null in the column the dashboard joins on.
  const guard = body.indexOf('if (!companionId) return')
  const insert = body.indexOf('.insert(')
  assert(guard !== -1, 'nothing guards against a null companion')
  assert(insert === -1 || guard < insert, 'the guard does not come before the insert')
  return 'null companion → no row'
})

/* ===========================================================================
   7. The launch token itself
   =========================================================================== */

heading('Launch token')

const SECRET = 'a-secret-long-enough-for-the-check'

check('a minted token verifies', () => {
  const token = sign({ sessionId: 's1', userId: 'user_1', kind: 'courtroom', role: 'judge' }, SECRET)
  const result = verify(token, SECRET)
  assert(result.ok, `verify said ${result.error}`)
  assert(result.claims.sessionId === 's1', 'sessionId did not round-trip')
  assert(result.claims.role === 'judge', 'role did not round-trip')
  assert(typeof result.claims.id === 'string' && result.claims.id.length > 10, 'no jti')
  return `jti ${result.claims.id.slice(0, 8)}…`
})

check('a token signed with another secret is refused', () => {
  const token = sign({ sessionId: 's1', userId: 'user_1' }, SECRET)
  const result = verify(token, 'a-different-secret-of-the-same-length')
  assert(!result.ok && result.error === 'BAD_TOKEN', `got ${JSON.stringify(result)}`)
  return 'BAD_TOKEN'
})

check('an edited payload is refused', () => {
  const token = sign({ sessionId: 's1', userId: 'user_1' }, SECRET)
  const [v, payload, sig] = token.split('.')
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  claims.uid = 'user_somebody_else'
  const forged = [v, Buffer.from(JSON.stringify(claims)).toString('base64url'), sig].join('.')
  const result = verify(forged, SECRET)
  assert(!result.ok, 'a re-signed-by-hand payload passed')
  return result.error
})

check('two tokens for the same session have different jtis', () => {
  // The jti is what makes a launch spendable exactly once, so it must be fresh
  // on every mint or a refresh would be indistinguishable from a replay.
  const a = verify(sign({ sessionId: 's1', userId: 'u' }, SECRET), SECRET)
  const b = verify(sign({ sessionId: 's1', userId: 'u' }, SECRET), SECRET)
  assert(a.ok && b.ok, 'a token failed to verify')
  assert(a.claims.id !== b.claims.id, 'two mints produced the same jti')
  return 'fresh per mint'
})

check('an expired token is told apart from a forged one', () => {
  const token = sign({ sessionId: 's1', userId: 'u' }, SECRET, 1)
  const later = Math.floor(Date.now() / 1000) + 30
  const result = verify(token, SECRET, later)
  assert(!result.ok && result.error === 'EXPIRED', `got ${JSON.stringify(result)}`)
  return 'EXPIRED, so the student is told to start again'
})

check('peek cannot be mistaken for verify', () => {
  const forged = ['v1', Buffer.from(JSON.stringify({ sid: 'x', uid: 'admin' })).toString('base64url'), 'nope'].join('.')
  assert(peek(forged).userId === 'admin', 'peek should read an unverified claim — that is its job')
  assert(!verify(forged, SECRET).ok, 'verify accepted a token peek could read')
  return 'peek reads, verify decides'
})

check('a weak secret is refused at signing time', () => {
  let threw = false
  try {
    sign({ sessionId: 's', userId: 'u' }, 'short')
  } catch {
    threw = true
  }
  assert(threw, 'a five-character secret was accepted')
  return '16 characters minimum'
})

/* ===========================================================================
   8. The seam does not leak into places it does not belong
   =========================================================================== */

heading('Boundaries')

check('the engine still has no dependencies', () => {
  const pkg = JSON.parse(read('apps/courtroom-engine/package.json'))
  const deps = Object.keys(pkg.dependencies || {})
  assert(deps.length === 0, `engine now depends on ${deps.join(', ')}`)
  return 'zero dependencies'
})

check('no Prisma crept in alongside Supabase', () => {
  const pkg = JSON.parse(read('apps/lms/package.json'))
  const all = { ...pkg.dependencies, ...pkg.devDependencies }
  const prisma = Object.keys(all).filter((d) => d.includes('prisma'))
  assert(prisma.length === 0, `found ${prisma.join(', ')} — the LMS has one database layer`)
  assert(!existsSync(join(ROOT, 'apps/lms/prisma')), 'apps/lms/prisma exists')
  return 'Supabase only'
})

check('Clerk is still the only login', () => {
  const routes = walk('apps/lms/app/api', ['.ts'])
  const suspicious = routes.filter((f) => /\b(signin|sign-in|login|register)\b/i.test(f))
  assert(suspicious.length === 0, `found auth routes: ${suspicious.join(', ')}`)
  return `${routes.length} API routes, none of them a login`
})

/**
 * The scene apps hold one credential: the launch token Converso minted for this
 * session. This check is the thing README.md promises when it says a Supabase
 * URL, a service-role key, a Clerk secret or a model key in either scene's
 * source fails the build — so the list below has to stay the same length as
 * that sentence. It was narrower than the sentence once, which is how a claim
 * becomes a lie.
 *
 * Scope is `src` plus each app's build config, and deliberately not `tools/`.
 * The distinction is what reaches a browser: `next.config.mjs` and
 * `vite.config.js` can inline an environment variable into a bundle, so they are
 * in; `apps/classroom/tools/verify-ai.mjs` is a Node script a developer runs, and
 * it names `OPENAI_API_KEY` precisely in order to assert its absence.
 *
 * Read through `codeOnly` for the same reason — a comment explaining that this
 * app holds no Gemini key must not be the thing that fails the Gemini check.
 */
check('the heavy apps hold no key of their own', () => {
  const forbidden = [
    [/SERVICE_ROLE/i, 'a Supabase service-role key'],
    [/SUPABASE_URL|SUPABASE_ANON|supabaseUrl|supabaseKey/i, 'a Supabase connection'],
    [/LAUNCH_TOKEN_SECRET/i, 'the token signing secret'],
    [/CLERK_SECRET|CLERK_PUBLISHABLE|clerkSecret/i, 'a Clerk credential'],
    [/GEMINI|GOOGLE_GENERATIVE|VAPI|OPENAI|ANTHROPIC|API_KEY|apiKey/i, 'a model provider key'],

    // The variable-name patterns above only catch a key read from the
    // environment. These two catch one pasted in as a literal, which is the
    // version that actually ships. Both need a length and a word boundary:
    // `sk-` unanchored matches the middle of `task-force`, and three characters
    // of base64 matches half the English language.
    [/\bsk-[A-Za-z0-9_-]{20,}/, 'a provider key pasted as a literal'],
    [/\beyJ[A-Za-z0-9_-]{20,}\./, 'a JWT pasted as a literal'],
  ]

  let scanned = 0
  for (const app of ['apps/courtroom', 'apps/classroom']) {
    const files = [
      ...walk(`${app}/src`, ['.js', '.jsx', '.mjs', '.ts', '.tsx']),
      `${app}/next.config.mjs`,
      `${app}/vite.config.js`,
      `${app}/index.html`,
    ]
    for (const file of files) {
      if (!existsSync(join(ROOT, file))) continue
      scanned += 1
      const source = codeOnly(read(file))
      for (const [pattern, what] of forbidden) {
        assert(!pattern.test(source), `${file} references ${what}, which belongs to the LMS`)
      }
    }
  }
  return `${scanned} files, none holding more than a launch token`
})

/* ===========================================================================
   The courtroom's launch wiring

   These read source rather than run it, because the things they check are all
   orderings and absences — which import exists, which panel is gated, what a
   component does not contain. A test that ran the app would need a browser and
   a GPU; a test that reads it catches the same regressions in 40 ms.
   =========================================================================== */

heading('The courtroom knows it was launched')

const APP = 'apps/courtroom/src/App.jsx'
const HOOK = 'apps/courtroom/src/session/useLaunchedSession.js'
const GATE = 'apps/courtroom/src/ui/LaunchGate.jsx'

check('App calls the session hook and gates the scene on it', () => {
  const source = read(APP)
  assert(/from '\.\/session\/useLaunchedSession'/.test(source), 'App does not import the hook')
  assert(/useLaunchedSession\(\)/.test(source), 'App imports the hook but never calls it')

  // The gate has to come before the Canvas in the source, not just exist. This
  // is the whole reason selective loading works: a Canvas that has mounted has
  // already begun fetching whatever the registry said at mount time.
  const code = codeOnly(source)
  const gate = code.indexOf('session.ready')
  const canvas = code.indexOf('<CourtroomScene')
  assert(gate > -1, 'App never checks session.ready')
  assert(canvas > -1, 'App no longer renders the scene')
  assert(gate < canvas, 'the scene is rendered before the launch has landed')
  return 'ready gate precedes <CourtroomScene />'
})

check('the hook returns exactly what App reads off it', () => {
  const hook = read(HOOK)
  const app = read(APP)

  // Everything App pulls off the hook's result.
  const used = [...app.matchAll(/session\.([a-zA-Z]+)/g)].map((m) => m[1])
  assert(used.length > 0, 'App reads nothing from the session')

  const returned = hook.slice(hook.lastIndexOf('return {'))
  for (const key of new Set(used)) {
    assert(new RegExp(`(^|[\\s,{])${key}[,:\\s]`, 'm').test(returned),
      `App reads session.${key} and the hook does not return it`)
  }
  return [...new Set(used)].sort().join(', ')
})

check('the two commands the hook sends are the two the seat screen sends', () => {
  const hook = read(HOOK)
  const seat = read('apps/courtroom/src/ui/RoleSelect.jsx')

  // If RoleSelect ever starts a hearing differently, a launched hearing would
  // start differently from a standalone one and only one of them would be the
  // tested path. The names are compared rather than the calls, because that is
  // the part that has to agree.
  for (const command of ['SET_HUMAN_ROLE', 'START']) {
    assert(hook.includes(command), `the hook does not send ${command}`)
    assert(seat.includes(command), `RoleSelect no longer sends ${command} — the hook is now guessing`)
  }
  const code = codeOnly(hook)
  const role = code.indexOf('SET_HUMAN_ROLE')
  const start = code.indexOf("{ type: 'START' }")
  assert(role > -1 && start > role, 'START is sent before the seat is taken')
  return 'SET_HUMAN_ROLE then START'
})

check('the hook holds no courtroom rule', () => {
  const hook = read(HOOK)
  // The seat is Converso's to decide and the trial's legality is the engine's.
  // A rule here would be a third opinion, and the one nobody tested.
  for (const word of ['OBJECTION', 'SUSTAIN', 'OVERRULE', 'validateDecision']) {
    assert(!hook.includes(word), `the hook mentions ${word}, which is the engine's business`)
  }
  assert(!/PHASES\./.test(hook), 'the hook reasons about phases beyond the one it waits for')
  return 'it decides when, and nothing else'
})

check('the seat screen and the turn panel were left alone', () => {
  // The standing rule: no legality lives in either of these, and nothing about
  // sessions was added to them. The hook dismisses the seat screen from outside.
  for (const file of ['apps/courtroom/src/ui/RoleSelect.jsx', 'apps/courtroom/src/ui/TurnPanel.jsx']) {
    const source = read(file)
    assert(!/useLaunchedSession|useSessionStore|launchTarget/.test(source),
      `${file} now knows about sessions`)
  }
  return 'RoleSelect.jsx and TurnPanel.jsx untouched'
})

check('a launched hearing does not offer the developer\'s tools', () => {
  const app = read(APP)
  assert(/session\.launched \? null : <RoleSelect \/>/.test(app),
    'the seat screen is still shown to a student Converso already seated')
  assert(/enabled: !session\.launched/.test(app),
    'the debug keyboard is still live in a graded hearing')

  // And the option it passes has to be one the hook actually honours.
  const keys = read('apps/courtroom/src/debug/useDebugControls.js')
  assert(/enabled = true/.test(keys), 'useDebugControls ignores `enabled`')
  assert(/if \(!enabled\) return/.test(keys), 'useDebugControls accepts `enabled` but does not act on it')
  return 'seat screen, control panel and keyboard all standalone-only'
})

heading('What a refusal says')

check('the gate prints the message it was given and invents none', () => {
  const gate = read(GATE)
  assert(/refusal\?\.message/.test(gate), 'the gate does not show the refusal message')

  // Every sentence a student can be shown is written once, in the contract. A
  // sentence hard-coded here is a second source of truth for the same fact.
  for (const text of Object.values(LAUNCH_ERROR_TEXT)) {
    assert(!gate.includes(text),
      'the gate hard-codes a sentence that already lives in LAUNCH_ERROR_TEXT')
  }
  return `${Object.keys(LAUNCH_ERROR_TEXT).length} refusals, none of them reworded`
})

check('retry is offered only for a refusal that could succeed twice', () => {
  const hook = read(HOOK)
  const retryable = hook.match(/RETRYABLE = new Set\(\[([^\]]*)\]\)/)
  assert(retryable, 'the hook no longer says which refusals are retryable')

  const codes = [...retryable[1].matchAll(/'([A-Z_]+)'/g)].map((m) => m[1])
  assert(codes.length > 0, 'nothing is retryable, so the button can never appear')

  // A launch token is spent on its first exchange. Re-sending a token that was
  // rejected as expired or already used fails identically every time, so a
  // Retry button on one of those is a button that lies.
  for (const spent of ['EXPIRED', 'BAD_TOKEN', 'NO_TOKEN', 'ALREADY_COMPLETED', 'WRONG_USER']) {
    assert(!codes.includes(spent), `${spent} offers a retry that cannot work`)
  }
  return codes.join(', ')
})

heading('Handing the student back')

check('the courtroom asks the lesson to close it, at a real origin', () => {
  const hook = read(HOOK)
  assert(/RETURN_TO_LESSON/.test(hook), 'the courtroom cannot ask to be put away')
  assert(/postMessage\(/.test(hook), 'it tries to navigate rather than ask')
  assert(/launchTarget/.test(hook), 'the message is not aimed at the configured origin')
  assert(!/postMessage\([^)]*'\*'/.test(hook),
    "the message is sent to '*', which is readable by whoever framed this")
  return "targeted at launchTarget, never '*'"
})

check('the LMS listens for it, and checks who sent it', () => {
  const stage = read('apps/lms/components/workspace/SpatialStage.tsx')
  assert(/addEventListener\("message"/.test(stage), 'nothing listens for the message')
  assert(/FRAME_MESSAGES\.RETURN_TO_LESSON/.test(stage),
    'the listener does not handle the message')

  // Three checks, and the first is the one that cannot be forged.
  assert(/event\.source !== frame\.current\?\.contentWindow/.test(stage),
    'the listener does not check the message came from the frame it mounted')
  assert(/event\.origin !== expected/.test(stage), 'the listener does not check the origin')

  // The tag is checked against the contract's list rather than one hard-coded
  // name, because two scenes send this message. A listener that knew only the
  // courtroom's tag would ignore the classroom's button and leave the student
  // stuck in the frame.
  assert(/SIMULATION_FRAME_SOURCES\.includes\(/.test(stage),
    'the listener does not check the source tag against the contract')
  for (const tag of SIMULATION_FRAME_SOURCES) {
    assert(!stage.includes(`"${tag}"`),
      `the listener hard-codes the tag "${tag}" instead of reading the contract`)
  }

  // And it must not mark the hearing finished: a button press is not a verdict.
  const handler = stage.slice(stage.indexOf('RETURN_TO_LESSON'))
  assert(!/\/complete/.test(handler.slice(0, 600)),
    'returning to the lesson reports a completed hearing')
  return `source, origin and ${SIMULATION_FRAME_SOURCES.length} accepted tags all checked`
})

check('the two sides agree on the message they are sending', () => {
  const stage = read('apps/lms/components/workspace/SpatialStage.tsx')
  const scenes = {
    [SIMULATION_KIND.COURTROOM]: read(HOOK),
    [SIMULATION_KIND.CLASSROOM]: read('apps/classroom/src/session/useClassroomSession.js'),
  }

  /*
   * Both halves of a protocol with exactly one message in it.
   *
   * This used to compare string literals on each side. It stopped being the
   * right check the moment a second scene started sending the same message:
   * the tag and the type moved into the contract, and what matters now is that
   * nobody has quietly gone back to writing their own copy. So each scene must
   * import the constants and index them by its own kind, and none of the three
   * files may contain the literal at all.
   */
  for (const [kind, source] of Object.entries(scenes)) {
    assert(/from ['"]@converso\/contracts['"]/.test(source),
      `the ${kind} scene does not read the frame protocol from the contract`)
    assert(source.includes(`FRAME_SOURCE[SIMULATION_KIND.${kind.toUpperCase()}]`),
      `the ${kind} scene does not tag itself with FRAME_SOURCE[${kind.toUpperCase()}]`)
    assert(/FRAME_MESSAGES\.RETURN_TO_LESSON/.test(source),
      `the ${kind} scene does not send the contract's message type`)
    assert(!source.includes(`'${FRAME_SOURCE[kind]}'`) &&
           !source.includes(`"${FRAME_SOURCE[kind]}"`),
      `the ${kind} scene still hard-codes its own tag`)
  }

  // The tags have to be distinct and non-empty, or the listener cannot tell the
  // two rooms apart and an empty tag would match a message from nothing.
  const tags = Object.values(FRAME_SOURCE)
  assert(new Set(tags).size === tags.length, 'two scenes share one frame tag')
  for (const tag of tags) assert(tag && tag.length > 3, `"${tag}" is not a usable frame tag`)
  assert(SIMULATION_FRAME_SOURCES.length === SIMULATION_KIND_LIST.length,
    'a simulation kind has no frame tag, so its scene cannot be recognised')

  // Byte-identical to what the courtroom sent before the tag moved, so an
  // already-deployed courtroom build still talks to this listener.
  assert(FRAME_SOURCE[SIMULATION_KIND.COURTROOM] === 'converso-courtroom',
    "the courtroom's tag changed value, which breaks any build already shipped")
  assert(stage.includes('SIMULATION_FRAME_SOURCES'), 'the host does not read the tag list')
  return tags.join(', ')
})

heading('When the court goes quiet')

const SOCKET = 'apps/courtroom/src/state/useCourtSocket.js'
const EVENTS = 'apps/courtroom/src/state/courtEvents.js'

check('a dropped socket never rebuilds the scene', () => {
  // The whole point. The room is 105 MB; remounting the Canvas to recover from a
  // network blip would mean re-downloading it, and on a slow connection the
  // recovery would take longer than the outage. So nothing in the render path is
  // allowed to depend on the connection.
  for (const file of [
    'apps/courtroom/src/three/CourtroomScene.jsx',
    'apps/courtroom/src/three/Courtroom.jsx',
    'apps/courtroom/src/three/CharacterController.jsx',
  ]) {
    assert(!/\bconnection\b/.test(codeOnly(read(file))),
      `${file} reads the connection state, so a drop can reach the scene`)
  }

  // And App must render the scene unconditionally once the launch has landed —
  // not behind a connection check, and never with the connection in a key.
  const app = codeOnly(read(APP))
  const scene = app.slice(app.indexOf('<CourtroomScene'))
  assert(/^<CourtroomScene \/>/.test(scene.trim()), 'the scene now takes props or a key')
  assert(!/connection[^\n]*\?[^\n]*<CourtroomScene/.test(app),
    'the scene is rendered conditionally on the connection')
  return 'the Canvas cannot see the socket'
})

check('the socket parks the presentation on a drop and lifts it on reconnect', () => {
  const source = read(SOCKET)
  assert(/holdPresentation|hold\(\)/.test(source), 'a drop does nothing to what is on screen')

  const code = codeOnly(source)
  // Parked in both ways a connection can fail: a close, and a constructor throw.
  const closeBlock = code.slice(code.indexOf('ws.onclose'))
  assert(/hold\(\)/.test(closeBlock.slice(0, 400)), 'onclose does not park the court')
  assert(/setConnection\('error'\)[\s\S]{0,120}hold\(\)/.test(code),
    'a socket that would not open leaves the court running')

  const openBlock = code.slice(code.indexOf('ws.onopen'))
  assert(/release\(\)/.test(openBlock.slice(0, 900)), 'a reconnect never lifts the pause')

  // HOLD has to reach the engine before the screen comes back, or the court can
  // open while the client is still catching up.
  const holdSent = openBlock.indexOf("type: 'HOLD'")
  const released = openBlock.indexOf('release()')
  assert(holdSent > -1 && released > holdSent, 'the screen is released before the court is held')
  return 'parked on close and on error, lifted after HOLD'
})

check('nothing is parked before there is a hearing to park', () => {
  // A courtroom opened with no engine running has lost nothing, and starting it
  // behind a "reconnecting" notice would be describing a failure that did not
  // happen. The guard is the presence of a court snapshot.
  const code = codeOnly(read(SOCKET))
  const guard = code.slice(code.indexOf('const hold ='), code.indexOf('const release ='))
  assert(/court/.test(guard), 'hold() fires with no hearing under way')
  assert(/held\.current/.test(guard), 'hold() can park the same outage twice')
  return 'guarded on a live court, once per outage'
})

check('parking stops everything a drop would otherwise leave running', () => {
  const source = read(EVENTS)
  const hold = source.slice(source.indexOf('export function holdPresentation'))
  const body = hold.slice(0, hold.indexOf('\n}'))

  // Three things outlive a drop if nothing stops them: a local composite playing
  // beats for a passage the engine has moved past, a character frozen in a
  // one-shot gesture, and a streaming flag on a line that will never finish.
  assert(/cancelSequence\(\)/.test(body), 'a local sequence keeps playing after the drop')
  assert(/releasePose\(/.test(body), 'characters stay frozen in a held pose')
  assert(/streaming: false/.test(body), 'a half-streamed line keeps streaming for ever')
  assert(/paused: true/.test(body), 'the dialogue is not shown as paused')
  return 'sequence, poses, streaming flag'
})

check('coming back does not replay from memory', () => {
  const source = read(EVENTS)
  const release = source.slice(source.indexOf('export function releasePresentation'))
  const body = release.slice(0, release.indexOf('\n}'))

  // The server's first two messages on any connection are the full snapshot, so
  // the record, the phase and an open question are all restored from the
  // engine's own copy. Text put back on screen here would be a second account of
  // the same hearing, reconstructed locally, and the wrong one.
  assert(!/\btext:/.test(body), 'the reconnect writes dialogue text from local memory')
  assert(!/speaker:/.test(body), 'the reconnect decides who was speaking')
  assert(/paused: false/.test(body), 'the pause is never actually lifted')
  return 'lifts the pause, narrates nothing'
})

check('the engine already re-sends what a reconnecting client needs', () => {
  // The claim the release above rests on. If the server ever stops sending the
  // snapshot on connect, a reconnect becomes a client with a blank record and
  // this design stops working — so it is asserted rather than assumed.
  const server = read('apps/courtroom-engine/server/index.js')
  const onConnect = server.slice(server.indexOf('sockets.add(socket)'))
  const head = onConnect.slice(0, 700)
  assert(/type: "STATE"/.test(head), 'the server no longer sends a snapshot on connect')
  assert(/trial\.snapshot\(\)/.test(head), 'the trial snapshot is not sent on connect')

  // And the client has to read the seat back out of it, or a student who dropped
  // during their own turn reconnects with no question on screen and a court that
  // is waiting for them.
  const events = read(EVENTS)
  assert(/e\.court\?\.human/.test(events), 'the client cannot recover an open question')
  return 'snapshot on connect, seat restored from it'
})

/* ===========================================================================
   Giving the room back
   =========================================================================== */

heading('Giving the room back')

const DISPOSE = 'apps/courtroom/src/three/dispose.js'
const MANAGER = 'apps/courtroom/src/state/animationManager.js'
const SCENE = 'apps/courtroom/src/three/CourtroomScene.jsx'

check('teardown runs from above the Canvas', () => {
  // React runs a parent's cleanup before it detaches the children, so an unmount
  // effect in App still sees a full scene. The same effect inside the Canvas
  // would run after R3F had emptied it and would free nothing, silently.
  const app = codeOnly(read(APP))
  assert(/disposeCourtroom/.test(app), 'App no longer disposes the scene on unmount')
  assert(
    app.indexOf('disposeCourtroom()') < app.indexOf('<CourtroomScene'),
    'the teardown effect has moved below the Canvas',
  )
  const scene = codeOnly(read(SCENE))
  assert(!/disposeCourtroom/.test(scene), 'the scene disposes itself, which runs too late')
  return 'App unmount, before the children detach'
})

check('the scene is captured once, and not through the store', () => {
  const scene = codeOnly(read(SCENE))
  assert(/onCreated=\{\(\{ scene \}\) => captureScene\(scene\)\}/.test(scene),
    'the Canvas no longer hands the scene to the teardown')
  const store = codeOnly(read('apps/courtroom/src/state/useCourtStore.js'))
  // A live three.js object in zustand re-renders every subscriber when it
  // changes and invites a read during a render pass.
  assert(!/\bscene\b/.test(store), 'the store now holds the three.js scene')
  return 'captured in a module, not in state'
})

check('the renderer is left to R3F', () => {
  // R3F disposes the WebGL context on Canvas unmount, forced context loss and
  // all. Disposing it here too would be doing it out of order with R3F's own
  // teardown, which is how a clean exit becomes an exception.
  const source = codeOnly(read(DISPOSE))
  assert(!/forceContextLoss/.test(source), 'the teardown forces context loss itself')
  assert(!/renderer\.dispose|gl\.dispose/.test(source), 'the teardown disposes the renderer')
  return 'no second teardown of the context'
})

check('animation stops before geometry is freed', () => {
  // A mixer updating a skeleton whose buffers have been disposed is a crash, not
  // a leak. Order is the whole point of this function.
  const source = read(DISPOSE)
  const body = source.slice(source.indexOf('export function disposeCourtroom'))
  const stop = body.indexOf('releaseCharacters()')
  const free = body.indexOf('.geometry.dispose()')
  assert(stop !== -1, 'the teardown no longer stops the characters')
  assert(free !== -1, 'the teardown no longer disposes geometry')
  assert(stop < free, 'geometry is freed before the mixers are stopped')
  return 'mixers, then buffers'
})

check('the model cache is cleared for every model, not just the cast', () => {
  const source = read(DISPOSE)
  assert(/useGLTF\.clear\(/.test(source), 'drei keeps every parsed GLB it has seen')
  // Read from the registry, not from what happens to be on screen: a cast
  // narrowed for one case leaves an earlier, wider case's models behind.
  assert(/ROLE_ORDER/.test(source), 'the cache is cleared from the live cast')
  assert(!/activeRoles/.test(source), 'the cache is cleared from the narrowed cast')
  assert(/COURTROOM_MODEL/.test(source), 'the room itself is left in the cache')
  return 'every path in the registry'
})

check('the manager lets go of its registry', () => {
  const source = read(MANAGER)
  assert(/export function releaseCharacters/.test(source), 'nothing clears the character registry')
  const body = source.slice(source.indexOf('export function releaseCharacters'))
  const end = body.indexOf('\n}')
  const inner = body.slice(0, end)
  // Timers first, or a sequence in flight calls play() on a character that is
  // already half gone.
  assert(inner.indexOf('cancelSequence()') < inner.indexOf('controllers.clear()'),
    'a running sequence can outlive the characters it drives')
  for (const collection of ['controllers.clear()', 'warned.clear()', 'listeners.clear()']) {
    assert(inner.includes(collection), `${collection} is missing, so that map outlives the scene`)
  }
  return 'controllers, warnings and listeners'
})

check('the console handles do not outlive the app', () => {
  const source = read(DISPOSE)
  // Each of these is a reference to a whole subsystem. Left on window, they keep
  // the event system and the animation registry alive on their own.
  for (const handle of ['window.courtAnim', 'window.courtEvents', 'window.courtMock']) {
    assert(source.includes(`delete ${handle}`), `${handle} survives teardown`)
  }
  return 'courtAnim, courtEvents, courtMock'
})

/* ===========================================================================
   The classroom knows it was launched
   ---------------------------------------------------------------------------
   The same seam as the courtroom's, in a framework that does not allow the same
   code. The courtroom is a Vite SPA and may read `window` the moment its modules
   evaluate; the classroom is a Next app whose modules also evaluate on the
   server, during prerender, where there is no `window` and no `import.meta.env`.

   Every check below is either that difference being respected, or the privacy
   property this app had before the integration still holding: the questions and
   the answers are generated by Ollama on the student's own machine, and what
   crosses the wire is counts.
   =========================================================================== */

heading('The classroom knows it was launched')

const CLASS_LAUNCH = 'apps/classroom/src/session/launch.js'
const CLASS_HOOK = 'apps/classroom/src/session/useClassroomSession.js'
const CLASS_GATE = 'apps/classroom/src/components/LessonGate.jsx'
const CLASS_STORE = 'apps/classroom/src/hooks/useAITeacher.js'
const CLASS_ROOM = 'apps/classroom/src/components/Experience.jsx'

check('nothing touches window while the module is evaluating', () => {
  const source = read(CLASS_LAUNCH)
  const code = codeOnly(source)

  // The courtroom reads the query string at module scope, which is correct for a
  // Vite SPA and a build-time crash in Next: this module is evaluated on the
  // server too. Everything that needs a browser must sit inside a function.
  const top = code.slice(0, code.indexOf('function params'))
  assert(!/window\.|document\./.test(top),
    'a browser global is read before any function is called, which breaks prerender')
  assert(/typeof window === "undefined"/.test(code),
    'the module never checks whether it is running on the server')
  assert(/export function isLaunched\(/.test(code),
    'isLaunched is not a function, so its answer is fixed at import time')
  return 'query string read lazily, guarded on the server'
})

check('the Converso origin is a build-time variable Next can inline', () => {
  const code = codeOnly(read(CLASS_LAUNCH))

  // Written as a literal member expression on purpose. Next replaces exactly
  // `process.env.NEXT_PUBLIC_*` in client code; a destructured or computed read
  // survives the build as `undefined`.
  assert(/process\.env\.NEXT_PUBLIC_CONVERSO_URL/.test(code),
    'the origin does not come from an inlinable NEXT_PUBLIC variable')
  assert(!/import\.meta\.env/.test(code),
    'a Vite env read was carried over, and it is undefined in Next')

  // And the origin must never come from the page that framed this one, or that
  // page could name its own server and be handed the student's token.
  assert(!/searchParams\.get\(['"]origin|query\.get\(['"](origin|converso)/.test(code),
    'the callback origin can be named by whoever framed this page')
  return 'NEXT_PUBLIC_CONVERSO_URL, then referrer, then own origin'
})

check('the classroom holds no key of its own', () => {
  for (const rel of [CLASS_LAUNCH, CLASS_HOOK, CLASS_GATE, CLASS_STORE]) {
    const source = read(rel)
    for (const secret of ['SERVICE_ROLE', 'LAUNCH_TOKEN_SECRET', 'CLERK_SECRET', 'SUPABASE_URL']) {
      assert(!source.includes(secret), `${rel} references ${secret}`)
    }
    // No second login. The token Converso minted is the whole credential.
    assert(!/@clerk\/|createClient\(/.test(source), `${rel} builds its own auth or database client`)
  }
  return 'a launch token and nothing else'
})

check('the room waits for the handshake before it downloads itself', () => {
  const code = codeOnly(read(CLASS_ROOM))
  assert(/useClassroomSession\(\)/.test(code), 'the room never opens its session')

  // Returning the gate before the Canvas is the point. A student whose session
  // was refused should be told so rather than handed two GLBs and a lesson that
  // cannot be scored.
  const gate = code.indexOf('session.ready')
  const canvas = code.indexOf('<Canvas')
  assert(gate !== -1, 'the room no longer checks whether the session is ready')
  assert(gate < canvas, 'the gate has moved below the Canvas, so the room loads anyway')

  // And the hook is called before that return, because it is a hook.
  assert(code.indexOf('useClassroomSession()') < gate,
    'the session hook is called after a conditional return')
  return 'gate first, Canvas second'
})

check('a standalone classroom reports nothing', () => {
  const launchCode = codeOnly(read(CLASS_LAUNCH))

  // Every outbound call is behind the same question. `npm run dev` with no query
  // string must behave exactly as it did before the integration existed.
  for (const fn of ['announceRoom', 'noteExchange', 'reportProgress', 'reportComplete', 'reportAbandoned']) {
    const at = launchCode.indexOf(`function ${fn}`)
    assert(at !== -1, `${fn} is gone`)
    const body = launchCode.slice(at, at + 400)
    assert(/if \(!isLaunched\(\)/.test(body), `${fn} posts to Converso even when standalone`)
  }

  // And the control that ends a lesson is only rendered for a launched one.
  assert(/session\.launched \? \(/.test(read(CLASS_ROOM)),
    'the End lesson control is shown to a standalone classroom')
  return '5 reporters gated, End lesson gated'
})

check('the room announces a language and register the route will accept', () => {
  // Three files have to agree on two vocabularies, and none of them validates
  // the other at runtime: the store sends what the board picked, and the route
  // checks it against the contract. If they drift the student gets a 400 in the
  // middle of a lesson.
  const langs = read('apps/classroom/src/lib/languages.mjs')
  const codes = langs.match(/export const LANGUAGE_CODES = \[([^\]]*)\]/)
  assert(codes, 'the classroom no longer publishes its language list')
  const list = [...codes[1].matchAll(/"([a-z]{2})"/g)].map((m) => m[1])
  sameSet(list, CLASSROOM_LANGUAGES, 'classroom LANGUAGE_CODES vs CLASSROOM_LANGUAGES')

  // `speech` is this app's name for the register and goes across the wire
  // untouched, so every language must offer exactly the two the contract lists.
  const perLanguage = langs.split(/\n  [a-z]{2}: \{/).slice(1)
  assert(perLanguage.length === list.length,
    `found ${perLanguage.length} language entries for ${list.length} codes`)
  for (let i = 0; i < perLanguage.length; i += 1) {
    const ids = [...perLanguage[i].matchAll(/id: "([a-z]+)"/g)].map((m) => m[1])
    sameSet(ids, CLASSROOM_REGISTERS, `${list[i]} speechModes vs CLASSROOM_REGISTERS`)
  }
  return `${list.length} languages × ${CLASSROOM_REGISTERS.join('/')}`
})

check('an exchange is counted, and the sentence is not sent', () => {
  const launchCode = codeOnly(read(CLASS_LAUNCH))
  const at = launchCode.indexOf('function noteExchange')
  const body = launchCode.slice(at, at + 400)

  // The model's name, so an instructor can tell a 3B answer from a 14B one. Not
  // the question, and not the answer: those were generated on the student's own
  // machine and that is where they stay.
  assert(/event: "exchange"/.test(body), 'the exchange is not marked as one')
  assert(/model/.test(body), 'the model name is not recorded')
  for (const leak of ['question', 'answer', 'translation', 'messages']) {
    assert(!new RegExp(`\\b${leak}\\b`).test(body), `noteExchange sends the ${leak}`)
  }

  // The route this lands on counts and upserts; it never takes a score.
  const route = read('apps/lms/app/api/classroom/session/route.ts')
  assert(/noteClassroomExchange/.test(route), 'the route no longer counts exchanges')
  assert(!/\bscore\b/.test(route), 'the classroom route accepts a score from the browser')
  return 'event and model only'
})

check('the bookmark stays inside what /progress will store', () => {
  const hook = codeOnly(read(CLASS_HOOK))
  const calls = [...hook.matchAll(/reportProgress\(\{([^}]*)\}/g)].map((m) => m[1])
  assert(calls.length > 0, 'the lesson never bookmarks itself')

  // The route whitelists turn, phase and camera and drops everything else,
  // because metadata is a jsonb column and an unbounded object from a browser is
  // an unbounded row. Sending more is not dangerous, it is just a lie in the
  // source about what gets saved.
  const ALLOWED = new Set(['turn', 'phase', 'camera'])
  for (const call of calls) {
    for (const key of [...call.matchAll(/(\w+):/g)].map((m) => m[1])) {
      assert(ALLOWED.has(key), `the lesson bookmarks "${key}", which /progress discards`)
    }
  }
  return `${calls.length} calls, turn and phase only`
})

check('the result is counts, and Converso does the scoring', () => {
  const hook = codeOnly(read(CLASS_HOOK))
  const at = hook.indexOf('reportComplete({')
  assert(at !== -1, 'the lesson never reports a result')
  const payload = hook.slice(at, hook.indexOf('})', at))

  for (const field of ['language', 'register', 'questionsAsked', 'phrasesPractised', 'duration', 'completed']) {
    assert(payload.includes(field), `the result does not report ${field}`)
  }
  // The one thing it must not send. A browser can be told to say anything, so
  // the score is re-derived server-side from the counts.
  assert(!/\bscore\b/.test(payload), 'the browser sends its own score')

  // And the server does re-derive it, from exactly these numbers.
  const scored = normalizeClassroomResult({
    language: 'ja', register: 'formal', questionsAsked: 10, phrasesPractised: 10,
    duration: 600, completed: true, score: 100,
  })
  assert(scored.score === scoreClassroom({
    questionsAsked: 10, phrasesPractised: 10, duration: 600, completed: true,
  }), 'the server does not recompute the classroom score')
  return `reported counts → score ${scored.score}`
})

check('practice is a replay, not the answer arriving', () => {
  const store = read(CLASS_STORE)
  assert(/questionsAsked: 0/.test(store) && /phrasesPractised: 0/.test(store),
    'the store no longer keeps the two counts')

  // askAI speaks every answer the moment it lands — it calls playMessage itself —
  // so counting each playback would score the student twice for asking and never
  // once for practising. The count must sit behind the per-message flag.
  const play = store.slice(store.indexOf('playMessage: async'))
  assert(/if \(message\.played\)/.test(play),
    'phrasesPractised counts the first playback, which askAI triggers itself')
  const guard = play.indexOf('if (message.played)')
  const bump = play.indexOf('phrasesPractised: state.phrasesPractised + 1')
  assert(bump > guard, 'the practice count is incremented outside the replay guard')

  // The question is counted where the answer landed, not where it was asked: a
  // question the teacher never answered is one the student did not get to ask.
  const ask = store.slice(store.indexOf('askAI: async'), store.indexOf('playMessage: async'))
  const bumpQ = ask.indexOf('questionsAsked: state.questionsAsked + 1')
  assert(bumpQ !== -1, 'questions are not counted in askAI')
  assert(bumpQ > ask.indexOf('message.answer = data'),
    'a question is counted before the teacher answered it')
  return 'questions on answer, phrases on replay'
})

check('the lesson gate prints the message it was given and invents none', () => {
  const gate = read(CLASS_GATE)
  assert(/refusal\?\.message/.test(gate), 'the gate does not show the refusal message')
  for (const text of Object.values(LAUNCH_ERROR_TEXT)) {
    assert(!gate.includes(text),
      'the lesson gate hard-codes a sentence that already lives in LAUNCH_ERROR_TEXT')
  }
  // Same rule as the courtroom's: only a Converso that did not answer is worth
  // asking twice, because the token was spent on the first exchange.
  const hook = read(CLASS_HOOK)
  const retryable = hook.match(/RETRYABLE = new Set\(\[([^\]]*)\]\)/)
  assert(retryable, 'the classroom no longer says which refusals are retryable')
  for (const spent of ['EXPIRED', 'BAD_TOKEN', 'NO_TOKEN', 'ALREADY_COMPLETED', 'WRONG_USER']) {
    assert(!retryable[1].includes(spent), `${spent} offers a retry that cannot work`)
  }
  return `${Object.keys(LAUNCH_ERROR_TEXT).length} refusals, none reworded`
})

check('leaving early is an abandonment, and ending properly is not', () => {
  const hook = codeOnly(read(CLASS_HOOK))

  // pagehide rather than beforeunload: it fires for a discarded tab and for a
  // page entering the back-forward cache, and it does not block the unload.
  assert(/addEventListener\("pagehide"/.test(hook), 'nothing notices the student leaving')
  assert(!/beforeunload/.test(hook), 'beforeunload misses a tab being discarded')
  assert(/reportAbandoned\(\)/.test(hook), 'leaving reports nothing')

  // The order that matters: reportAbandoned must decline once a result has been
  // sent, or ending a lesson and then unmounting overwrites the result.
  const launchCode = codeOnly(read(CLASS_LAUNCH))
  const at = launchCode.indexOf('function reportAbandoned')
  assert(/if \(!isLaunched\(\) \|\| completed\)/.test(launchCode.slice(at, at + 200)),
    'an abandonment can overwrite a reported result')

  // And a lesson can only be reported once.
  const complete = launchCode.indexOf('function reportComplete')
  assert(/if \(!isLaunched\(\) \|\| completed\)/.test(launchCode.slice(complete, complete + 200)),
    'a lesson can be completed twice')
  return 'pagehide beacon, declined after a result'
})

/* ===========================================================================
   The courtroom wears the suite's look
   ---------------------------------------------------------------------------
   A shared design system is only shared while nobody keeps a private copy of
   a colour. The courtroom's stylesheet used to hold a complete palette of its
   own — rosewood, brass, marble — and re-pointing it at @converso/night-desk
   is the sort of change that decays quietly: the next person adding a panel
   reaches for the nearest hex, and a year later there are two design systems
   again and one of them is undocumented.

   So these checks are about ownership rather than taste. They do not care
   whether a border is --edge or --edge-lit. They care that the value came from
   the pack, that the pack's three standing prohibitions are still honoured,
   and that every nd- class the courtroom names actually exists — a typo in a
   class name is invisible in a browser and unfindable by eye.
   =========================================================================== */

heading('The courtroom wears the suite’s look')

const CSS = 'apps/courtroom/src/styles.css'
const PACK = 'packages/night-desk/night-desk.css'
const PACK_IMMERSIVE = 'packages/night-desk/immersive.css'
const COURT_UI = [
  'apps/courtroom/src/App.jsx',
  'apps/courtroom/src/ui/ConnectionNotice.jsx',
  'apps/courtroom/src/ui/Cutscene.jsx',
  'apps/courtroom/src/ui/DialogueBar.jsx',
  'apps/courtroom/src/ui/LaunchGate.jsx',
  'apps/courtroom/src/ui/LoadingScreen.jsx',
  'apps/courtroom/src/ui/RoleSelect.jsx',
  'apps/courtroom/src/ui/SeatingPlan.jsx',
  'apps/courtroom/src/ui/TranscriptPanel.jsx',
  'apps/courtroom/src/ui/TurnPanel.jsx',
]

check('the pack is loaded first, so the app can still override it', () => {
  const main = read('apps/courtroom/src/main.jsx')
  const pack = main.indexOf('@converso/night-desk')
  const own = main.indexOf("'./styles.css'")
  assert(pack !== -1, 'the courtroom does not import the shared look at all')
  assert(own !== -1, 'the courtroom no longer imports its own stylesheet')
  assert(pack < own, 'styles.css is imported before the pack, so the pack wins every conflict')
  return 'night-desk.css, then styles.css'
})

check('the old palette is gone, names and values alike', () => {
  const css = read(CSS)

  // The variable names. A leftover --brass would still resolve inside this
  // file and look deliberate.
  for (const name of ['--wood', '--wood-deep', '--wood-lit', '--brass', '--brass-lit',
    '--brass-dim', '--ivory', '--ivory-dim', '--saffron', '--green',
    '--serif', '--sans', '--mono']) {
    assert(!css.includes(`var(${name})`), `the courtroom still reads ${name}`)
    assert(!new RegExp(`^\\s*\\${name}:`, 'm').test(css), `the courtroom still defines ${name}`)
  }

  // And the values, which is the check that actually bites: a hex nobody named
  // is how a private palette grows back.
  const body = css.slice(css.indexOf('\n}', css.indexOf(':root {')))
  const hexes = body.match(/#[0-9a-fA-F]{3,8}\b/g) || []
  assert(hexes.length === 0, `${hexes.length} raw colours outside :root — ${[...new Set(hexes)].join(', ')}`)
  const rgbas = body.match(/rgba?\([^)]*\)/g) || []
  assert(rgbas.length === 0, `${rgbas.length} raw rgba outside :root — ${[...new Set(rgbas)].join(', ')}`)
  return 'no palette of its own'
})

check('every token it reads is one the pack defines', () => {
  const css = read(CSS)
  const pack = read(PACK) + read(PACK_IMMERSIVE)

  // What the pack declares, plus the handful this file declares for itself.
  const defined = new Set([...pack.matchAll(/^\s*(--[a-z0-9-]+):/gm)].map((m) => m[1]))
  const local = new Set([...css.matchAll(/^\s*(--[a-z0-9-]+):/gm)].map((m) => m[1]))

  // --seat is set by the pack's [data-seat] rules, not declared in a block.
  defined.add('--seat')

  const unknown = [...new Set([...css.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]))]
    .filter((name) => !defined.has(name) && !local.has(name))
  assert(unknown.length === 0, `reads tokens nothing defines: ${unknown.join(', ')}`)

  // The local ones have to stay few and have to be explained, because each is
  // a small licence to diverge. Four is the number the docblock justifies.
  assert(local.size <= 5, `${local.size} local tokens — the pack is being forked one variable at a time`)
  return `${local.size} local, ${defined.size} from the pack`
})

check('the pack’s material rules hold: no glass, no glow', () => {
  const css = read(CSS)

  // The pack's material is a matte panel lit by one brighter hairline on its
  // top edge. A blurred pane behind a panel is a different material, and a
  // glow behind a card is light coming from nowhere.
  assert(!/backdrop-filter\s*:/.test(css), 'a panel is still frosted glass')
  assert(!/radial-gradient/.test(css), 'something still has a glow behind it')
  return 'matte throughout'
})

check('--flame is spent on four things and nothing else', () => {
  /*
   * The pack's hardest rule to keep: "--flame is the only hot colour on a
   * screen. If two things are orange, neither is important."
   *
   * Counting declarations was the first version of this check and it was the
   * wrong measure — one dot costs three declarations (border, fill, ring) while
   * being one idea, so the budget punished precision and a fifth orange thing
   * could hide under it. What matters is *which* rules are allowed to be hot,
   * so the check names them. A fifth idea fails here and the message says which
   * selector reached for it.
   */
  const css = codeOnly(read(CSS))
  const ALLOWED = [
    ['the focus ring', /:focus-visible/],
    ['the loading horizon and its bar', /^\.(loading-rule|loading-fill|start-rule)$/],
    ['the seat you are taking', /^(\.plan-seat\.on \.plan-dot|\.start-seats \.seat\[data-taking='yes'\])$/],
    ['the one action that commits', /^\.(turn-go|gate-act\[data-weight='primary'\])(:hover:not\(:disabled\))?$/],
  ]

  const lines = css.split('\n')
  let selector = null
  const spent = new Map()
  const stray = []
  for (const line of lines) {
    if (line.includes('{')) selector = line.slice(0, line.indexOf('{')).trim()
    if (!/var\(--flame[a-z-]*\)/.test(line)) continue
    const intent = ALLOWED.find(([, pattern]) => pattern.test(selector))
    if (!intent) stray.push(selector)
    else spent.set(intent[0], (spent.get(intent[0]) || 0) + 1)
  }

  assert(stray.length === 0,
    `hot colour outside the four: ${[...new Set(stray)].join(', ')}`)
  // And each of the four has to still be hot — losing one is how the page ends
  // up with nothing to act on.
  for (const [intent] of ALLOWED) {
    assert(spent.has(intent), `nothing marks ${intent} any more`)
  }
  return [...spent].map(([k, n]) => `${k} (${n})`).join(', ')
})

check('a subject or seat hue is a hairline or a label, never a fill', () => {
  const css = read(CSS)
  const hues = [...css.matchAll(/^\s*([a-z-]+)\s*:[^;]*var\(--(?:seat|a-[a-z]+)[a-z-]*[,)][^;]*;/gm)]
  assert(hues.length > 0, 'no role colour reaches the courtroom at all')
  for (const [line, prop] of hues) {
    const ok = prop === 'color' || prop.startsWith('border')
    assert(ok, `a role hue is used on ${prop}, which is a fill: ${line.trim()}`)
  }
  return `${hues.length} hue uses, all borders or ink`
})

check('every nd- class the courtroom names exists in the pack', () => {
  const pack = read(PACK) + read(PACK_IMMERSIVE)
  const have = new Set([...pack.matchAll(/\.(nd-[a-z0-9-]+)/g)].map((m) => m[1]))
  assert(have.size > 20, 'the pack appears not to define any classes, so this check proves nothing')

  const used = new Map()
  for (const rel of COURT_UI) {
    // Only inside a className, so a word in prose is not mistaken for a class.
    for (const m of read(rel).matchAll(/className=\{?[`'"]([^`'"]+)[`'"]/g)) {
      for (const cls of m[1].split(/\s+/)) {
        if (cls.startsWith('nd-')) used.set(cls, rel)
      }
    }
  }
  const dead = [...used].filter(([cls]) => !have.has(cls))
  assert(dead.length === 0,
    `dead class names: ${dead.map(([c, f]) => `${c} in ${f.split('/').pop()}`).join(', ')}`)
  return used.size ? `${used.size} pack classes, all real` : 'none used; none invented'
})

check('every place that names a speaker says which seat it is', () => {
  const seats = [...read(PACK_IMMERSIVE).matchAll(/\[data-seat="([a-z]+)"\]/g)].map((m) => m[1])
  assert(seats.length === 7, `the pack maps ${seats.length} seats, not 7`)

  // The ids the pack colours have to be the ids the registry uses, or the
  // attribute resolves to nothing and every speaker is the same grey.
  const registry = read('apps/courtroom/src/config/characterRegistry.js')
  const table = registry.slice(registry.indexOf('CHARACTER_REGISTRY'))
  for (const seat of seats) {
    assert(new RegExp(`^  ${seat}:`, 'm').test(table),
      `the pack colours "${seat}" but the registry has no such character`)
  }

  // And the three labels have to actually ask for it.
  const wired = [
    ['apps/courtroom/src/ui/DialogueBar.jsx', 'dialogue.speaker'],
    ['apps/courtroom/src/App.jsx', 'seatRole'],
    ['apps/courtroom/src/ui/TranscriptPanel.jsx', 'line.role'],
  ]
  for (const [rel, expr] of wired) {
    const src = read(rel)
    assert(new RegExp(`data-seat=\\{${expr.replace('.', '\\.')}`).test(src),
      `${rel.split('/').pop()} does not stamp data-seat from ${expr}`)
    // Undefined rather than empty string, so CSS falls back instead of
    // matching [data-seat=""] and resolving --seat to nothing.
    const at = src.indexOf(`data-seat={${expr}`)
    assert(src.slice(at, at + 60).includes('|| undefined'),
      `${rel.split('/').pop()} can stamp an empty seat, which defeats the fallback`)
  }

  // The fallback itself: nothing may depend on the attribute being there.
  const css = read(CSS)
  const reads = [...css.matchAll(/var\(--seat[^)]*\)/g)].map((m) => m[0])
  assert(reads.length > 0, 'the stylesheet never reads --seat, so the attribute does nothing')
  for (const r of reads) {
    assert(r.includes(','), `${r} has no fallback, so an unnamed speaker loses their mark`)
  }
  return `${seats.length} seats, ${reads.length} reads, all with a fallback`
})

check('no font is fetched, because the room has to run offline', () => {
  // codeOnly, because the docblock at the top of styles.css explains how to
  // close this gap and names @font-face while doing it.
  const css = codeOnly(read(CSS))
  assert(!/@import|@font-face|url\(/.test(css), 'the courtroom now fetches something at paint time')
  const index = read('apps/courtroom/index.html')
  assert(!/fonts\.googleapis|fonts\.gstatic/.test(index), 'index.html pulls a webfont from Google')
  return 'no @font-face, no remote stylesheet'
})

/* ===========================================================================
   Report
   =========================================================================== */

console.log(`\n${'─'.repeat(64)}`)
if (failures.length === 0) {
  console.log(`PASSED — ${passed} checks passed, 0 failed`)
  process.exit(0)
} else {
  console.log(`FAILED — ${passed} passed, ${failures.length} failed`)
  for (const f of failures) console.log(`  · ${f.label}: ${f.message}`)
  process.exit(1)
}
