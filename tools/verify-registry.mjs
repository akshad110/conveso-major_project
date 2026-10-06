/**
 * Prove the courtroom loads the cast the case asked for, and nothing else.
 *
 * The room is 226 MB of character models and no single hearing uses all of them.
 * `configuration.characters` in the `simulations` table is the load list and
 * `configuration.variants` picks which body a role wears; this checks the
 * registry actually honours both, and — more importantly — that every way of
 * getting it wrong degrades towards a populated courtroom rather than an empty
 * one. A hearing with nobody in it is a worse outcome than a hearing that
 * downloads a model it does not need.
 *
 *   node --import ./tools/vite-resolve.mjs tools/verify-registry.mjs [--verbose]
 */
import assert from 'node:assert/strict'
import {
  CHARACTER_REGISTRY, ROLE_ORDER,
  activeRoles, allModelFiles, applySceneConfiguration, characterPlacement,
  isLoaded, modelManifest, resetSceneConfiguration,
} from '../apps/courtroom/src/config/characterRegistry.js'

const verbose = process.argv.includes('--verbose')
let passed = 0
const failures = []

const check = (name, fn) => {
  resetSceneConfiguration()
  try {
    const note = fn()
    passed += 1
    if (verbose) console.log(`  ok   ${name}${note ? ` — ${note}` : ''}`)
  } catch (err) {
    failures.push({ name, message: err.message })
    console.log(`  FAIL ${name}\n       ${err.message}`)
  }
}

const file = (path) => String(path).split('/').pop()

/* --- the default ----------------------------------------------------------- */

console.log('\nNo session: everything loads, exactly as before\n')

check('with no configuration the whole registry mounts', () => {
  const roles = activeRoles()
  assert.deepEqual(roles, ROLE_ORDER, `cast is ${roles.join(', ')}`)
  return roles.length + ' roles'
})

check('the default manifest is one file per role, not one per variant', () => {
  const manifest = modelManifest()
  assert.equal(manifest.length, ROLE_ORDER.length, `${manifest.length} files for ${ROLE_ORDER.length} roles`)
  assert(new Set(manifest).size === manifest.length, 'the manifest has duplicates')
  // The registry holds more files than any hearing mounts, which is the whole
  // reason the manifest and the cast have to be derived from the same place.
  assert(allModelFiles().length > manifest.length, 'no unused variants exist — recheck this test')
  return `${manifest.length} mounted of ${allModelFiles().length} on disk`
})

/* --- narrowing ------------------------------------------------------------- */

console.log('\nA case names its cast\n')

check('a role left out of the configuration is not loaded', () => {
  const report = applySceneConfiguration({
    characters: ['judge', 'clerk', 'prosecutor', 'defense', 'witness', 'defendant'],
  })
  assert(!activeRoles().includes('police'), 'police loaded anyway')
  assert.equal(isLoaded('police'), false)
  assert(!modelManifest().some((m) => m.includes('police')), 'police.glb is still in the manifest')
  assert.deepEqual(report.ignored, [], `ignored ${report.ignored.join(', ')}`)
  return `${activeRoles().length} roles, police.glb skipped`
})

check('the cast keeps registry order however the configuration is written', () => {
  applySceneConfiguration({ characters: ['police', 'judge', 'defendant', 'clerk'] })
  assert.deepEqual(activeRoles(), ['judge', 'defendant', 'clerk', 'police'])
  return 'reordered to ROLE_ORDER'
})

check('the manifest follows the cast', () => {
  applySceneConfiguration({ characters: ['judge', 'clerk'] })
  const manifest = modelManifest()
  assert.equal(manifest.length, 2, `${manifest.length} files for a cast of 2`)
  return manifest.map(file).join(', ')
})

/* --- variants -------------------------------------------------------------- */

console.log('\nWhich body a role wears\n')

check('a variant the configuration names is the one that mounts', () => {
  applySceneConfiguration({
    characters: ['witness', 'defendant'],
    variants: { witness: 'female', defendant: 'male' },
  })
  assert(characterPlacement('witness').model.includes('female'), characterPlacement('witness').model)
  assert(characterPlacement('defendant').model.includes('male'), characterPlacement('defendant').model)
  const manifest = modelManifest()
  assert(!manifest.some((m) => m.includes('witness_male')), 'the unused witness body is still fetched')
  return manifest.map(file).join(', ')
})

check('a variant the role does not offer is refused, not resolved to nothing', () => {
  // The failure being prevented: `entry.variants['female']` on a role with one
  // body is undefined, and a character with no model silently does not appear.
  const report = applySceneConfiguration({
    characters: ['judge', 'witness'],
    variants: { judge: 'female' },
  })
  assert(report.ignored.includes('judge=female'), `ignored ${report.ignored.join(', ')}`)
  const placement = characterPlacement('judge')
  assert(placement?.model, 'the judge lost their model')
  assert.equal(file(placement.model), 'judge.glb')
  assert(isLoaded('judge'), 'the judge is no longer in the cast')
  return 'judge still mounts judge.glb'
})

check('every variant the registry offers actually resolves', () => {
  const tried = []
  for (const role of ROLE_ORDER) {
    const variants = CHARACTER_REGISTRY[role]?.variants
    if (!variants) continue
    for (const key of Object.keys(variants)) {
      applySceneConfiguration({ characters: [role], variants: { [role]: key } })
      const model = characterPlacement(role)?.model
      assert.equal(model, variants[key], `${role}=${key} resolved to ${model}`)
      tried.push(`${role}=${key}`)
    }
  }
  assert(tried.length > 0, 'no variants found to test')
  return tried.join(', ')
})

/* --- the ways it can be got wrong ------------------------------------------ */

console.log('\nA hand-edited jsonb column\n')

check('an unknown character name costs that character, not the hearing', () => {
  const report = applySceneConfiguration({ characters: ['judge', 'bailiff', 'stenographer'] })
  assert.deepEqual(activeRoles(), ['judge'], `cast is ${activeRoles().join(', ')}`)
  assert.deepEqual(report.ignored.sort(), ['bailiff', 'stenographer'])
  return 'two typos reported, judge still seated'
})

check('a configuration where nothing is valid falls back to the full cast', () => {
  applySceneConfiguration({ characters: ['nobody-real'] })
  assert.deepEqual(activeRoles(), ROLE_ORDER, 'the room would have rendered empty')
  return `${ROLE_ORDER.length} roles`
})

check('an empty or absent character list means everybody', () => {
  for (const config of [{}, { characters: [] }, { characters: null }, undefined]) {
    applySceneConfiguration(config)
    assert.deepEqual(activeRoles(), ROLE_ORDER, `${JSON.stringify(config)} emptied the room`)
  }
  return '4 empty configurations'
})

check('malformed input does not throw', () => {
  for (const config of [
    null, 'nonsense', 42, [],
    { characters: 'judge' },
    { characters: [null, undefined, '', 0] },
    { characters: ['judge'], variants: 'male' },
    { characters: ['judge'], variants: null },
    { characters: ['JUDGE', 'Clerk'] },
  ]) {
    const report = applySceneConfiguration(config)
    assert(Array.isArray(report.characters), `${JSON.stringify(config)} returned no cast`)
    assert(activeRoles().length > 0, `${JSON.stringify(config)} emptied the room`)
  }
  // Case is folded, so a configuration written in capitals still works.
  applySceneConfiguration({ characters: ['JUDGE', 'Clerk'] })
  assert.deepEqual(activeRoles(), ['judge', 'clerk'])
  return '9 malformed inputs, capitals folded'
})

check('leaving a hearing restores the default', () => {
  applySceneConfiguration({ characters: ['judge'] })
  assert.equal(activeRoles().length, 1)
  resetSceneConfiguration()
  assert.deepEqual(activeRoles(), ROLE_ORDER, 'the cast survived the reset')
  return 'full cast back'
})

/* --- what it is for -------------------------------------------------------- */

console.log('\nThe saving\n')

check('the seeded cases mount every role, so the saving comes from variants', () => {
  // Both seeded hearings name all seven characters, so today the saving is the
  // unused bodies only. This is recorded rather than asserted as a target: the
  // point of the mechanism is that a case which drops the officer gets the
  // larger saving for free, without a code change.
  applySceneConfiguration({
    characters: ROLE_ORDER,
    variants: { witness: 'male', defendant: 'male' },
  })
  const mounted = modelManifest()
  const spare = allModelFiles().filter((f) => !mounted.includes(f))
  assert.equal(mounted.length, ROLE_ORDER.length)
  assert(spare.length > 0, 'the seeded configuration mounts every file on disk')
  return `${spare.length} unused: ${spare.map(file).join(', ')}`
})

check('dropping the officer drops their model', () => {
  applySceneConfiguration({
    characters: ROLE_ORDER.filter((r) => r !== 'police'),
    variants: { witness: 'male', defendant: 'male' },
  })
  const mounted = modelManifest()
  const spare = allModelFiles().filter((f) => !mounted.includes(f))
  assert(spare.some((f) => f.includes('police')), 'police.glb is still mounted')
  return `${spare.length} unused: ${spare.map(file).join(', ')}`
})

/* --- result ---------------------------------------------------------------- */

console.log(`\n${'─'.repeat(64)}`)
if (failures.length) {
  console.log(`FAILED — ${passed} passed, ${failures.length} failed\n`)
  for (const f of failures) console.log(`  ${f.name}\n    ${f.message}`)
  process.exit(1)
}
console.log(`PASSED — ${passed} checks passed, 0 failed\n`)
