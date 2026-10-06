/**
 * The arithmetic of a walk, with no renderer in it.
 *
 * This is the part of CharacterController that actually moves someone across
 * the floor, kept in its own file for one reason: it can then be run — and
 * checked — without a browser, a GPU or a GLB. The controller holds the
 * THREE.Object3D and the mixer; this holds the geometry.
 *
 * The clip stays an in-place walk cycle and the body is moved by hand, so
 * nothing here depends on root motion being authored into an export. Only one
 * of the seven characters shipped a clip that travels, so a design that needed
 * one would only work for the officer.
 *
 * A pose is a plain `{ x, y, z, yaw }`, mutated in place. The controller copies
 * its object in and out around the call, which is six number assignments a
 * frame and keeps every three.js type on the far side of this boundary.
 */

/** Closer than this to a waypoint and the character has arrived. */
export const ARRIVED = 0.02

/** Signed shortest angle from one yaw to another, in (-PI, PI]. */
export function shortestTurn(from, to) {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from))
}

/**
 * Turn a pose toward a yaw at a bounded rate. Returns true once it is there.
 *
 * Bounded rather than instant because a character who snaps 90 degrees between
 * two frames reads as a glitch; at the default 5.5 rad/s a right-angle corner
 * takes about a third of a second, which is roughly how long a person takes.
 */
export function turnToward(pose, target, delta, rate) {
  const diff = shortestTurn(pose.yaw, target)
  const step = rate * delta
  if (Math.abs(diff) <= step) {
    pose.yaw = target
    return true
  }
  pose.yaw += Math.sign(diff) * step
  return false
}

/**
 * Advance a walk by one frame.
 *
 * The distance budget carries across waypoints, so a corner is turned inside a
 * single frame rather than costing one frame of standing still per leg — at a
 * low frame rate that difference is visible.
 *
 * @param {{x:number,y:number,z:number,yaw:number}} pose   mutated in place
 * @param {{legs:number[][], i:number, facing:number|null, heading:number,
 *          speed:number, turnRate:number}} walk           mutated in place
 * @param {number} delta seconds since the last frame
 * @returns {boolean} true once the route is walked and the facing is settled
 */
export function advanceWalk(pose, walk, delta) {
  let budget = walk.speed * delta

  while (budget > 0 && walk.i < walk.legs.length) {
    const leg = walk.legs[walk.i]
    const dx = leg[0] - pose.x
    const dz = leg[2] - pose.z
    const dist = Math.hypot(dx, dz)
    // Face the way you are going. Character forward is +Z, hence atan2(x, z).
    if (dist > ARRIVED) walk.heading = Math.atan2(dx, dz)
    if (dist <= Math.max(budget, ARRIVED)) {
      pose.x = leg[0]
      pose.y = leg[1]
      pose.z = leg[2]
      budget -= dist
      walk.i += 1
      continue
    }
    const k = budget / dist
    pose.x += dx * k
    pose.z += dz * k
    budget = 0
  }

  if (walk.i < walk.legs.length) {
    turnToward(pose, walk.heading, delta, walk.turnRate)
    return false
  }

  // Arrived. Square up to the facing the seat asks for before settling, so
  // nobody ends a walk looking at a wall.
  if (walk.facing !== null && !turnToward(pose, walk.facing, delta, walk.turnRate)) {
    return false
  }
  return true
}

/** Straight-line length of a route, in metres. */
export function routeLength(from, legs) {
  let total = 0
  let prev = from
  for (const leg of legs) {
    total += Math.hypot(leg[0] - prev[0], leg[2] - prev[2])
    prev = leg
  }
  return total
}
