/**
 * Keyboard debug controls.
 *
 *   1-7          select character (Judge, Prosecutor, Defense, Witness,
 *                Defendant, Clerk, Police)
 *   I S L O E N  Idle, Speak, Listen, Objection, Present Evidence, Nervous/React
 *   T C G P W    Stand, Sit, Gavel (judge), Point, Walk
 *
 *   F  toggle free orbit camera        0  wide shot
 *   K  cut to the selected character   V  toggle the evidence monitor
 *   M  run the mock AI event feed      R  reset the courtroom
 *   H  hide/show the controls panel
 *
 * Actions always apply to the currently selected character and nobody else — the
 * same rule the Controls panel states in its header. Everything routes through
 * playAnimation(), so a key press exercises exactly the same path an AI event does.
 *
 * `enabled` defaults to true, which is the standalone courtroom and every use of
 * this hook that existed before the option did. It is passed false for a hearing
 * launched from a Converso lesson: R resets the courtroom and M starts a feed of
 * invented events, and a student being graded should not have either. Nothing is
 * disabled here for its own sake — these are a developer's keys and they stay
 * exactly as they are wherever a developer is the one at the keyboard.
 */
import { useEffect } from 'react'
import { playAnimation } from '../state/animationManager'
import { useCourtStore } from '../state/useCourtStore'
import { resetCourtroom } from '../state/courtEvents'
import { startMockFeed, stopMockFeed, isMockRunning } from '../state/mockEventFeed'
import { ROLE_ORDER } from '../config/characterRegistry'
import { cameraForRole } from '../config/cameraPresets'
import { getExhibit } from '../config/exhibits'

/** Key -> logical action. Some are role-sensitive; see actionFor(). */
export const KEY_ACTIONS = {
  i: 'IDLE',
  s: 'SPEAK',
  l: 'LISTEN',
  o: 'OBJECTION',
  e: 'PRESENT_EVIDENCE',
  n: 'NERVOUS',
  t: 'STAND',
  c: 'SIT',
  g: 'GAVEL',
  p: 'POINT',
  w: 'WALK',
}

export const KEY_HELP = [
  ['1 - 7', 'Select Judge / Prosecutor / Defense / Witness / Defendant / Clerk / Police'],
  ['I', 'Idle'],
  ['S', 'Speak'],
  ['L', 'Listen'],
  ['O', 'Objection'],
  ['E', 'Present evidence'],
  ['N', 'Nervous / React'],
  ['T', 'Stand'],
  ['C', 'Sit'],
  ['G', 'Gavel (judge)'],
  ['P', 'Point'],
  ['W', 'Walk'],
  ['K', 'Cut camera to selection'],
  ['0', 'Wide shot'],
  ['F', 'Free orbit camera'],
  ['V', 'Toggle evidence monitor'],
  ['M', 'Run mock AI feed'],
  ['R', 'Reset courtroom'],
  ['H', 'Show / hide controls'],
]

function actionFor(role, action) {
  if (action === 'IDLE') return '__IDLE__'
  if (action === 'NERVOUS') {
    return role === 'witness' || role === 'defendant' ? 'NERVOUS' : 'REACT'
  }
  return action
}

export default function useDebugControls({ onToggleOverlay, enabled = true } = {}) {
  useEffect(() => {
    if (!enabled) return undefined

    const onKey = (ev) => {
      const tag = ev.target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || ev.target?.isContentEditable) return
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return

      const s = useCourtStore.getState()
      const key = ev.key.toLowerCase()

      // character selection
      const digit = Number(ev.key)
      if (Number.isInteger(digit) && digit >= 1 && digit <= ROLE_ORDER.length) {
        s.selectRole(ROLE_ORDER[digit - 1])
        ev.preventDefault()
        return
      }
      if (ev.key === '0') {
        s.setCamera('CAMERA_WIDE')
        return
      }

      // animations
      if (KEY_ACTIONS[key]) {
        const role = s.selectedRole
        playAnimation(role, actionFor(role, KEY_ACTIONS[key]))
        ev.preventDefault()
        return
      }

      switch (key) {
        case 'f':
          s.toggleCameraMode()
          break
        case 'k':
          s.setCamera(cameraForRole(s.selectedRole))
          break
        case 'v':
          if (s.evidence.visible) s.hideEvidence()
          else s.showEvidence({ id: 'EXHIBIT_A', ...getExhibit('EXHIBIT_A') })
          break
        case 'm':
          if (isMockRunning()) stopMockFeed()
          else startMockFeed()
          break
        case 'r':
          resetCourtroom()
          break
        case 'h':
          onToggleOverlay?.()
          break
        default:
          break
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onToggleOverlay, enabled])
}
