#!/usr/bin/env node
/**
 * Asset optimisation for the courtroom.
 *
 * 214 MB of models ship with this app and a student downloads them over a
 * lesson's patience. This script makes them smaller. What it will not do is
 * make them *different*: the courtroom reads clip names off the loaded GLB,
 * positions characters with corrections measured by forward kinematics on named
 * joints, and places everything using world coordinates measured from
 * CourtRoom.glb and then hard-coded into config/courtroomLayout.js. Every one of
 * those is a name or a number that exists in two places, and an optimiser that
 * quietly renames a node or rebakes a transform breaks the room in a way that
 * looks like a physics bug three files away.
 *
 * So the last thing this script does is prove it changed nothing that matters —
 * see `fingerprint` at the bottom. If a single clip name, joint name or root
 * transform moved, the output is rejected and the original is left alone.
 *
 *
 * WHAT THE PROBLEM ACTUALLY IS
 *
 * Measured, not assumed. Of CourtRoom.glb's 100.6 MB, 99.8 MB is 22 images and
 * 0.8 MB is geometry — the room is 15,657 triangles. One texture, a 4096²
 * normal map stored as PNG, is 51.8 MB on its own: more than half the file, and
 * ~24 bits per pixel, which is PNG telling us it found nothing to compress. The
 * three wood maps together are 75.6 MB of the 100.6.
 *
 * That makes this a texture problem wearing a geometry problem's reputation.
 * Draco — the usual first answer — compresses geometry, and there is no
 * geometry here to speak of. The characters are the opposite shape: clerk,
 * defendant_female, judge and police carry ~95-101k triangles each, so they get
 * real value from mesh compression, while defense, prosecutor and the witnesses
 * are ~10k and get almost none.
 *
 *
 * WHY WEBP AND MESHOPT, AND NOT DRACO OR KTX2
 *
 * This is decided by what the app can decode without reaching for the network,
 * not by which codec wins a benchmark. The courtroom runs inside an LMS iframe
 * and fetches nothing at paint time; a verifier check holds it to that.
 *
 *   EXT_texture_webp          three's GLTFLoader decodes it natively. No
 *                             transcoder, no extra files, no request. A 2048²
 *                             WebP normal map is ~1.5 MB where the 4096² PNG is
 *                             51.8 MB.
 *
 *   EXT_meshopt_compression   drei's useGLTF already calls setMeshoptDecoder by
 *                             default, and that decoder is imported from
 *                             three-stdlib, so Vite bundles it. Works today
 *                             with no application change at all.
 *
 *   KHR_draco_mesh_compression  Also enabled by default in drei — pointed at
 *                             https://www.gstatic.com/draco/... The decoder is
 *                             only fetched when a Draco primitive is actually
 *                             found, which is why nothing is fetched today. The
 *                             moment we compress with Draco, every character
 *                             load reaches Google. That is a third-party origin
 *                             inside an LMS iframe, a CSP entry, and an offline
 *                             failure. Meshopt costs a few percent more bytes
 *                             and none of that.
 *
 *   KHR_texture_basisu        Supported by GLTFLoader but drei's useGLTF never
 *                             calls setKTX2Loader, so a KTX2 texture inside a
 *                             GLB does not load at all right now. It is still
 *                             worth having eventually — it is the only option
 *                             here that shrinks *GPU memory* rather than
 *                             download, because the texture stays compressed on
 *                             the card. --ktx2 does the encoding and prints the
 *                             loader wiring it needs; it is deliberately not
 *                             the default.
 *
 *
 * WHAT IS DELIBERATELY NOT DONE
 *
 *   join / flatten / instance   Rebake or merge the node graph. courtroomLayout
 *                               holds world coordinates measured from the
 *                               original file; moving a node moves the room out
 *                               from under every spawn point.
 *   simplify                    Throws away triangles. A decision about how the
 *                               room looks, which is not an optimiser's to make.
 *   prune with keepLeaves off   Deletes childless nodes — which is what an empty
 *                               used as a locator looks like from here.
 *   renaming or hashing files   characterRegistry.js and courtroomLayout.js name
 *                               these files as string literals. Hashing them
 *                               needs a manifest and a codegen step; cache
 *                               busting for public/ is better solved with an
 *                               immutable header and a versioned path.
 *
 *
 * USAGE
 *
 *   npm i -D @gltf-transform/core @gltf-transform/extensions \
 *            @gltf-transform/functions meshoptimizer sharp
 *
 *   node tools/optimise-assets.mjs --inventory     # no dependencies needed
 *   node tools/optimise-assets.mjs                 # write to models-optimised/
 *   node tools/optimise-assets.mjs --verbose       # per-texture detail
 *   node tools/optimise-assets.mjs --only judge.glb
 *   node tools/optimise-assets.mjs --in-place      # after you have looked
 *   node tools/optimise-assets.mjs --ktx2          # needs toktx on PATH
 *
 * --inventory reads the GLB container directly and needs nothing installed, so
 * you can see where the bytes are before deciding to install anything.
 *
 * Nothing is overwritten unless --in-place is passed, and --in-place keeps the
 * original beside the result as <name>.original.glb.
 */

import { existsSync, mkdirSync, readdirSync, statSync, copyFileSync, readFileSync } from 'node:fs'
import { join, dirname, basename, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const argv = process.argv.slice(2)
const flag = (name) => argv.includes(`--${name}`)
const value = (name, fallback) => {
  const i = argv.indexOf(`--${name}`)
  return i === -1 ? fallback : argv[i + 1]
}

/**
 * Which directory to work on.
 *
 * Defaults to the courtroom's, because that is where the 214 MB is and where
 * every number in this file's docblock was measured. But the classroom carries
 * its own 60 MB — `classroom_alternative.glb` alone is 35 MB — and the same
 * WebP-by-slot pass applies to it unchanged, so the path is an argument rather
 * than a constant:
 *
 *   node tools/optimise-assets.mjs --inventory --dir apps/classroom/public/models
 *
 * Relative paths resolve against the repository root, not the shell's cwd, so
 * the command means the same thing from anywhere in the tree.
 */
const resolveDir = (p) => (p.startsWith('/') ? p : join(ROOT, p))

const MODELS = resolveDir(value('dir', 'apps/courtroom/public/models'))
const OUT_DEFAULT = `${MODELS.replace(/\/+$/, '')}-optimised`

/* ===========================================================================
   Options
   =========================================================================== */

const OPTS = {
  verbose: flag('verbose'),
  dryRun: flag('dry-run'),
  inPlace: flag('in-place'),
  ktx2: flag('ktx2'),
  inventory: flag('inventory'),
  // CourtRoom.glb's prune pass deletes meshes the layout still names. Texture
  // recompression is where that file's bytes actually are, so this skips the
  // graph edits and leaves every mesh, joint and clip alone.
  texturesOnly: flag('textures-only'),
  only: value('only', null),
  out: value('out', OUT_DEFAULT),
  /**
   * Mesh compression aggressiveness. 'medium' quantises more conservatively
   * than 'high'. The characters are skinned, and quantisation interacts with
   * bind matrices, so the cautious setting is the default and the fingerprint
   * check below is what would catch it going wrong either way.
   */
  level: value('level', 'medium'),
}

/**
 * How small each kind of texture is allowed to be, and how hard to squeeze it.
 *
 * Keyed on the *slot* the glTF binds the texture into rather than on its file
 * name, because a name is a guess and a slot is a fact. The numbers follow from
 * what each map carries: base colour is what you look at, so it keeps its
 * resolution and a gentle quality; a normal map is geometry in disguise and
 * shows banding before colour does, so it gets the highest quality here;
 * metallic-roughness and occlusion are low-frequency single-channel data that
 * arrived as 4096² three-channel PNGs, which is the single most wasteful thing
 * in the asset set.
 */
const TEXTURE_POLICY = {
  baseColorTexture: { max: 2048, quality: 84, label: 'base colour' },
  emissiveTexture: { max: 2048, quality: 84, label: 'emissive' },
  normalTexture: { max: 2048, quality: 92, label: 'normal' },
  metallicRoughnessTexture: { max: 1024, quality: 80, label: 'metal/rough' },
  occlusionTexture: { max: 1024, quality: 80, label: 'occlusion' },
  // Bound through a material extension rather than a core slot. CourtRoom.glb
  // uses KHR_materials_specular, and without this its specular map would fall
  // through to _unbound and be treated as something nobody reads.
  specularTexture: { max: 1024, quality: 80, label: 'specular' },
  sheenTexture: { max: 1024, quality: 80, label: 'sheen' },
  clearcoatTexture: { max: 1024, quality: 80, label: 'clearcoat' },
  transmissionTexture: { max: 1024, quality: 80, label: 'transmission' },
  _unbound: { max: 1024, quality: 80, label: 'unbound' },
}

/**
 * Texture slots that live in material extensions rather than in core glTF.
 *
 * Read from the raw JSON, so a texture bound only through an extension is still
 * classified by what it is for. The list is not exhaustive and does not need to
 * be — anything unrecognised lands on the _unbound policy, which is the
 * conservative one.
 */
const EXTENSION_SLOTS = {
  KHR_materials_specular: { specularTexture: 'specularTexture', specularColorTexture: 'specularTexture' },
  KHR_materials_sheen: { sheenColorTexture: 'sheenTexture', sheenRoughnessTexture: 'sheenTexture' },
  KHR_materials_clearcoat: { clearcoatTexture: 'clearcoatTexture', clearcoatRoughnessTexture: 'clearcoatTexture', clearcoatNormalTexture: 'normalTexture' },
  KHR_materials_transmission: { transmissionTexture: 'transmissionTexture' },
  KHR_materials_volume: { thicknessTexture: 'transmissionTexture' },
}

/* ===========================================================================
   Preflight
   ---------------------------------------------------------------------------
   These are not dependencies of the app — nothing here ships to a browser — so
   they are not in any package.json. Say exactly what to install rather than
   letting Node's module resolver explain it.
   =========================================================================== */

const NEEDED = [
  '@gltf-transform/core',
  '@gltf-transform/extensions',
  '@gltf-transform/functions',
  'meshoptimizer',
  'sharp',
]

async function load() {
  const missing = []
  const mods = {}
  for (const name of NEEDED) {
    try {
      mods[name] = await import(name)
    } catch {
      missing.push(name)
    }
  }
  if (missing.length) {
    console.error(`\nMissing: ${missing.join(', ')}\n`)
    console.error('These are build tools, not app dependencies, so they are not installed. Run:\n')
    console.error(`  npm i -D ${NEEDED.join(' ')}\n`)
    console.error('sharp ships prebuilt binaries and needs network on first install.\n')
    process.exit(1)
  }
  return mods
}

/* ===========================================================================
   Reporting
   =========================================================================== */

const MB = (bytes) => bytes / 1048576
const fmt = (bytes) => `${MB(bytes).toFixed(1)} MB`
const pct = (before, after) => `${(100 * (1 - after / before)).toFixed(0)}%`

/* ===========================================================================
   The fingerprint
   ---------------------------------------------------------------------------
   Everything the application looks up by name or trusts as a number, collected
   into one comparable object. Taken before the transforms and again after, and
   the two have to match exactly.

   This is the part that makes the script safe to run. A texture that came out
   too blurry is a thing you can see; a joint renamed from `mixamorig:Spine` to
   `Spine_0` is invisible until a character folds in half on the third turn of a
   hearing, and by then the original has been overwritten.
   =========================================================================== */

const round = (n) => Number(n.toFixed(4))

function fingerprint(doc) {
  const root = doc.getRoot()

  // Clip names: animationMap.js matches CLIP_META against the real clip list
  // read off the loaded GLB, so a renamed clip silently degrades to idle.
  const clips = root
    .listAnimations()
    .map((anim) => {
      let end = 0
      for (const sampler of anim.listSamplers()) {
        const input = sampler.getInput()
        if (input) end = Math.max(end, input.getMax([])[0] ?? 0)
      }
      return `${anim.getName()}@${round(end)}`
    })
    .sort()

  // Joint names: poseFix was measured with forward kinematics on the shoulder
  // line of a named skeleton.
  const joints = root
    .listSkins()
    .flatMap((skin) => skin.listJoints().map((j) => j.getName()))
    .sort()

  // Scene-root transforms: quantisation compensates by writing a scale and
  // offset into a node, and if it ever does that at the root the character
  // arrives at the wrong size in the right chair.
  const roots = root
    .listScenes()
    .flatMap((scene) =>
      scene.listChildren().map((n) =>
        [
          n.getName(),
          n.getTranslation().map(round).join(','),
          n.getRotation().map(round).join(','),
          n.getScale().map(round).join(','),
        ].join('|'),
      ),
    )
    .sort()

  // Triangles: nothing here is meant to simplify geometry, so this number is
  // not allowed to move at all.
  let triangles = 0
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const indices = prim.getIndices()
      const position = prim.getAttribute('POSITION')
      triangles += Math.floor((indices ? indices.getCount() : position?.getCount() ?? 0) / 3)
    }
  }

  return {
    clips,
    joints,
    roots,
    triangles,
    nodes: root.listNodes().map((n) => n.getName()).sort(),
    meshes: root.listMeshes().map((m) => m.getName()).sort(),
    skins: root.listSkins().length,
  }
}

function diffFingerprints(before, after) {
  const problems = []
  const sameList = (key, human) => {
    const a = before[key]
    const b = after[key]
    if (a.length !== b.length) {
      problems.push(`${human}: ${a.length} before, ${b.length} after`)
      return
    }
    const changed = a.filter((v, i) => v !== b[i])
    if (changed.length) {
      problems.push(`${human} changed: ${changed.slice(0, 3).join(', ')}${changed.length > 3 ? ` (+${changed.length - 3})` : ''}`)
    }
  }
  sameList('clips', 'animation clips')
  sameList('joints', 'skeleton joints')
  sameList('nodes', 'node names')
  sameList('meshes', 'mesh names')
  sameList('roots', 'scene root transforms')
  if (before.triangles !== after.triangles) {
    problems.push(`triangles: ${before.triangles} before, ${after.triangles} after`)
  }
  if (before.skins !== after.skins) {
    problems.push(`skins: ${before.skins} before, ${after.skins} after`)
  }
  return problems
}

/* ===========================================================================
   Texture work
   =========================================================================== */

/**
 * Which slot each texture is bound into.
 *
 * A texture can legitimately be bound into more than one slot; when that
 * happens the strictest policy wins, because the same pixels have to satisfy
 * both readers.
 */
function slotsByTexture(doc) {
  const map = new Map()
  const note = (texture, slot) => {
    if (!texture) return
    if (!map.has(texture)) map.set(texture, new Set())
    map.get(texture).add(slot)
  }
  for (const material of doc.getRoot().listMaterials()) {
    note(material.getBaseColorTexture(), 'baseColorTexture')
    note(material.getNormalTexture(), 'normalTexture')
    note(material.getMetallicRoughnessTexture(), 'metallicRoughnessTexture')
    note(material.getOcclusionTexture(), 'occlusionTexture')
    note(material.getEmissiveTexture(), 'emissiveTexture')

    // And the extension slots, so this agrees with --inventory. The getters are
    // named after the JSON keys, so they can be derived rather than listed
    // twice; wrapped because an extension this build of gltf-transform does not
    // implement should cost that one texture its policy, not the whole run.
    for (const [name, slots] of Object.entries(EXTENSION_SLOTS)) {
      const block = material.getExtension(name)
      if (!block) continue
      for (const [key, slot] of Object.entries(slots)) {
        const getter = `get${key[0].toUpperCase()}${key.slice(1)}`
        try {
          if (typeof block[getter] === 'function') note(block[getter](), slot)
        } catch { /* not implemented here; _unbound is the safe default */ }
      }
    }
  }
  return map
}

function policyFor(slots) {
  if (!slots || slots.size === 0) return TEXTURE_POLICY._unbound
  let chosen = null
  for (const slot of slots) {
    const p = TEXTURE_POLICY[slot]
    if (!p) continue
    // Strictest wins: the smallest ceiling, and the highest quality demanded.
    if (!chosen) chosen = { ...p }
    else chosen = { max: Math.min(chosen.max, p.max), quality: Math.max(chosen.quality, p.quality), label: `${chosen.label}+${p.label}` }
  }
  return chosen || TEXTURE_POLICY._unbound
}

async function recompress(doc, sharp, report) {
  const slots = slotsByTexture(doc)
  for (const texture of doc.getRoot().listTextures()) {
    const before = texture.getImage()
    if (!before) continue

    const policy = policyFor(slots.get(texture))
    const image = sharp.default(Buffer.from(before))
    const meta = await image.metadata()

    const scale = Math.min(1, policy.max / Math.max(meta.width, meta.height))
    const width = Math.max(1, Math.round(meta.width * scale))
    const height = Math.max(1, Math.round(meta.height * scale))

    let pipeline = image
    if (scale < 1) pipeline = pipeline.resize(width, height, { fit: 'fill', kernel: 'lanczos3' })

    // Alpha is load-bearing on base colour and meaningless elsewhere, but
    // dropping it is a decision about transparency, so it is kept wherever the
    // source had it.
    const encoded = await pipeline
      .webp({ quality: policy.quality, alphaQuality: 100, effort: 6 })
      .toBuffer()

    // Only accept the result if it is actually smaller. A small PNG of flat
    // colour can beat WebP, and swapping it for a bigger file to be consistent
    // would be optimising the pipeline rather than the download.
    if (encoded.byteLength < before.byteLength) {
      texture.setImage(new Uint8Array(encoded))
      texture.setMimeType('image/webp')
    }

    report.push({
      name: texture.getName() || '(unnamed)',
      slot: policy.label,
      from: `${meta.width}×${meta.height} ${meta.format}`,
      to: encoded.byteLength < before.byteLength ? `${width}×${height} webp` : 'kept as-is',
      before: before.byteLength,
      after: Math.min(encoded.byteLength, before.byteLength),
    })
  }
}

/* ===========================================================================
   One file
   =========================================================================== */

async function optimise(file, mods) {
  const { NodeIO } = mods['@gltf-transform/core']
  const ext = mods['@gltf-transform/extensions']
  const fns = mods['@gltf-transform/functions']
  const sharp = mods.sharp
  const { MeshoptEncoder, MeshoptDecoder } = mods.meshoptimizer

  await MeshoptEncoder.ready
  await MeshoptDecoder.ready

  const io = new NodeIO()
    .registerExtensions(ext.ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder })

  const source = join(MODELS, file)
  const sizeBefore = statSync(source).size
  const doc = await io.read(source)

  const before = fingerprint(doc)
  const skinned = doc.getRoot().listSkins().length > 0

  /* --- textures ---------------------------------------------------------- */

  // EXT_texture_webp has no fallback image, so a reader that cannot decode it
  // must fail loudly rather than render an untextured room. three can.
  doc.createExtension(ext.EXTTextureWebP).setRequired(true)
  const textures = []
  await recompress(doc, sharp, textures)

  /* --- structure --------------------------------------------------------- */

  const transforms = OPTS.texturesOnly
    ? []
    : [
        // Identical accessors, textures and materials, collapsed. Survivors keep
        // their names; the duplicates were never referred to by name anyway.
        fns.dedup(),
        // keepLeaves, because a childless node here is a locator, not litter.
        fns.prune({ keepLeaves: true, keepAttributes: false }),
        // Redundant keyframes, dropped. Clip names and durations are preserved,
        // and the fingerprint check proves it.
        fns.resample(),
      ]

  // Mesh compression earns its place on the four heavy characters and not on
  // the room, whose geometry is 0.8 MB of a 100 MB file — all cost, no saving.
  if (!OPTS.texturesOnly && before.triangles > 20000) {
    transforms.push(fns.meshopt({ encoder: MeshoptEncoder, level: OPTS.level }))
  }

  if (transforms.length) await doc.transform(...transforms)

  /* --- KTX2, if asked ---------------------------------------------------- */

  if (OPTS.ktx2) {
    // Deliberately after WebP so that a failure here leaves a file that still
    // works, just larger.
    const { toktx } = await import('@gltf-transform/cli').catch(() => ({ toktx: null }))
    if (!toktx) {
      console.error('  --ktx2 needs @gltf-transform/cli and the toktx binary from KTX-Software.')
      process.exit(1)
    }
    await doc.transform(
      toktx({ mode: 'etc1s', slots: '!normalTexture' }),
      toktx({ mode: 'uastc', slots: 'normalTexture', level: 2, rdo: 4 }),
    )
  }

  /* --- prove nothing that matters moved ---------------------------------- */

  const after = fingerprint(doc)
  const problems = diffFingerprints(before, after)
  if (problems.length) {
    return { file, rejected: problems, sizeBefore, textures }
  }

  /* --- write ------------------------------------------------------------- */

  const target = OPTS.inPlace ? source : join(OPTS.out, file)
  if (!OPTS.dryRun) {
    if (OPTS.inPlace) {
      const keep = join(MODELS, `${basename(file, '.glb')}.original.glb`)
      if (!existsSync(keep)) copyFileSync(source, keep)
    } else {
      mkdirSync(OPTS.out, { recursive: true })
    }
    await io.write(target, doc)
  }

  const sizeAfter = OPTS.dryRun
    ? (await io.writeBinary(doc)).byteLength
    : statSync(target).size

  return { file, sizeBefore, sizeAfter, textures, skinned, triangles: before.triangles, target }
}

/* ===========================================================================
   Inventory — where the bytes actually are
   ---------------------------------------------------------------------------
   Deliberately written against the GLB container itself rather than against
   gltf-transform, so that it runs before anything is installed. The whole
   argument for this script rests on a measurement — that the room is 99%
   texture and 15,657 triangles — and a measurement you have to install five
   packages to reproduce is one people take on trust instead.

   A GLB is a 12-byte header, then length-prefixed chunks: JSON first, binary
   second. Everything below reads the JSON chunk and the image headers inside
   the binary one, which is enough to say what every byte is for.
   =========================================================================== */

function readGLB(path) {
  const data = readFileSync(path)
  if (data.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB')
  const jsonLength = data.readUInt32LE(12)
  const json = JSON.parse(data.subarray(20, 20 + jsonLength).toString('utf8'))
  // The binary chunk's own 8-byte header sits between the two.
  return { json, bin: data.subarray(20 + jsonLength + 8), total: data.length }
}

/** Width, height and format from a PNG or JPEG header. */
function imageDimensions(blob) {
  if (blob.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { width: blob.readUInt32BE(16), height: blob.readUInt32BE(20), format: 'png' }
  }
  if (blob[0] === 0xff && blob[1] === 0xd8) {
    let i = 2
    while (i < blob.length - 9) {
      if (blob[i] !== 0xff) { i += 1; continue }
      const marker = blob[i + 1]
      const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf
        && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
      if (isStartOfFrame) {
        return { height: blob.readUInt16BE(i + 5), width: blob.readUInt16BE(i + 7), format: 'jpg' }
      }
      if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue }
      i += 2 + blob.readUInt16BE(i + 2)
    }
  }
  if (blob.subarray(8, 12).toString() === 'WEBP') return { width: 0, height: 0, format: 'webp' }
  return { width: 0, height: 0, format: '?' }
}

/** Which slot a texture index is bound into, read straight from the JSON. */
function slotsFromJSON(json) {
  const slots = new Map()
  const note = (ref, slot) => {
    if (!ref || ref.index === undefined) return
    const image = json.textures?.[ref.index]?.source
    if (image === undefined) return
    if (!slots.has(image)) slots.set(image, new Set())
    slots.get(image).add(slot)
  }
  for (const material of json.materials || []) {
    const pbr = material.pbrMetallicRoughness || {}
    note(pbr.baseColorTexture, 'baseColorTexture')
    note(pbr.metallicRoughnessTexture, 'metallicRoughnessTexture')
    note(material.normalTexture, 'normalTexture')
    note(material.occlusionTexture, 'occlusionTexture')
    note(material.emissiveTexture, 'emissiveTexture')
    for (const [name, block] of Object.entries(material.extensions || {})) {
      const known = EXTENSION_SLOTS[name]
      if (!known) continue
      for (const [key, slot] of Object.entries(known)) note(block[key], slot)
    }
  }
  return slots
}

function inventory(file) {
  const { json, bin, total } = readGLB(join(MODELS, file))
  const slots = slotsFromJSON(json)

  const textures = (json.images || []).map((image, index) => {
    const view = json.bufferViews[image.bufferView]
    const offset = view.byteOffset || 0
    const blob = bin.subarray(offset, offset + view.byteLength)
    const { width, height, format } = imageDimensions(blob)
    const slotSet = slots.get(index)
    const policy = policyFor(slotSet)
    const scale = Math.min(1, policy.max / Math.max(width || 1, height || 1))
    // A deliberately coarse projection, and labelled as one everywhere it is
    // printed. WebP on photographic and normal-map data lands around 0.5–1.0
    // bits per pixel at these qualities; 0.75 is the middle of that and the
    // only honest number to quote before the encoder has run.
    const projected = Math.round(((width || 0) * scale * (height || 0) * scale * 0.75) / 8)
    // Several of these textures are already smaller than WebP would make them —
    // a 0.2 MB JPEG at 2048² is not improved by re-encoding. The optimiser
    // keeps the original in that case, so the projection has to say so too
    // rather than quoting a number the run will not produce.
    const kept = projected >= view.byteLength
    return {
      name: image.name || `image ${index}`,
      slot: policy.label,
      width,
      height,
      format,
      bytes: view.byteLength,
      kept,
      target: {
        width: kept ? width : Math.round((width || 0) * scale),
        height: kept ? height : Math.round((height || 0) * scale),
        bytes: kept ? view.byteLength : projected,
      },
    }
  })

  let animation = 0
  for (const anim of json.animations || []) {
    for (const sampler of anim.samplers) {
      for (const accessorIndex of [sampler.input, sampler.output]) {
        const accessor = json.accessors[accessorIndex]
        if (accessor?.bufferView !== undefined) {
          animation += json.bufferViews[accessor.bufferView].byteLength
        }
      }
    }
  }

  let triangles = 0
  for (const mesh of json.meshes || []) {
    for (const prim of mesh.primitives) {
      const accessor = prim.indices !== undefined
        ? json.accessors[prim.indices]
        : json.accessors[prim.attributes.POSITION]
      triangles += Math.floor((accessor?.count || 0) / 3)
    }
  }

  const textureBytes = textures.reduce((n, t) => n + t.bytes, 0)
  return {
    file,
    total,
    textures,
    textureBytes,
    animation,
    triangles,
    geometry: total - textureBytes - animation,
    clips: (json.animations || []).length,
  }
}

function printInventory(files) {
  console.log('\nWhere the bytes are\n')
  console.log(
    `  ${'model'.padEnd(24)}${'total'.padStart(9)}${'texture'.padStart(10)}` +
      `${'geometry'.padStart(10)}${'anim'.padStart(8)}${'triangles'.padStart(11)}`,
  )
  console.log(`  ${'─'.repeat(70)}`)

  const all = files.map(inventory)
  for (const m of all) {
    console.log(
      `  ${m.file.padEnd(24)}${fmt(m.total).padStart(9)}${fmt(m.textureBytes).padStart(10)}` +
        `${fmt(m.geometry).padStart(10)}${fmt(m.animation).padStart(8)}` +
        `${m.triangles.toLocaleString().padStart(11)}`,
    )
    if (OPTS.verbose) {
      for (const t of [...m.textures].sort((a, b) => b.bytes - a.bytes)) {
        const to = t.kept
          ? 'kept as-is'.padEnd(21)
          : `${t.target.width}×${t.target.height}`.padEnd(12) + fmt(t.target.bytes).padStart(9)
        console.log(
          `      ${fmt(t.bytes).padStart(8)}  ${`${t.width}×${t.height}`.padEnd(12)}${t.format.padEnd(5)}` +
            `→ ${to}  ${t.slot.padEnd(13)} ${t.name}`,
        )
      }
    }
  }

  const sum = (key) => all.reduce((n, m) => n + m[key], 0)
  const projectedTexture = all.reduce(
    (n, m) => n + m.textures.reduce((t, x) => t + x.target.bytes, 0),
    0,
  )
  // Meshopt on the heavy characters; the room's 0.8 MB of geometry is left
  // alone, which is why this is conditional rather than a blanket factor.
  const projectedGeometry = all.reduce(
    (n, m) => n + (m.triangles > 20000 ? m.geometry * 0.35 : m.geometry),
    0,
  )
  const projectedAnimation = sum('animation') * 0.5

  console.log(`  ${'─'.repeat(70)}`)
  console.log(
    `  ${'total'.padEnd(24)}${fmt(sum('total')).padStart(9)}${fmt(sum('textureBytes')).padStart(10)}` +
      `${fmt(sum('geometry')).padStart(10)}${fmt(sum('animation')).padStart(8)}` +
      `${sum('triangles').toLocaleString().padStart(11)}`,
  )

  const projected = projectedTexture + projectedGeometry + projectedAnimation
  console.log(`\n  Texture is ${(100 * sum('textureBytes') / sum('total')).toFixed(0)}% of the payload.`)
  console.log(
    `  Projected: ${fmt(sum('total'))} → ~${fmt(projected)} (−${pct(sum('total'), projected)}).`,
  )
  console.log(
    '  That projection is arithmetic on pixel counts, not a measurement. Run the\n' +
      '  optimiser for real numbers — it reports what the encoder actually produced.\n',
  )
}

/* ===========================================================================
   Run
   =========================================================================== */

async function main() {
  if (!existsSync(MODELS)) {
    console.error(`No models directory at ${MODELS}`)
    process.exit(1)
  }

  const files = readdirSync(MODELS)
    .filter((f) => f.endsWith('.glb') && !f.endsWith('.original.glb'))
    .filter((f) => !OPTS.only || f === OPTS.only)
    .sort()

  if (!files.length) {
    console.error(OPTS.only ? `No such model: ${OPTS.only}` : 'No .glb files found.')
    process.exit(1)
  }

  if (OPTS.inventory) {
    printInventory(files)
    return
  }

  const mods = await load()

  console.log(`\nOptimising ${files.length} model${files.length === 1 ? '' : 's'}`)
  console.log(`  textures  → WebP, EXT_texture_webp, decoded natively by three`)
  console.log(`  geometry  → EXT_meshopt_compression on anything over 20k triangles`)
  console.log(`  output    → ${OPTS.inPlace ? 'in place, originals kept as *.original.glb' : relative(ROOT, OPTS.out)}`)
  if (OPTS.dryRun) console.log('  DRY RUN — measuring only, nothing written')
  console.log()

  const results = []
  for (const file of files) {
    process.stdout.write(`  ${file.padEnd(26)}`)
    try {
      const result = await optimise(file, mods)
      results.push(result)
      if (result.rejected) {
        console.log('REJECTED')
        for (const problem of result.rejected) console.log(`      · ${problem}`)
      } else {
        console.log(`${fmt(result.sizeBefore).padStart(9)} → ${fmt(result.sizeAfter).padStart(9)}   −${pct(result.sizeBefore, result.sizeAfter)}`)
        if (OPTS.verbose) {
          for (const t of result.textures.sort((a, b) => b.before - a.before)) {
            console.log(
              `      ${fmt(t.before).padStart(8)} → ${fmt(t.after).padStart(8)}  ` +
                `${t.from.padEnd(16)} → ${t.to.padEnd(16)} ${t.slot}  ${t.name}`,
            )
          }
        }
      }
    } catch (error) {
      console.log('FAILED')
      console.log(`      ${error.message}`)
      results.push({ file, failed: error.message })
    }
  }

  /* --- the bottom line --------------------------------------------------- */

  const done = results.filter((r) => r.sizeAfter)
  const rejected = results.filter((r) => r.rejected)
  const failed = results.filter((r) => r.failed)
  const before = done.reduce((n, r) => n + r.sizeBefore, 0)
  const after = done.reduce((n, r) => n + r.sizeAfter, 0)

  console.log(`\n${'─'.repeat(64)}`)
  if (done.length) {
    console.log(`${fmt(before)} → ${fmt(after)}   −${pct(before, after)} across ${done.length} model${done.length === 1 ? '' : 's'}`)
  }
  if (rejected.length) {
    console.log(`\n${rejected.length} rejected — the optimised file changed something the app reads by name.`)
    console.log('Originals are untouched. This is a bug in the transform, not in the model.')
  }
  if (failed.length) {
    console.log(`\n${failed.length} failed to process.`)
  }

  if (done.length && !OPTS.inPlace && !OPTS.dryRun) {
    console.log(`\nWritten to ${relative(ROOT, OPTS.out)}. Look at them in the app before swapping:`)
    console.log('  mv apps/courtroom/public/models apps/courtroom/public/models-original')
    console.log('  mv apps/courtroom/public/models-optimised apps/courtroom/public/models')
  }

  if (OPTS.ktx2 && done.length) {
    console.log(`
KTX2 needs loader wiring that drei does not do for you. Copy the transcoder:

  cp node_modules/three/examples/jsm/libs/basis/basis_transcoder.{js,wasm} \\
     apps/courtroom/public/basis/

and give useGLTF a KTX2Loader in three/Courtroom.jsx and CharacterController.jsx:

  import { KTX2Loader } from 'three-stdlib'
  const gl = useThree((s) => s.gl)
  const { scene } = useGLTF(MODEL, undefined, undefined, (loader) => {
    loader.setKTX2Loader(
      new KTX2Loader().setTranscoderPath('/basis/').detectSupport(gl),
    )
  })

The transcoder is served from this origin, so the room still fetches nothing
third-party.`)
  }

  process.exit(rejected.length || failed.length ? 1 : 0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
