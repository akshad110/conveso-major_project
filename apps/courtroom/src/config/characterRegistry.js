/**
 * Character registry.
 *
 * One entry per court role. Each entry points at a merged runtime GLB in
 * public/models (built by tools/build_characters.py from the original Meshy
 * exports — mesh, skeleton, materials and animation curves copied verbatim).
 *
 * `clips` records the inventory each GLB was built with, for reference and for
 * the debug overlay before the file finishes loading. The controller does not
 * trust it: at runtime the real clip list is read off the loaded GLB.
 *
 * `poseFix` corrects for a resting pose that is rotated or translated relative
 * to the model origin. The judge and clerk need it: their single seated clip
 * walks the body into the chair and turns it ~68 deg on the way in, so the pose
 * they come to rest in is not the pose the model was authored in. Measured with
 * forward kinematics on the shoulder line at the end of the clip, never guessed.
 * Spawn points stay exactly as the courtroom geometry gave them.
 */
import { SPAWN_POINTS, CHARACTER_SCALE } from './courtroomLayout'

const M = (file) => `/models/${file}`
const deg = (d) => (d * Math.PI) / 180

export const CHARACTER_REGISTRY = {
  judge: {
    label: 'Judge',
    model: M('judge.glb'),
    spawn: 'JUDGE_POSITION',
    startPosture: 'seated',
    clips: [
      'STAND_IDLE', 'SIT_DOWN', 'STAND_UP', 'GAVEL', 'SIT_IDLE', 'SIT_WRITE',
      'SPEAK', 'SPEAK_GESTURE', 'LISTEN', 'SIT_IDLE_LOOP', 'WALK', 'RUN',
    ],
    // Re-measured against the current export. The rest clip is SIT_IDLE, whose
    // shoulder line reads 87.6 deg and whose hips end 0.020 m +X / 0.032 m +Z of
    // the origin — so the body is already square to the room and needs almost
    // nothing. The old -67.8 deg correction belonged to the previous export,
    // where the only clip was a SIT_WRITE that turned the body as it sat; left
    // in place against this GLB it swung the bench about 70 deg off the room.
    poseFix: { yaw: deg(2.4), offset: [-0.040, 0, 0.028], why: 'SIT_IDLE rests 2.4 deg off square' },
    note:
      'Full export: seated and standing idles, posture transitions, GAVEL, SPEAK, ' +
      'SPEAK_GESTURE, LISTEN and SIT_WRITE. Nothing is derived. POINT and REACT ' +
      'have no clip of their own and fall back to SPEAK_GESTURE.',
  },
  prosecutor: {
    label: 'Prosecutor',
    model: M('prosecutor.glb'),
    spawn: 'PROSECUTOR_POSITION',
    startPosture: 'seated',
    clips: [
      'STAND_IDLE', 'SIT_IDLE', 'WALK', 'STAND_UP', 'SIT_DOWN',
      'SPEAK_GESTURE', 'SPEAK', 'OBJECTION', 'PRESENT_EVIDENCE', 'RUN',
    ],
  },
  defense: {
    label: 'Defense',
    model: M('defense.glb'),
    spawn: 'DEFENSE_POSITION',
    startPosture: 'seated',
    clips: [
      'STAND_IDLE', 'SIT_IDLE', 'WALK', 'STAND_UP', 'SIT_DOWN',
      'SPEAK_GESTURE', 'SPEAK', 'OBJECTION', 'PRESENT_EVIDENCE', 'REACT', 'RUN',
    ],
  },
  witness: {
    label: 'Witness',
    model: M('witness_male.glb'),
    variants: {
      male: M('witness_male.glb'),
      female: M('witness_female.glb'),
    },
    variant: 'male',
    spawn: 'WITNESS_POSITION',
    startPosture: 'standing',
    clips: [
      'STAND_IDLE', 'SIT_IDLE', 'SIT_DOWN', 'STAND_UP', 'SIT_WRITE',
      'LISTEN', 'NOD', 'SHAKE_HEAD', 'REACT', 'WALK', 'RUN',
    ],
    // Replaced on 2026-09-22 from the user's textured export. The previous file
    // carried no material at all, which is why it rendered white; this one has a
    // baked albedo. It also brought a seated pose and both posture transitions,
    // so a witness can now sit in the box and stand to be sworn. The rest clip
    // is STAND_IDLE and it measures 90.0 deg square to the room, so there is
    // nothing to correct.
    note:
      'Textured export: standing and seated idles, both posture transitions, ' +
      'LISTEN, NOD, SHAKE_HEAD, REACT and SIT_WRITE. Still no speaking clip — ' +
      'SPEAK falls back to NOD, which reads as answering.',
  },
  defendant: {
    label: 'Defendant',
    model: M('defendant_male.glb'),
    variants: {
      male: M('defendant_male.glb'),
      female: M('defendant_female.glb'),
    },
    variant: 'male',
    spawn: 'DEFENDANT_POSITION',
    startPosture: 'seated',
    clips: ['SIT_IDLE', 'STAND_IDLE_ALT', 'WALK', 'STAND_UP', 'SIT_DOWN', 'SHAKE_HEAD', 'RUN'],
  },
  clerk: {
    label: 'Clerk',
    model: M('clerk.glb'),
    spawn: 'CLERK_POSITION',
    startPosture: 'seated',
    clips: ['SIT_WRITE', 'WALK', 'RUN'],
    // Same clip as the judge, same correction: shoulder line +68.4 deg.
    poseFix: { yaw: deg(-68.4), offset: [0.269, 0, -0.236], why: 'SIT_WRITE turns and walks the body in' },
    note: 'Only one seated clip shipped; IDLE_SITTING and WRITE are derived subclips.',
  },
  police: {
    label: 'Police',
    model: M('police.glb'),
    spawn: 'POLICE_POSITION',
    startPosture: 'standing',
    // Rebuilt 2026-09-25 from the coloured officer pack. The previous GLB carried
    // no material at all, which is why she rendered white while everyone else was
    // textured; this export has a baked baseColour / normal / metallicRoughness
    // set and the same mixamorig skeleton as judge.glb, so the merge was exact.
    //
    // Eight clips, all of them, named from what the joints actually do — the pack
    // arrives with Meshy UUIDs, not names:
    //   STAND_IDLE      at attention, spine tilt flat        (3.04 s)
    //   STAND_IDLE_ALT  same stance, a little more breathing (3.04 s)
    //   LISTEN          widest head swing, tracks the speaker(3.04 s)
    //   OATH            right hand up, held ~3 s, then rest  (12.04 s)
    //   WALK / WALK_ALT in-place walk cycles                 (1.04 / 1.08 s)
    //   RUN             in-place run                         (0.71 s)
    //   WALK_FORWARD    root motion, carries 2.60 m          (9.04 s)
    //
    // There is NO seated clip in this pack and no dedicated PRESENT_EVIDENCE —
    // animationMap.js degrades both rather than pretending otherwise.
    clips: [
      'STAND_IDLE', 'STAND_IDLE_ALT', 'LISTEN', 'OATH',
      'WALK', 'WALK_ALT', 'RUN', 'WALK_FORWARD',
    ],
    // Measured on the final frame of STAND_IDLE (the clip ROLE_IDLE.police.standing
    // resolves to): the shoulder line reads 87.73 deg where square to the room is
    // 90, and the hips finish 0.002 m +X / 0.022 m -Z of the origin. Tiny, but it
    // is what stops her drifting off the lane when the idle loops.
    poseFix: { yaw: deg(2.273), offset: [-0.029, 0, -0.001], why: 'STAND_IDLE rests 2.3 deg off square' },
  },
}

/** Debug keyboard order: 1..7 */
export const ROLE_ORDER = ['judge', 'prosecutor', 'defense', 'witness', 'defendant', 'clerk', 'police']

/**
 * The three roles the controls put forward. Every role in ROLE_ORDER stays
 * selectable — these are simply the ones drawn large in the seating plan, because
 * they are the seats you actually want to drive by hand.
 */
export const PRIMARY_ROLES = ['judge', 'prosecutor', 'defendant']

/* --- what this case actually needs ----------------------------------------- */

/**
 * The cast the session asked for, or null for "everything the registry has".
 *
 * Module state, set once by `applySceneConfiguration` during the launch
 * handshake and read by `activeRoles` and `modelManifest` on the first render of
 * the scene. It is not a store and nothing subscribes to it: the configuration
 * arrives before the Canvas mounts, and a cast that changed halfway through a
 * hearing would mean unmounting a character mid-sentence.
 *
 * Null is not the same as empty. Null means no configuration was supplied — a
 * developer opening the room with no Converso session at all — and everything
 * loads, exactly as it did before this existed. An empty list means a
 * configuration that named nothing, which is a mistake worth seeing rather than
 * silently papering over, so it is rejected below and treated as null.
 */
let sceneCast = null
let variantOverrides = {}

/**
 * Pin the cast and the bodies from the session's `configuration`.
 *
 * The room is 226 MB of models and no case uses all of them at once. This is
 * where that gets cut down, and it is worth being precise about why the saving
 * is real: `police.glb` is 27.7 MB and `defendant_female.glb` is 15.8 MB, and a
 * case that names a male defendant and never calls the escorting officer has no
 * use for either. Skipping them is ~45 MB a student does not download.
 *
 * Everything here is defensive because `configuration` is a jsonb column a
 * human edits by hand. A role that is not in the registry is dropped and
 * reported rather than thrown, because a typo in one character's name should
 * cost that character, not the whole hearing.
 *
 * Narrowing the cast narrows who can physically take the witness box. If a case
 * calls a deponent whose role was left out, `witnessStand` will find nobody to
 * walk in — so the returned report names what was dropped, and the caller is
 * expected to log it.
 *
 * @param {{characters?: string[], variants?: Record<string,string>}} config
 * @returns {{characters: string[], variants: Record<string,string>, ignored: string[]}}
 */
export function applySceneConfiguration(config = {}) {
  const ignored = []

  const asked = Array.isArray(config?.characters) ? config.characters : null
  const named = (asked || [])
    .map((role) => String(role || '').toLowerCase())
    .filter((role) => {
      const known = Boolean(CHARACTER_REGISTRY[role])
      if (!known && role) ignored.push(role)
      return known
    })

  // A configuration that named characters but none of them survived validation
  // is a broken configuration, and a courtroom with nobody in it is worse than a
  // courtroom with everybody in it. Fall back rather than render an empty room.
  sceneCast = named.length ? ROLE_ORDER.filter((role) => named.includes(role)) : null

  variantOverrides = {}
  const wanted = config?.variants
  if (wanted && typeof wanted === 'object') {
    for (const [role, variant] of Object.entries(wanted)) {
      const entry = CHARACTER_REGISTRY[String(role).toLowerCase()]
      const key = String(variant || '').toLowerCase()
      // Only a variant the role actually offers. Naming 'female' for a role with
      // one body would otherwise resolve to undefined and load nothing.
      if (entry?.variants?.[key]) variantOverrides[String(role).toLowerCase()] = key
      else ignored.push(`${role}=${variant}`)
    }
  }

  return { characters: sceneCast ?? activeRoles(), variants: { ...variantOverrides }, ignored }
}

/** Forget the session's cast. For tests, and for leaving a hearing. */
export function resetSceneConfiguration() {
  sceneCast = null
  variantOverrides = {}
}

/** Is this role part of the hearing that is loaded right now? */
export function isLoaded(role) {
  return activeRoles().includes(role)
}

/** Resolve a registry entry into everything the controller needs to mount it. */
export function characterPlacement(role) {
  const entry = CHARACTER_REGISTRY[role]
  if (!entry) return null
  const spawn = SPAWN_POINTS[entry.spawn]
  const variant = variantOverrides[role] || entry.variant
  const model = entry.variants ? entry.variants[variant] || entry.model : entry.model
  const fix = entry.poseFix
  const off = fix?.offset || [0, 0, 0]
  return {
    role,
    label: entry.label,
    model,
    position: [
      spawn.position[0] + off[0],
      spawn.position[1] + off[1],
      spawn.position[2] + off[2],
    ],
    rotationY: spawn.rotationY + (fix?.yaw || 0),
    scale: entry.scale ?? CHARACTER_SCALE,
    startPosture: entry.startPosture,
    spawnName: entry.spawn,
    clips: entry.clips,
    note: entry.note,
    poseFix: fix,
  }
}

/** Roles that have a model file to load right now, narrowed to this case's cast. */
export function activeRoles() {
  const roles = sceneCast ?? ROLE_ORDER
  return roles.filter((r) => CHARACTER_REGISTRY[r] && characterPlacement(r)?.model)
}

/**
 * The same placement arithmetic, against a spawn point the role does not own.
 *
 * Four witnesses, the accused and the escorting officer all take the same
 * witness box over the course of a trial, and they are three different
 * characters. A `poseFix` belongs to the character rather than to the seat, so
 * it travels with whoever is standing there.
 */
export function placeAt(role, spawnName) {
  const entry = CHARACTER_REGISTRY[role]
  const spawn = SPAWN_POINTS[spawnName]
  if (!entry || !spawn) return null
  const off = entry.poseFix?.offset || [0, 0, 0]
  return {
    position: [
      spawn.position[0] + off[0],
      spawn.position[1] + off[1],
      spawn.position[2] + off[2],
    ],
    rotationY: spawn.rotationY + (entry.poseFix?.yaw || 0),
  }
}

/**
 * The models to preload, deduplicated — and only the ones this case will mount.
 *
 * This used to return every file in the registry including every unused variant,
 * which meant a case with a male defendant still downloaded the female body. It
 * now asks `characterPlacement` for the single file each active role resolves
 * to, so the manifest and what the scene actually mounts cannot disagree.
 */
export function modelManifest() {
  const out = []
  for (const role of activeRoles()) {
    const model = characterPlacement(role)?.model
    if (model && !out.includes(model)) out.push(model)
  }
  return out
}

/** Every file the registry could ever need, ignoring the cast. For tooling. */
export function allModelFiles() {
  const out = []
  for (const role of ROLE_ORDER) {
    const entry = CHARACTER_REGISTRY[role]
    if (!entry) continue
    const files = entry.variants ? Object.values(entry.variants) : [entry.model]
    for (const f of files) if (f && !out.includes(f)) out.push(f)
  }
  return out
}
