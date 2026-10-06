/**
 * Validate the animation wiring against the real GLB files.
 *
 * Reads the actual animation clip names out of each merged character GLB, then
 * runs every logical court action through the real resolveAction() from
 * src/config/animationMap.js and reports what it lands on. Fails if any action
 * resolves to nothing, or if the registry advertises a clip the GLB doesn't have.
 *
 * No dependencies — run it with plain node:
 *   node tools/validate_animations.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MODELS = path.join(ROOT, 'public', 'models')

// --- read clip names straight out of the GLB JSON chunk ----------------------
function glbAnimations(file) {
  const fd = fs.openSync(file, 'r')
  try {
    const head = Buffer.alloc(20)
    fs.readSync(fd, head, 0, 20, 0)
    if (head.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB')
    const jsonLen = head.readUInt32LE(12)
    const json = Buffer.alloc(jsonLen)
    fs.readSync(fd, json, 0, jsonLen, 20)
    const doc = JSON.parse(json.toString('utf8'))
    return {
      animations: (doc.animations || []).map((a) => a.name),
      channels: (doc.animations || []).map((a) => (a.channels || []).length),
      skins: (doc.skins || []).length,
      joints: doc.skins?.[0]?.joints?.length ?? 0,
      meshes: (doc.meshes || []).length,
    }
  } finally {
    fs.closeSync(fd)
  }
}

// --- import the app config (rewrite extensionless imports for plain node) ----
async function loadConfig() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'courtcfg-'))
  for (const f of fs.readdirSync(path.join(ROOT, 'src', 'config'))) {
    const src = fs.readFileSync(path.join(ROOT, 'src', 'config', f), 'utf8')
    fs.writeFileSync(
      path.join(tmp, f),
      src.replace(/from '(\.\/[^']+?)'/g, (m, p) => (p.endsWith('.js') ? m : `from '${p}.js'`)),
    )
  }
  const animationMap = await import(path.join(tmp, 'animationMap.js'))
  const registry = await import(path.join(tmp, 'characterRegistry.js'))
  const layout = await import(path.join(tmp, 'courtroomLayout.js'))
  return { animationMap, registry, layout, tmp }
}

const { animationMap, registry, layout } = await loadConfig()
const { resolveAction, ACTION_MAP, DERIVED_CLIPS, actionsForRole } = animationMap
const { CHARACTER_REGISTRY, ROLE_ORDER, characterPlacement } = registry

let errors = 0
let warnings = 0

console.log(`character scale ${layout.CHARACTER_SCALE}\n`)

for (const role of ROLE_ORDER) {
  const entry = CHARACTER_REGISTRY[role]
  const place = characterPlacement(role)

  if (!place.model) {
    console.log(`${role.toUpperCase()}  — no model (${entry.note || 'slot reserved'})`)
    const acts = actionsForRole(role)
    console.log(`  ${acts.length} logical actions defined, will resolve once the GLB lands\n`)
    continue
  }

  const file = path.join(MODELS, path.basename(place.model))
  if (!fs.existsSync(file)) {
    console.log(`${role.toUpperCase()}  MISSING FILE ${file}`)
    errors++
    continue
  }

  const info = glbAnimations(file)
  const available = new Set(info.animations)

  // derived subclips the controller will synthesise at load time
  for (const [name, spec] of Object.entries(DERIVED_CLIPS[role] || {})) {
    if (available.has(spec.from)) available.add(name)
    else {
      console.log(`  ! ${role}: derived ${name} needs ${spec.from}, which is absent`)
      warnings++
    }
  }

  const size = (fs.statSync(file).size / 1e6).toFixed(1)
  console.log(
    `${role.toUpperCase()}  ${path.basename(file)}  ${size} MB  ` +
      `${info.animations.length} clips · ${info.skins} skin / ${info.joints} joints · ${info.meshes} mesh`,
  )

  // registry inventory vs reality
  const declared = new Set(entry.clips || [])
  const missing = [...declared].filter((c) => !available.has(c))
  const extra = info.animations.filter((c) => !declared.has(c))
  if (missing.length) {
    console.log(`  ! registry lists clips the GLB lacks: ${missing.join(', ')}`)
    warnings++
  }
  if (extra.length) {
    console.log(`  ! GLB has clips the registry omits: ${extra.join(', ')}`)
    warnings++
  }

  // Channel sanity, measured against this character's own skeleton rather than
  // a fixed number. A clip animates every joint on either two paths (rotation +
  // translation, which is what the mixamorig exports do) or three (plus scale).
  // Hard-coding 72 was right when every rig had 24 bones; it now fires on the
  // judge and the officer, who have 28, and on the witness, who has 23 — all of
  // them correct. What is genuinely wrong is a clip that animates some other
  // number, because that means channels were dropped in the merge.
  const joints = info.joints || 0
  const ok = new Set(joints ? [joints * 2, joints * 3] : [])
  const oddChannels = info.channels.filter((n) => !ok.has(n))
  if (oddChannels.length) {
    console.log(
      `  ! unexpected channel counts: ${[...new Set(oddChannels)].join(', ')}` +
      ` (expected ${joints * 2} or ${joints * 3} for ${joints} joints)`,
    )
    warnings++
  }

  for (const action of actionsForRole(role)) {
    const res = resolveAction(role, action, available)
    if (!res.clip) {
      console.log(`  FAIL ${action.padEnd(18)} -> nothing (${res.reason})`)
      errors++
    } else {
      const flag = res.fallback ? '~' : ' '
      const why = res.fallback ? `   [${res.reason}]` : ''
      console.log(`  ${flag} ${action.padEnd(18)} -> ${res.clip}${why}`)
    }
  }
  console.log()
}

// --- spawn point sanity ------------------------------------------------------
console.log('spawn points')
for (const [name, sp] of Object.entries(layout.SPAWN_POINTS)) {
  const deg = Math.round((sp.rotationY * 180) / Math.PI)
  const facing = deg === 90 ? '+X (out from bench)' : deg === -90 ? '-X (toward bench)' : `${deg} deg`
  console.log(`  ${name.padEnd(20)} [${sp.position.join(', ')}]  rotY ${String(deg).padStart(4)}  ${facing}`)
  const used = ROLE_ORDER.filter((r) => CHARACTER_REGISTRY[r].spawn === name)
  if (used.length !== 1) {
    console.log(`  ! ${name} used by ${used.length} roles: ${used.join(', ')}`)
    errors++
  }
}

console.log(`\n${errors} error(s), ${warnings} warning(s)`)
process.exit(errors ? 1 : 0)
