/**
 * Animation map — logical court actions -> real GLB clip names.
 *
 * The source clips were named with opaque Meshy UUIDs. Their identities were
 * established by forward-kinematics analysis of the actual curves (hip height,
 * root travel, hand path length and peak height, head yaw/pitch swings and
 * zero-crossings), then renamed during the merge step. tools/build_characters.py
 * holds the per-UUID justification.
 *
 * Nothing in here assumes a clip exists. `resolveAction()` walks a candidate
 * chain and falls back to the closest available clip, and finally to the role's
 * idle, so a missing clip degrades instead of throwing.
 */

/** Playback semantics for each real clip name we may encounter. */
export const CLIP_META = {
  STAND_IDLE: { posture: 'standing', loop: true },
  STAND_IDLE_ALT: { posture: 'standing', loop: true },
  SIT_IDLE: { posture: 'seated', loop: true },
  LISTEN: { posture: 'standing', loop: true },

  // Posture transitions. The manager inserts these automatically.
  STAND_UP: { posture: 'standing', from: 'seated', loop: false, transition: true },
  SIT_DOWN: { posture: 'seated', from: 'standing', loop: false, transition: true },
  SIT_WRITE: { posture: 'seated', from: 'standing', loop: false },

  // One-shot gestures: play, then auto-return to the posture's idle.
  SPEAK: { posture: 'standing', loop: true },
  SPEAK_GESTURE: { posture: 'standing', loop: true },
  OBJECTION: { posture: 'standing', loop: false, autoReturn: true },
  PRESENT_EVIDENCE: { posture: 'standing', loop: false, autoReturn: true },
  REACT: { posture: 'standing', loop: false, autoReturn: true },
  NOD: { posture: 'standing', loop: false, autoReturn: true },
  SHAKE_HEAD: { posture: 'standing', loop: false, autoReturn: true },

  // Locomotion. WALK/WALK_ALT/RUN are in-place loops; WALK_FORWARD carries
  // ~2.6 m of root translation, which is what makes it usable for escorting.
  WALK: { posture: 'standing', loop: true, inPlace: true },
  WALK_ALT: { posture: 'standing', loop: true, inPlace: true },
  RUN: { posture: 'standing', loop: true, inPlace: true },
  WALK_FORWARD: { posture: 'standing', loop: true, rootMotion: true },

  // The officer's oath: right hand rises to +0.135 m above Spine2 by t=0.5,
  // is held there until t~3.5 with the head turned toward the bench, then comes
  // down. The remaining 8.5 s of the 12.04 s clip is her standing still, so the
  // trimmed OATH_SWEAR below is what actually gets played.
  OATH: { posture: 'standing', loop: false, autoReturn: true },
}

export const DEFAULT_CLIP_META = { posture: 'standing', loop: true }

export function clipMeta(clipName) {
  return CLIP_META[clipName] || DERIVED_META[clipName] || DEFAULT_CLIP_META
}

/**
 * Clips synthesised at load time from part of another clip, for characters that
 * shipped with too few animations. Fractions of the source clip's duration.
 */
export const DERIVED_CLIPS = {
  // No judge entry. The judge used to need one — the old export was a single
  // 6.53 s SIT_WRITE that every seated beat had to be cut out of. The judge
  // supplied since then carries its own STAND_IDLE, SIT_DOWN, STAND_UP, GAVEL,
  // SIT_IDLE, SIT_IDLE_LOOP, SIT_WRITE, SPEAK, SPEAK_GESTURE and LISTEN, so the
  // chains below reach real clips and nothing has to be derived.
  clerk: {
    // The clerk shipped exactly one seated clip: SIT_WRITE, which sits down
    // (hips 0.8 -> 0.5) and then writes with the head pitched down 77 deg.
    // The tail is the only genuinely seated motion available, so both the
    // seated idle and the writing loop come out of it.
    IDLE_SITTING_LOOP: { from: 'SIT_WRITE', start: 0.72, end: 1.0, loop: true, posture: 'seated' },
    WRITE_LOOP: { from: 'SIT_WRITE', start: 0.4, end: 1.0, loop: true, posture: 'seated' },
  },
  police: {
    // OATH runs 12.04 s but the gesture is over by ~4.3 s — hand up at 0.5,
    // held to 3.5, back at rest by 4.2. The tail is her standing still, which
    // the idle already does better. Cutting at 0.36 keeps the whole raise, the
    // hold and the release, so auto-return fires when the gesture ends rather
    // than eight seconds later.
    OATH_SWEAR: { from: 'OATH', start: 0.0, end: 0.36, loop: false, autoReturn: true, posture: 'standing' },
  },
}

/**
 * Playback semantics for the derived clips, so posture tracking and one-shot
 * auto-return behave exactly as they do for authored clips. Consulted by
 * clipMeta() after CLIP_META, so a derived clip that reuses a real clip name
 * (e.g. the judge's SIT_DOWN) keeps the authored semantics.
 */
const DERIVED_META = Object.values(DERIVED_CLIPS).reduce((acc, byRole) => {
  for (const [name, spec] of Object.entries(byRole)) {
    acc[name] = {
      posture: spec.posture || 'standing',
      loop: spec.loop !== false,
      autoReturn: spec.autoReturn,
    }
  }
  return acc
}, {})

/**
 * Logical action -> ordered candidate clips, per role.
 * First existing clip wins. An empty/exhausted chain falls back to role idle.
 */
export const ACTION_MAP = {
  judge: {
    // Every clip named here exists in judge.glb except the alternates kept in
    // case a later export adds them. Nothing is derived.
    IDLE: ['SIT_IDLE', 'SIT_IDLE_LOOP', 'STAND_IDLE', 'STAND_IDLE_ALT'],
    STAND: ['STAND_UP'],
    SIT: ['SIT_DOWN'],
    SPEAK: ['SPEAK', 'SPEAK_GESTURE'],
    LISTEN: ['LISTEN', 'SIT_IDLE', 'SIT_IDLE_LOOP'],
    GAVEL: ['GAVEL', 'OBJECTION', 'REACT'],
    POINT: ['POINT', 'PRESENT_EVIDENCE', 'SPEAK_GESTURE'],
    REACT: ['REACT', 'SHAKE_HEAD', 'SPEAK_GESTURE'],
    WRITE: ['SIT_WRITE'],
  },
  prosecutor: {
    IDLE_SITTING: ['SIT_IDLE'],
    IDLE_STANDING: ['STAND_IDLE', 'STAND_IDLE_ALT'],
    STAND: ['STAND_UP'],
    SIT: ['SIT_DOWN'],
    SPEAK: ['SPEAK'],
    SPEAK_GESTURE: ['SPEAK_GESTURE', 'SPEAK'],
    OBJECTION: ['OBJECTION'],
    PRESENT_EVIDENCE: ['PRESENT_EVIDENCE'],
    LISTEN: ['LISTEN', 'SIT_IDLE'],
    WALK: ['WALK'],
    REACT: ['REACT', 'SPEAK_GESTURE'],
  },
  defense: {
    IDLE_SITTING: ['SIT_IDLE'],
    IDLE_STANDING: ['STAND_IDLE', 'STAND_IDLE_ALT'],
    STAND: ['STAND_UP'],
    SIT: ['SIT_DOWN'],
    SPEAK: ['SPEAK'],
    SPEAK_GESTURE: ['SPEAK_GESTURE', 'SPEAK'],
    OBJECTION: ['OBJECTION'],
    PRESENT_EVIDENCE: ['PRESENT_EVIDENCE'],
    LISTEN: ['LISTEN', 'SIT_IDLE'],
    WALK: ['WALK'],
    REACT: ['REACT'],
  },
  witness: {
    IDLE: ['STAND_IDLE', 'STAND_IDLE_ALT'],
    IDLE_STANDING: ['STAND_IDLE', 'STAND_IDLE_ALT'],
    IDLE_SITTING: ['SIT_IDLE', 'STAND_IDLE'],
    STAND: ['STAND_UP'],
    SIT: ['SIT_DOWN'],
    // No speaking clip in the witness export. A nod reads as "answering" and is
    // the closest available motion, per the graceful-fallback rule.
    SPEAK: ['SPEAK', 'SPEAK_GESTURE', 'NOD'],
    LISTEN: ['LISTEN', 'STAND_IDLE'],
    NOD: ['NOD'],
    SHAKE_HEAD: ['SHAKE_HEAD'],
    NERVOUS: ['NERVOUS', 'SHAKE_HEAD', 'REACT'],
    REACT: ['REACT', 'SHAKE_HEAD'],
    WALK: ['WALK'],
  },
  defendant: {
    IDLE_SITTING: ['SIT_IDLE'],
    IDLE_STANDING: ['STAND_IDLE_ALT', 'STAND_IDLE'],
    STAND: ['STAND_UP'],
    SIT: ['SIT_DOWN'],
    LISTEN: ['LISTEN', 'SIT_IDLE'],
    NERVOUS: ['NERVOUS', 'SHAKE_HEAD'],
    SPEAK: ['SPEAK', 'PRESENT_EVIDENCE', 'SHAKE_HEAD'],
    WALK: ['WALK'],
  },
  clerk: {
    IDLE_SITTING: ['IDLE_SITTING_LOOP', 'SIT_IDLE'],
    WRITE: ['WRITE_LOOP', 'SIT_WRITE'],
    // The clerk export has no standing or speaking clip. These resolve to the
    // seated idle and are reported as fallbacks in the debug overlay.
    STAND: ['STAND_UP'],
    SPEAK: ['SPEAK', 'SPEAK_GESTURE'],
    LISTEN: ['LISTEN', 'IDLE_SITTING_LOOP'],
    WALK: ['WALK'],
  },
  police: {
    // Rebuilt for the coloured export, which trades the old SIT_IDLE and
    // PRESENT_EVIDENCE for a proper oath, a listening idle and two walk cycles.
    // She is the investigating officer, so she also takes the box — which means
    // she needs the witness's vocabulary (SPEAK / ANSWER / REACT), not just an
    // escort's.
    IDLE: ['STAND_IDLE', 'STAND_IDLE_ALT'],
    IDLE_STANDING: ['STAND_IDLE', 'STAND_IDLE_ALT'],
    // No seated clip exists in this pack. She stands through the whole trial —
    // at the dock, in the lane and in the box — so the seated chain degrades to
    // standing rather than snapping her to a T-pose.
    IDLE_SITTING: ['SIT_IDLE', 'STAND_IDLE', 'STAND_IDLE_ALT'],
    LISTEN: ['LISTEN', 'STAND_IDLE'],
    // Nothing in the pack speaks. The oath is the only clip where she raises a
    // hand and turns her head to address the bench, so it stands in for both
    // answering and presenting — same graceful-fallback rule as the witness.
    SPEAK: ['SPEAK', 'OATH_SWEAR', 'LISTEN'],
    ANSWER: ['SPEAK', 'OATH_SWEAR', 'LISTEN'],
    OATH: ['OATH_SWEAR', 'OATH'],
    PRESENT_EVIDENCE: ['PRESENT_EVIDENCE', 'OATH_SWEAR'],
    NOD: ['NOD', 'LISTEN'],
    SHAKE_HEAD: ['SHAKE_HEAD', 'LISTEN'],
    REACT: ['REACT', 'STAND_IDLE_ALT'],
    WALK: ['WALK', 'WALK_ALT'],
    RUN: ['RUN', 'WALK'],
    ESCORT: ['ESCORT', 'WALK_FORWARD', 'WALK'],
  },
}

/** Where a role comes to rest, by posture. */
export const ROLE_IDLE = {
  judge: { seated: 'IDLE', standing: 'IDLE' },
  prosecutor: { seated: 'IDLE_SITTING', standing: 'IDLE_STANDING' },
  defense: { seated: 'IDLE_SITTING', standing: 'IDLE_STANDING' },
  // Posture-aware since the textured export arrived with SIT_DOWN, SIT_IDLE and
  // STAND_UP. It has to be: a witness who sits used to auto-return to plain
  // IDLE, which resolves to STAND_IDLE, whose posture is 'standing' — so the
  // controller bridged STAND_UP and the witness stood straight back up again.
  witness: { seated: 'IDLE_SITTING', standing: 'IDLE_STANDING' },
  defendant: { seated: 'IDLE_SITTING', standing: 'IDLE_STANDING' },
  clerk: { seated: 'IDLE_SITTING', standing: 'IDLE_SITTING' },
  police: { seated: 'IDLE_STANDING', standing: 'IDLE_STANDING' },
}

/**
 * Resolve a logical action to a clip that actually exists on this character.
 *
 * @param {string} role
 * @param {string} action  logical action name, e.g. 'OBJECTION'
 * @param {Set<string>|string[]} available  clip names present on the character
 * @returns {{clip: string|null, action: string, fallback: boolean, reason: string}}
 */
export function resolveAction(role, action, available) {
  const have = available instanceof Set ? available : new Set(available || [])
  const table = ACTION_MAP[role] || {}

  // 1. direct hit on a real clip name (lets debug tools drive raw clips)
  if (have.has(action)) {
    return { clip: action, action, fallback: false, reason: 'exact clip' }
  }

  // 2. the role's candidate chain
  const chain = table[action] || []
  for (let i = 0; i < chain.length; i++) {
    if (have.has(chain[i])) {
      return {
        clip: chain[i],
        action,
        fallback: i > 0,
        reason: i === 0 ? 'mapped' : `fallback #${i} (${chain[0]} unavailable)`,
      }
    }
  }

  // 3. the role's idle, in either posture
  const idles = ROLE_IDLE[role] || {}
  for (const idleAction of [idles.standing, idles.seated]) {
    if (!idleAction || idleAction === action) continue
    const idleChain = table[idleAction] || []
    for (const clip of idleChain) {
      if (have.has(clip)) {
        return { clip, action, fallback: true, reason: `no clip for ${action}; using idle` }
      }
    }
  }

  // 4. anything at all
  const first = [...have][0]
  return first
    ? { clip: first, action, fallback: true, reason: `no mapping; first available clip` }
    : { clip: null, action, fallback: true, reason: 'character has no clips' }
}

/** Every logical action a role advertises — drives the debug overlay list. */
export function actionsForRole(role) {
  return Object.keys(ACTION_MAP[role] || {})
}
