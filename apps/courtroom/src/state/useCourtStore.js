import { create } from 'zustand'
import { DEFAULT_CAMERA } from '../config/cameraPresets'
import { ROLE_ORDER, CHARACTER_REGISTRY } from '../config/characterRegistry'

const initialCharacters = () => {
  const out = {}
  for (const role of ROLE_ORDER) {
    const entry = CHARACTER_REGISTRY[role]
    out[role] = {
      role,
      label: entry.label,
      status: entry.model ? 'pending' : 'missing',
      clips: [],
      current: null, // real clip playing
      action: null, // logical action requested
      fallback: false,
      reason: '',
      posture: entry.startPosture,
    }
  }
  return out
}

const MAX_LOG = 40

/**
 * The human seat, mirrored from the engine.
 *
 * Every field here except `startDismissed` and `error` is a copy of what the
 * engine broadcast — the frontend never decides who is playing, what they may do
 * on their turn, or whether their answer was accepted. `prompt` is the engine's
 * own YOUR_TURN payload, kept verbatim, because it is the list of things the
 * Courtroom State Engine has already worked out are legal right now.
 */
const initialHuman = () => ({
  role: null,
  label: null,
  seats: [],
  /** The open question, or null when the court is not waiting on the person. */
  prompt: null,
  waiting: false,
  turnsPlayed: 0,
  handOffs: 0,
  /** How the last wait ended: { resolution, reason }. */
  lastEnd: null,
  /** The engine's most recent refusal, shown verbatim and never interpreted. */
  error: null,
  /** False until a seat has been chosen (or the choice declined). */
  startDismissed: false,
})

/**
 * UI-facing state. Deliberately does NOT hold three.js objects or per-frame
 * values — the animation controllers are imperative and live in
 * state/animationManager.js so that playing a clip never re-renders the scene.
 */
export const useCourtStore = create((set, get) => ({
  // --- court ---------------------------------------------------------------
  courtState: 'PRE_SESSION',
  lastEvent: null,
  log: [],
  dialogue: { speaker: null, text: '', paused: false, streaming: false },
  /**
   * The AI engine's own snapshot (phase, transcript, evidence register, queue),
   * as it arrives on STATE. Read-only here: the frontend never computes it, and
   * nothing in the render path depends on it — it exists so the HUD and the debug
   * panel can show what the Courtroom State Engine currently believes.
   */
  court: null,

  // --- camera --------------------------------------------------------------
  camera: DEFAULT_CAMERA,
  cameraMode: 'preset', // 'preset' | 'free'

  // --- evidence ------------------------------------------------------------
  evidence: { visible: false, id: null, title: '', body: '', exhibit: '' },

  // --- characters ----------------------------------------------------------
  characters: initialCharacters(),
  selectedRole: 'prosecutor',

  // --- the person at the table ---------------------------------------------
  human: initialHuman(),
  /** The clerk's court record, open or closed. */
  transcriptOpen: false,
  /** True while the pointer is over the clerk, so the room can say why. */
  clerkHover: false,

  // --- loading -------------------------------------------------------------
  courtroomLoaded: false,
  progress: 0,

  // --- connection ----------------------------------------------------------
  connection: 'offline', // offline | connecting | open | error | mock
  /**
   * Where the retry has got to: { attempt, at }.
   *
   * `attempt` counts from 1 for the first retry, and `at` is when the next one
   * is due as a timestamp. Both are here so the notice on screen can say what is
   * actually happening — "trying again in 4s, attempt 3" — rather than showing a
   * spinner that means nothing. Reset to { 0, null } whenever the socket is open
   * or deliberately off, so a stale countdown cannot outlive the outage.
   */
  reconnect: { attempt: 0, at: null },

  setCourtState: (courtState) => set({ courtState }),
  setCourt: (court) => set({ court }),

  pushEvent: (event) =>
    set((s) => ({
      lastEvent: event,
      log: [{ ...event, t: Date.now() }, ...s.log].slice(0, MAX_LOG),
    })),

  setDialogue: (patch) => set((s) => ({ dialogue: { ...s.dialogue, ...patch } })),

  setCamera: (camera) => set({ camera, cameraMode: 'preset' }),
  setCameraMode: (cameraMode) => set({ cameraMode }),
  toggleCameraMode: () =>
    set((s) => ({ cameraMode: s.cameraMode === 'free' ? 'preset' : 'free' })),

  showEvidence: (evidence) => set({ evidence: { visible: true, ...evidence } }),
  hideEvidence: () => set((s) => ({ evidence: { ...s.evidence, visible: false } })),

  selectRole: (selectedRole) => set({ selectedRole }),

  setCharacterStatus: (role, patch) =>
    set((s) => ({
      characters: { ...s.characters, [role]: { ...s.characters[role], ...patch } },
    })),

  setCourtroomLoaded: (courtroomLoaded) => set({ courtroomLoaded }),
  setProgress: (progress) => set({ progress }),
  setConnection: (connection) => set({ connection }),
  setReconnect: (reconnect) => set({ reconnect }),

  // --- the person at the table ---------------------------------------------

  /** HUMAN_ROLE: the engine confirming which seat is played by a person. */
  setHumanSeat: ({ role = null, label = null, seats }) =>
    set((s) => ({
      human: {
        ...s.human,
        role,
        label,
        seats: seats?.length ? seats : s.human.seats,
        error: null,
        // Losing the seat mid-question also closes the question.
        prompt: role ? s.human.prompt : null,
        waiting: role ? s.human.waiting : false,
      },
    })),

  /** YOUR_TURN: the court is waiting, and this is what it will accept. */
  setHumanPrompt: (prompt) =>
    set((s) => ({ human: { ...s.human, prompt, waiting: true, error: null } })),

  /**
   * YOUR_TURN_END: answered, handed over, passed, or cancelled.
   *
   * The end names the question it closes. A close that names an *older* question
   * than the one on screen is a message arriving behind the one that replaced it,
   * and obeying it would blank a live question and leave the person watching their
   * own trial with no way to speak. So the panel only clears when the court is
   * closing the question the panel is actually showing.
   */
  endHumanTurn: ({ id = null, resolution = null, reason = null } = {}) =>
    set((s) => {
      const open = s.human.prompt
      const stale = id !== null && open?.id != null && open.id !== id
      if (stale) return { human: { ...s.human, lastEnd: { resolution, reason } } }
      return {
        human: {
          ...s.human,
          prompt: null,
          waiting: false,
          lastEnd: { resolution, reason },
          turnsPlayed: resolution === 'decision' ? s.human.turnsPlayed + 1 : s.human.turnsPlayed,
          handOffs: resolution === 'handoff' ? s.human.handOffs + 1 : s.human.handOffs,
        },
      }
    }),

  /** An engine ERROR, shown as sent. */
  setHumanError: (error) => set((s) => ({ human: { ...s.human, error: error || null } })),

  dismissStart: () => set((s) => ({ human: { ...s.human, startDismissed: true } })),
  resetHuman: () => set({ human: initialHuman() }),

  openTranscript: () => set({ transcriptOpen: true }),
  closeTranscript: () => set({ transcriptOpen: false }),
  toggleTranscript: () => set((s) => ({ transcriptOpen: !s.transcriptOpen })),
  setClerkHover: (clerkHover) => set({ clerkHover }),

  /** Roles that finished loading and have at least one clip. */
  readyRoles: () =>
    Object.values(get().characters)
      .filter((c) => c.status === 'ready')
      .map((c) => c.role),
}))

export const courtStore = useCourtStore
