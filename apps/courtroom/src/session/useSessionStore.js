/**
 * What a launched courtroom knows about the session it is running.
 *
 * Kept apart from `useCourtStore` deliberately. That store holds the trial — who
 * is speaking, what has been admitted, whose turn it is — and every field in it
 * is a copy of something the engine broadcast. This one holds the *booking*: who
 * the student is, which seat Converso sold them, which case was asked for, and
 * whether the launch is still good. A trial reset must not lose the booking, and
 * a failed booking must not leave half a trial on screen, so they do not share a
 * lifetime.
 *
 * Nothing here is ever decided locally. `role` arrives from the session row
 * because Converso stamped it there when the student pressed Start; `caseId` and
 * `characters` arrive from the simulation row. A field this file invents would be
 * a field a student could argue with.
 */
import { create } from 'zustand'

/** 'standalone' | 'opening' | 'open' | 'refused' | 'finished' */
const initial = {
  /**
   * Where this page came from.
   *
   * 'standalone' is the developer's courtroom: no query string, no Converso, no
   * reporting. Everything else is a launch in some stage of working out.
   */
  mode: 'standalone',
  sessionId: null,
  /** The seat Converso sold. null means the student is watching. */
  role: null,
  kind: null,
  title: null,
  description: null,
  difficulty: null,
  /** Which case the engine should try. null means "whatever the engine defaults to". */
  caseId: null,
  /**
   * The cast list for this case, from `simulations.configuration`.
   *
   * A subset of the registry's roles, never a superset — a name here that the
   * registry does not know is dropped rather than guessed at, because a guess
   * ends as a request for a GLB that does not exist and a 404 in the middle of a
   * hearing.
   */
  characters: null,
  variants: null,
  /** Where the student was last time, if Converso had a bookmark. */
  resume: null,
  /** A launch that could not be opened: { code, message }. Shown verbatim. */
  refusal: null,
  /** Set once the result has been accepted, so it is never sent twice. */
  reported: null,
}

export const useSessionStore = create((set, get) => ({
  ...initial,

  /** A launch is in flight. */
  beginLaunch: () => set({ mode: 'opening', refusal: null }),

  /**
   * Converso accepted the token. Everything the hearing needs, in one write.
   *
   * `role` comes off the session and not the simulation: the simulation says what
   * seats exist, the session says which one this student has.
   */
  openSession: ({ session, simulation }) =>
    set({
      mode: 'open',
      sessionId: session?.id ?? null,
      role: session?.role ?? null,
      kind: simulation?.kind ?? session?.kind ?? null,
      title: simulation?.title ?? null,
      description: simulation?.description ?? null,
      difficulty: simulation?.difficulty ?? null,
      caseId: simulation?.caseId ?? null,
      characters: simulation?.configuration?.characters ?? null,
      variants: simulation?.configuration?.variants ?? null,
      resume: session?.progress ?? null,
      refusal: null,
    }),

  /**
   * Converso refused, or could not be reached.
   *
   * The message is whatever came back, printed as it arrived. This app has no
   * business rewording a refusal it does not understand — an invented sentence
   * here is how a student ends up told the wrong thing about their own session.
   */
  refuse: ({ code = null, message = null } = {}) =>
    set({ mode: 'refused', refusal: { code, message } }),

  /** The result Converso stored, including the score it worked out for itself. */
  markReported: (reported) => set({ mode: 'finished', reported: reported ?? null }),

  /** True when there is a Converso to report to. */
  isLaunched: () => get().mode !== 'standalone',
}))

export const sessionStore = useSessionStore
