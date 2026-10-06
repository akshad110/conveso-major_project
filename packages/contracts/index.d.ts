/**
 * The eight shapes the integration plan asks for, written once.
 *
 * TypeScript consumers (the LMS) get these; JavaScript consumers (the
 * courtroom, the classroom, the engine's verifier) get the runtime half from
 * index.mjs. Both halves describe the same wire, and tools/verify-contracts.mjs
 * checks that the names in this file are the names the engine actually emits.
 */

/* --- identity ------------------------------------------------------------ */

/**
 * Who Converso says you are. There is exactly one source for this — Clerk, via
 * the LMS — and no other application in the suite has a login screen.
 */
export interface UserSession {
  userId: string;
  name: string | null;
  imageUrl: string | null;
}

/* --- simulations --------------------------------------------------------- */

export type SimulationKind = "courtroom" | "classroom";

export type SessionStatus =
  | "pending"
  | "active"
  | "completed"
  | "abandoned"
  | "expired";

export type PlayableRole = "judge" | "prosecutor" | "defense";

/**
 * The catalogue entry: a simulation a lesson can launch.
 *
 * The plan sketched this with `courseId` and `lessonId`. Converso has neither
 * table — a lesson in Converso is a row in `companions` — so the link is
 * `companionId`, and the fields below are the columns db/migrations actually
 * creates. A type that describes columns which do not exist is worse than no
 * type at all.
 */
export interface Simulation {
  id: string;
  /** Stable, human-readable key. What a URL and a seed script refer to. */
  slug: string;
  companionId: string | null;
  kind: SimulationKind;
  title: string;
  description: string | null;
  subject: string | null;
  /** Passed to the trial engine as `new TrialEngine({ caseId })`. */
  caseId: string | null;
  difficulty: "easy" | "medium" | "hard";
  published: boolean;
  configuration: SimulationConfiguration;
  createdAt: string;
  updatedAt: string;
}

/**
 * Everything the heavy app needs in order to decide what to download.
 *
 * `characters` is the load list: a case with no police officer does not ship
 * the officer's 27 MB. `animations` narrows it further, to the clips that role
 * can actually be asked for.
 */
export interface SimulationConfiguration {
  characters?: string[];
  animations?: Record<string, string[]>;
  exhibits?: string[];
  language?: string;
  register?: "formal" | "casual";
  speed?: number;
  [key: string]: unknown;
}

/** One student's one attempt. Created by Converso, consumed by the heavy app. */
export interface SimulationSession {
  id: string;
  simulationId: string;
  userId: string;
  companionId: string | null;
  /**
   * Copied from the simulation when the session is read, not stored twice. It
   * is here because every consumer branches on it immediately.
   */
  kind: SimulationKind;
  role: PlayableRole | null;
  status: SessionStatus;
  launchedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  expiresAt: string;
  metadata: Record<string, unknown>;
}

/** What Converso hands the browser when a simulation starts. */
export interface SimulationLaunch {
  session: SimulationSession;
  simulation: Simulation;
  /** Short-lived, signed, and never inspected by the browser. */
  token: string;
  /** Where to send the student. Already carries the token. */
  url: string;
}

/* --- results ------------------------------------------------------------- */

export interface CourtroomPerformance {
  legalReasoning: number;
  questioning: number;
  evidenceHandling: number;
}

export interface CourtroomResult {
  kind: "courtroom";
  role: PlayableRole | null;
  verdict: "guilty" | "not_guilty" | null;
  completed: boolean;
  objectionsRaised: number;
  correctObjections: number;
  evidencePresented: number;
  rulings: number;
  duration: number;
  performance: CourtroomPerformance;
  transcript: string;
  /** Derived on the server. A value sent by the browser is discarded. */
  score: number;
}

export interface ClassroomResult {
  kind: "classroom";
  language: string | null;
  register: "formal" | "casual" | null;
  questionsAsked: number;
  phrasesPractised: number;
  duration: number;
  completed: boolean;
  score: number;
}

export type SimulationResult = (CourtroomResult | ClassroomResult) & {
  id: string;
  sessionId: string;
  completedAt: string;
};

/* --- the courtroom wire -------------------------------------------------- */

export type CourtRole =
  | "judge" | "prosecutor" | "defense"
  | "witness" | "defendant" | "clerk" | "police";

export type CourtAction =
  | "SPEAK" | "STAND" | "SIT" | "QUESTION_WITNESS" | "ANSWER" | "OBJECT"
  | "RULE" | "PRESENT_EVIDENCE" | "SHOW_EVIDENCE" | "GAVEL" | "POINT"
  | "REACT" | "ADMIT_EVIDENCE" | "EXCLUDE_EVIDENCE" | "LISTEN" | "WAIT";

/**
 * What a model — or a person in the human seat — proposes.
 *
 * This is a proposal, not an instruction. It goes through the same validator
 * either way, and a refusal comes back as a re-ask rather than as an error.
 * Note what is absent: no clip name, no bone, no coordinate, no camera vector.
 */
export interface AgentAction {
  action: CourtAction;
  agent: CourtRole;
  speech?: string;
  reason?: string;
  target?: CourtRole | null;
  evidence?: string;
  ruling?: "sustained" | "overruled";
}

/** A semantic beat of the hearing. The renderer decides how it looks. */
export interface CourtEvent {
  type: "COURT_EVENT";
  id: string;
  event: string;
  agent: CourtRole;
  action: CourtAction;
  /** A logical action name, never a GLB clip. */
  animation: string;
  /** A preset name, never a position. */
  camera: string;
  speech: string | null;
  target: CourtRole | null;
  phase: string | null;
  reason: string | null;
  duration: number;
  speaks: boolean;
  interrupt: boolean;
  at: string;
  evidence?: Evidence | string;
  ruling?: string;
  objection?: string;
}

export interface Evidence {
  id: string;
  label: string;
  kind?: "document" | "photo" | "physical" | "testimony" | "video";
  status?: "unmarked" | "marked" | "introduced" | "admitted" | "excluded";
  description?: string;
  source?: string;
}

export interface CourtState {
  phase: string;
  turn: CourtRole | null;
  witnessInBox: CourtRole | null;
  exhibits: Evidence[];
  rulings: Array<{ objection: string; ruling: string; by: CourtRole }>;
  transcriptLength: number;
  closed: boolean;
}

/* --- the classroom wire -------------------------------------------------- */

export interface ClassroomSession {
  id: string;
  userId: string;
  language: string;
  register: "formal" | "casual";
  startedAt: string;
  endedAt: string | null;
  questionsAsked: number;
  attendance: "present" | "left_early" | "absent";
}

/* --- runtime half -------------------------------------------------------- */

export declare const SESSION_STATUS: Record<string, SessionStatus>;
export declare const SESSION_STATUS_LIST: SessionStatus[];
export declare const SESSION_TRANSITIONS: Record<SessionStatus, SessionStatus[]>;
export declare function canTransition(from: SessionStatus, to: SessionStatus): boolean;

export declare const SIMULATION_KIND: Record<string, SimulationKind>;
export declare const SIMULATION_KIND_LIST: SimulationKind[];
export declare const LAUNCH_TOKEN_TTL_SECONDS: number;
export declare const SESSION_TTL_SECONDS: number;

export declare const FRAME_SOURCE: Record<SimulationKind, string>;
export declare const SIMULATION_FRAME_SOURCES: string[];
export declare const FRAME_MESSAGES: { RETURN_TO_LESSON: "RETURN_TO_LESSON" };

export declare const COURT_ACTIONS: CourtAction[];
export declare const COURT_ROLES: CourtRole[];
export declare const PLAYABLE_ROLES: PlayableRole[];
export declare const ENGINE_MESSAGES: string[];
export declare const CLIENT_MESSAGES: string[];
export declare const CAMERA_PRESETS: string[];
export declare const ROLE_ANIMATIONS: Record<CourtRole, string[]>;

export declare const CLASSROOM_LANGUAGES: string[];
export declare const CLASSROOM_REGISTERS: Array<"formal" | "casual">;

export declare const PERFORMANCE_AXES: Array<keyof CourtroomPerformance>;
export declare function normalizeCourtroomResult(raw: unknown, limits?: Record<string, number>): CourtroomResult;
export declare function scoreCourtroom(r: Partial<CourtroomResult>): number;
export declare function normalizeClassroomResult(raw: unknown, limits?: Record<string, number>): ClassroomResult;
export declare function scoreClassroom(r: Partial<ClassroomResult>): number;

export declare function problemsWithSessionRequest(body: unknown): string[];
export declare function problemsWithResult(body: unknown, kind?: SimulationKind): string[];

export declare const LAUNCH_ERRORS: Record<string, string>;
export declare const LAUNCH_ERROR_TEXT: Record<string, string>;
