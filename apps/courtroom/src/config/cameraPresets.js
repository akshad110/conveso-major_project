/**
 * Camera presets.
 *
 * Positions are framed around the measured spawn points in courtroomLayout.js.
 * Characters render ~2.21 m tall (1.70 m x 1.30 scale), so standing eye level is
 * ~2.0 m and seated eye level is ~1.3 m above whatever surface they sit on.
 *
 * Every character except the judge faces -X (toward the bench), so a face-on
 * close-up sits on the -X side of them and looks back toward +X.
 */

export const CAMERA_PRESETS = {
  CAMERA_WIDE: {
    label: 'Wide',
    position: [5.6, 3.3, 0.2],
    target: [-5.0, 1.5, 0],
    fov: 45,
  },
  CAMERA_JUDGE: {
    label: 'Judge',
    position: [-4.1, 2.5, 1.35],
    target: [-7.1, 1.95, 0.0],
    fov: 34,
  },
  CAMERA_CLERK: {
    label: 'Clerk',
    position: [-2.1, 2.0, 2.3],
    target: [-4.7, 1.35, -0.15],
    fov: 40,
  },
  CAMERA_PROSECUTOR: {
    label: 'Prosecutor',
    position: [-1.3, 2.2, 3.1],
    target: [1.75, 1.7, 1.95],
    fov: 38,
  },
  CAMERA_DEFENSE: {
    label: 'Defense',
    position: [-1.3, 2.2, -4.0],
    target: [1.75, 1.7, -2.75],
    fov: 38,
  },
  CAMERA_WITNESS: {
    label: 'Witness',
    position: [1.7, 2.3, 5.1],
    target: [-1.3, 1.8, 3.85],
    fov: 36,
  },
  CAMERA_DEFENDANT: {
    label: 'Defendant',
    position: [1.7, 2.1, -4.8],
    target: [-1.3, 1.5, -3.6],
    fov: 36,
  },
  CAMERA_POLICE: {
    label: 'Police',
    // Re-aimed when the officer moved back off the dock's exit. A three-quarter
    // look into the rear corner rather than the flat side-on shot that aiming
    // straight down the lane would give. When she is in the witness box the
    // renderer uses CAMERA_WITNESS instead — see state/witnessStand.js.
    position: [0.6, 2.3, -3.0],
    target: [-2.85, 1.75, -4.6],
    fov: 40,
  },
  CAMERA_EVIDENCE: {
    label: 'Evidence',
    position: [-4.55, 2.98, -2.267],
    target: [-7.9, 2.966, -2.267],
    fov: 30,
  },
  CAMERA_BENCH_REVERSE: {
    label: 'Bench reverse',
    position: [-6.6, 2.7, 0.0],
    target: [2.0, 1.6, 0.0],
    fov: 50,
  },
}

export const DEFAULT_CAMERA = 'CAMERA_WIDE'

/** Which camera to cut to when a given role becomes the focus. */
export const ROLE_CAMERA = {
  judge: 'CAMERA_JUDGE',
  clerk: 'CAMERA_CLERK',
  prosecutor: 'CAMERA_PROSECUTOR',
  defense: 'CAMERA_DEFENSE',
  witness: 'CAMERA_WITNESS',
  defendant: 'CAMERA_DEFENDANT',
  police: 'CAMERA_POLICE',
}

/** Seconds to travel between presets. 0 = hard cut. */
export const CAMERA_TRANSITION = 0.9

export function cameraForRole(role) {
  return ROLE_CAMERA[role] || DEFAULT_CAMERA
}

export function getPreset(name) {
  return CAMERA_PRESETS[name] || CAMERA_PRESETS[DEFAULT_CAMERA]
}
