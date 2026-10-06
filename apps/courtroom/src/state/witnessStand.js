/**
 * Who is standing in the witness box.
 *
 * The court can put six different people in one box — four witnesses, the
 * accused, and the officer who escorted him — and between them they are three
 * different characters. Only one of them lives there. So when the engine seats
 * somebody new, whoever is standing in the box has to come out and the person
 * called has to walk in.
 *
 * This is presentation and nothing else. The engine decides who is being
 * examined and announces it in its own state snapshot (`activeWitnessRole`);
 * this file decides that the picture of that is a walk, which way round the
 * room it goes, and which clip plays on the way. Nothing here is sent back to
 * the engine, and no legal state is read beyond the one field.
 *
 * Reconciliation rather than reaction: the engine's snapshot says who *should*
 * be in the box, and `reconcile()` closes the gap between that and who is
 * actually there. That way a snapshot arriving before the GLBs have finished
 * loading is not lost — the registry tells us when the character turns up and
 * we try again.
 */
import { CHARACTER_REGISTRY, placeAt } from '../config/characterRegistry'
import { WITNESS_STAND, laneRoute } from '../config/courtroomLayout'
import { cameraForRole } from '../config/cameraPresets'
import { getCharacter, onRegistryChange } from './animationManager'

/** The roles a case can put in the box. Anything else is treated as nobody. */
export const STAND_ROLES = ['witness', 'defendant', 'police']

/** Whose box it is when the court is not examining anyone. */
const DEFAULT_HOLDER = 'witness'

/** What the court says. */
let intent = null
/** What the room shows. The witness starts in the box, so this starts there. */
let placed = DEFAULT_HOLDER

const livesInTheBox = (role) => CHARACTER_REGISTRY[role]?.spawn === 'WITNESS_POSITION'

/** Walk a character into the box and square them up to the bench. */
function takeTheStand(role) {
  const handle = getCharacter(role)
  const box = placeAt(role, 'WITNESS_POSITION')
  if (!handle?.walkTo || !box) return false
  return handle.walkTo(laneRoute(handle.where(), box.position), box.rotationY)
}

/**
 * Walk a character out of the box. Someone who has a seat of their own goes
 * back to it; the witness, whose seat this is, waits on the lane beside it
 * until the box is free again.
 */
function stepDown(role) {
  const handle = getCharacter(role)
  if (!handle?.walkTo) return false
  const to = livesInTheBox(role) ? WITNESS_STAND.aside : handle.home()
  return handle.walkTo(laneRoute(handle.where(), to.position), to.rotationY)
}

/** Close the gap between who should be in the box and who is. */
function reconcile() {
  const holder = intent || DEFAULT_HOLDER
  if (holder === placed) return placed
  const handle = getCharacter(holder)
  // Not mounted yet — leave `placed` alone and let the registry call us back.
  if (!handle?.walkTo) return placed
  if (placed && placed !== holder) stepDown(placed)
  takeTheStand(holder)
  placed = holder
  return placed
}

/**
 * The court has seated someone. `role` is the engine's `activeWitnessRole`.
 *
 * @param {string|null} role
 * @returns {string} the role now walking into the box
 */
export function setStandOccupant(role) {
  intent = STAND_ROLES.includes(role) ? role : null
  return reconcile()
}

/** Who the room currently shows in the box. */
export function standOccupant() {
  return placed
}

/**
 * The preset that actually shows this agent right now.
 *
 * A role's camera is framed on the seat that role owns, and for most of the
 * trial that is where they are. It stops being true the moment the court calls
 * one of them to give evidence: the investigating officer's preset looks at the
 * floor beside the dock, and while she is in the box that is a shot of nobody.
 *
 * Only the agent's *own* preset is redirected. A beat that deliberately cuts
 * wide, or to the evidence monitor, is the engine framing something other than
 * the speaker and is left exactly as sent.
 *
 * @param {string} preset the named preset the engine chose
 * @param {string} [agent] whose beat this is
 */
export function framing(preset, agent) {
  if (!preset || !agent || agent !== placed) return preset
  return preset === cameraForRole(agent) ? 'CAMERA_WITNESS' : preset
}

/** Back to the start: everyone to their own spawn, the witness in the box. */
export function resetStand() {
  intent = null
  for (const role of STAND_ROLES) {
    if (role === DEFAULT_HOLDER) continue
    getCharacter(role)?.walkHome?.()
  }
  placed = DEFAULT_HOLDER
  const holder = getCharacter(DEFAULT_HOLDER)
  if (holder?.walkTo) {
    const box = placeAt(DEFAULT_HOLDER, 'WITNESS_POSITION')
    if (box) holder.walkTo(laneRoute(holder.where(), box.position), box.rotationY)
  }
}

// A character that mounts after the court has already spoken still gets put in
// the right place.
onRegistryChange(() => reconcile())
