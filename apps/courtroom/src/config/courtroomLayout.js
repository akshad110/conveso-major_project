/**
 * Courtroom layout — spawn points and fixtures.
 *
 * Every number here was measured from CourtRoom.glb itself (world-space AABBs of
 * the model's own nodes, plus vertex Y-histograms to find seat/platform tops).
 * The courtroom model is never modified; characters are placed into it.
 *
 * Facing: motion analysis of the character clips showed character forward is +Z
 * (at t=0, atan2(headFront.x - head.x, .z) ~= 0 in every clip). So a character
 * that must look toward -X (the judge) gets rotationY = -PI/2, and the judge
 * looking back down the room toward +X gets +PI/2.
 *
 * Scale: the courtroom is modelled for a ~2.2 m human — lawyer seat cushion at
 * y=0.61, judge desk 1.04 above its platform, witness/dock rails at 1.38-1.40.
 * The characters are 1.70 m. A uniform 1.30x reconciles every seat, desk and
 * railing at once, which is why we scale the people rather than the room.
 */

export const CHARACTER_SCALE = 1.3

const FACE_JUDGE = -Math.PI / 2 // look toward -X, down the room at the bench
const FACE_ROOM = Math.PI / 2 // look toward +X, out from the bench

/**
 * Named spawn points. `y` is the surface the character's feet or seat rest on:
 * 0 = courtroom floor, 0.56 = judge platform, 0.245 = clerk platform.
 */
export const SPAWN_POINTS = {
  JUDGE_POSITION: {
    position: [-7.256, 0.56, -0.023],
    rotationY: FACE_ROOM,
    surface: 'judge platform (y=0.560)',
    source: 'JudgeTable / JudgeChair world AABB + vertex histogram',
  },
  CLERK_POSITION: {
    position: [-4.755, 0.245, -0.146],
    rotationY: FACE_ROOM,
    surface: 'clerk platform (y=0.245)',
    source: 'clerk desk node world AABB',
  },
  WITNESS_POSITION: {
    position: [-1.388, 0, 3.78],
    rotationY: FACE_JUDGE,
    surface: 'floor, inside witness box (rail y=1.40)',
    source: 'witness box node world AABB',
  },
  DEFENDANT_POSITION: {
    position: [-1.388, 0, -3.58],
    rotationY: FACE_JUDGE,
    surface: 'floor, inside accused dock (rail y=1.38)',
    source: 'accused dock node world AABB',
  },
  PROSECUTOR_POSITION: {
    position: [1.888, 0, 1.911],
    rotationY: FACE_JUDGE,
    surface: 'floor at prosecution table (seat y=0.61)',
    source: 'prosecution table + chair world AABB',
  },
  DEFENSE_POSITION: {
    position: [1.888, 0, -2.789],
    rotationY: FACE_JUDGE,
    surface: 'floor at defense table (seat y=0.61)',
    source: 'defense table + chair world AABB',
  },
  POLICE_POSITION: {
    position: [-2.85, 0, -4.75],
    rotationY: FACE_JUDGE,
    surface: 'floor, on the lane behind the accused dock',
    source: 'no dedicated courtroom node — placed adjacent to the dock',
    // Moved back 1.17 m along the lane on 2026-09-22. She used to stand level
    // with the middle of the dock, at z = -3.58, which is the point the accused
    // steps out onto when he is called to the box — so he walked through her.
    // Behind the dock's rear edge (Accusedbox ends at z = -4.397) is where an
    // escorting officer stands anyway, and it leaves the lane clear.
  },
}

/**
 * The witness box holds one person at a time.
 *
 * Four witnesses, the accused and the escorting officer can all be put in it
 * over the course of the trial, and they are played by three different
 * characters — so when the court calls one, whoever is standing there has to
 * come out and the person called has to walk in. This is the geometry for that
 * walk. It is a rendering decision and nothing else: the engine says who is in
 * the box, never how they got there.
 *
 * `laneX` is the clear lane the walk runs along. Everything else in the room is
 * either at x >= -1.388 (the two boxes, the two tables) or x <= -4.755 (the
 * clerk's desk and the bench), so the strip at x = -2.85 is open floor for its
 * whole length — which is also why the officer already stands on it.
 *
 * `aside` is where the person who was in the box waits: on the same lane, three
 * quarters of a metre past the box, so it is never on the incoming walk's path.
 *
 * Speed is in metres per second of world space, and the room is modelled large
 * — the length of that lane is about 7.4 m, which at 1.6 m/s reads as a steady
 * walk across a courtroom rather than a march.
 */
export const WITNESS_STAND = {
  laneX: -2.85,
  aside: { position: [-2.85, 0, 4.53], rotationY: FACE_JUDGE },
  speed: 1.6,
  /** Radians per second. Slow enough to see the corner, fast enough not to drift. */
  turnRate: 5.5,
  /** Waypoints closer together than this are the same point. */
  epsilon: 0.05,
}

/**
 * Waypoints from one floor position to another, routed along the clear lane.
 *
 * Out to the lane, along it, then in to the target — the path a person actually
 * takes across a room with furniture in it, rather than the straight line that
 * would walk them through the accused dock. Legs that would be a step of nothing
 * are dropped, so a character already standing on the lane simply walks up it.
 *
 * @param {number[]} from [x, y, z]
 * @param {number[]} to   [x, y, z]
 * @returns {number[][]} positions to walk through, ending at `to`
 */
export function laneRoute(from, to, { laneX = WITNESS_STAND.laneX } = {}) {
  const eps = WITNESS_STAND.epsilon
  const y = to[1]
  const raw = [
    [laneX, y, from[2]],
    [laneX, y, to[2]],
    [to[0], y, to[2]],
  ]
  const out = []
  let prev = from
  for (const p of raw) {
    if (Math.hypot(p[0] - prev[0], p[2] - prev[2]) < eps) continue
    out.push(p)
    prev = p
  }
  return out
}

/**
 * The wall-mounted display used for evidence. Plane normal is +X (it faces into
 * the room from the wall behind the bench).
 */
export const EVIDENCE_MONITOR = {
  center: [-7.926, 2.966, -2.267],
  width: 1.92, // along Z
  height: 1.099, // along Y
  rotationY: Math.PI / 2,
  /**
   * With rotationY = +PI/2 the plane's local +X (texture u) maps to world -Z,
   * which is exactly the viewer's right when facing the wall, so u=0 lands on
   * their left and text reads correctly. Flip this if it ever renders mirrored.
   */
  mirrorU: false,
}

export const COURTROOM_MODEL = '/models/CourtRoom.glb'

/** Rough room extents, for clamping the debug orbit camera. */
export const ROOM_BOUNDS = {
  min: [-9.5, 0, -6.5],
  max: [6.5, 4.5, 6.5],
}
