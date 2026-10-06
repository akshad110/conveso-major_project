'use server';

/**
 * The data layer for the two simulations.
 *
 * Written to match lib/actions/companion.actions.ts exactly: server actions,
 * createSupabaseAdminClient(), throw on error. No new client, no second ORM.
 *
 * One rule runs through the whole file: the Clerk user id comes from auth() and
 * never from an argument. Every read is filtered by it and every write carries
 * it, so a caller who guesses a session id still cannot touch a row that is not
 * theirs. That is the only thing standing between these tables and the internet,
 * because RLS has no Supabase JWT to judge — see db/migrations/0001.
 */

import { auth } from "@clerk/nextjs/server";
import { createSupabaseAdminClient } from "@/lib/supabase";
import {
    SESSION_STATUS,
    SESSION_TTL_SECONDS,
    SIMULATION_KIND,
    canTransition,
    normalizeClassroomResult,
    normalizeCourtroomResult,
} from "@converso/contracts";
import type {
    ClassroomResult,
    CourtroomResult,
    PlayableRole,
    Simulation,
    SimulationKind,
    SimulationSession,
} from "@converso/contracts";

/* ---------------------------------------------------------------------------
   Row mapping
   ---------------------------------------------------------------------------
   Postgres speaks snake_case and the contracts speak camelCase. Converting in
   one place means a column rename is a one-line change here rather than a
   find-and-replace across the app.
   --------------------------------------------------------------------------- */

type SimulationRow = {
    id: string;
    slug: string;
    kind: SimulationKind;
    title: string;
    description: string | null;
    subject: string | null;
    case_id: string | null;
    companion_id: string | null;
    difficulty: "easy" | "medium" | "hard";
    published: boolean;
    configuration: Record<string, unknown> | null;
    created_at: string;
    updated_at: string;
};

type SessionRow = {
    id: string;
    simulation_id: string;
    user_id: string;
    companion_id: string | null;
    role: PlayableRole | null;
    status: SimulationSession["status"];
    launch_jti: string | null;
    launched_at: string | null;
    started_at: string | null;
    completed_at: string | null;
    expires_at: string;
    metadata: Record<string, unknown> | null;
};

const toSimulation = (row: SimulationRow): Simulation => ({
    id: row.id,
    slug: row.slug,
    companionId: row.companion_id,
    kind: row.kind,
    title: row.title,
    description: row.description,
    subject: row.subject,
    caseId: row.case_id,
    difficulty: row.difficulty,
    published: row.published,
    configuration: (row.configuration ?? {}) as Simulation["configuration"],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
});

const toSession = (row: SessionRow, kind: SimulationKind): SimulationSession => ({
    id: row.id,
    simulationId: row.simulation_id,
    userId: row.user_id,
    companionId: row.companion_id,
    kind,
    role: row.role,
    status: row.status,
    launchedAt: row.launched_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    expiresAt: row.expires_at,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
});

/** Every action that touches a session needs this, and needs it to be fatal. */
const requireUser = async () => {
    const { userId } = await auth();
    if (!userId) throw new Error("Not signed in");
    return userId;
};

const SIMULATION_COLUMNS =
    "id, slug, kind, title, description, subject, case_id, companion_id, difficulty, published, configuration, created_at, updated_at";

/* ---------------------------------------------------------------------------
   The catalogue
   --------------------------------------------------------------------------- */

export const getSimulations = async ({ kind, companionId }: {
    kind?: SimulationKind;
    companionId?: string;
} = {}): Promise<Simulation[]> => {
    const supabase = createSupabaseAdminClient();

    let query = supabase
        .from("simulations")
        .select(SIMULATION_COLUMNS)
        .eq("published", true);

    if (kind) query = query.eq("kind", kind);
    if (companionId) query = query.eq("companion_id", companionId);

    const { data, error } = await query.order("created_at", { ascending: true });

    if (error) throw new Error(error.message);

    return (data ?? []).map((row) => toSimulation(row as SimulationRow));
};

export const getSimulationBySlug = async (slug: string): Promise<Simulation | null> => {
    const supabase = createSupabaseAdminClient();

    const { data, error } = await supabase
        .from("simulations")
        .select(SIMULATION_COLUMNS)
        .eq("slug", slug)
        .maybeSingle();

    if (error) throw new Error(error.message);

    return data ? toSimulation(data as SimulationRow) : null;
};

/**
 * The simulation a companion launches, if it has one.
 *
 * Two lookups, in order of specificity: a row wired to this exact companion,
 * then the subject default — a published row with no companion_id, which every
 * companion of that subject shares.
 *
 * The fallback is what keeps this from being a chore. Converso lets a user
 * create their own law companion; without it, a courtroom would only ever open
 * for the one seeded row somebody remembered to link.
 *
 * This is what the session page calls to decide whether to draw the "Start"
 * control at all. No simulation means null, and the page is exactly as it was —
 * which is how the courtroom stays invisible to the other eight subjects.
 */
export const getSimulationForCompanion = async (
    companionId: string,
    subject?: string | null,
): Promise<Simulation | null> => {
    const supabase = createSupabaseAdminClient();

    if (companionId) {
        const { data, error } = await supabase
            .from("simulations")
            .select(SIMULATION_COLUMNS)
            .eq("companion_id", companionId)
            .eq("published", true)
            .limit(1)
            .maybeSingle();

        if (error) throw new Error(error.message);
        if (data) return toSimulation(data as SimulationRow);
    }

    if (!subject) return null;

    const { data, error } = await supabase
        .from("simulations")
        .select(SIMULATION_COLUMNS)
        .eq("subject", subject)
        .is("companion_id", null)
        .eq("published", true)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();

    if (error) throw new Error(error.message);

    return data ? toSimulation(data as SimulationRow) : null;
};

/* ---------------------------------------------------------------------------
   Sessions
   --------------------------------------------------------------------------- */

/**
 * Open an attempt.
 *
 * Returns a *pending* session. Pending means "a doorway exists"; the heavy app
 * turns it active by spending its launch token, and until then nothing has
 * happened that would count as a lesson attempt.
 */
export const createSimulationSession = async ({ simulationId, role, companionId }: {
    simulationId: string;
    role?: PlayableRole | null;
    companionId?: string | null;
}): Promise<{ session: SimulationSession; simulation: Simulation }> => {
    const userId = await requireUser();
    const supabase = createSupabaseAdminClient();

    const { data: simulationRow, error: simulationError } = await supabase
        .from("simulations")
        .select(SIMULATION_COLUMNS)
        .eq("id", simulationId)
        .eq("published", true)
        .maybeSingle();

    if (simulationError) throw new Error(simulationError.message);
    if (!simulationRow) throw new Error("Simulation not found");

    const simulation = toSimulation(simulationRow as SimulationRow);

    // A role only means something in a courtroom, and the check constraint would
    // reject it anyway — better a null than a 23514 from the driver.
    const seat = simulation.kind === SIMULATION_KIND.COURTROOM ? (role ?? null) : null;

    const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString();

    const { data, error } = await supabase
        .from("simulation_sessions")
        .insert({
            simulation_id: simulation.id,
            user_id: userId,
            companion_id: companionId ?? simulation.companionId,
            role: seat,
            status: SESSION_STATUS.PENDING,
            expires_at: expiresAt,
        })
        .select()
        .single();

    if (error || !data) throw new Error(error?.message || "Failed to open a session");

    return { session: toSession(data as SessionRow, simulation.kind), simulation };
};

/**
 * Read a session the signed-in user owns.
 *
 * `.eq("user_id", userId)` rather than a check after the fact: a session
 * belonging to someone else should be indistinguishable from one that does not
 * exist, so probing ids tells an attacker nothing.
 */
export const getSimulationSession = async (
    sessionId: string,
): Promise<{ session: SimulationSession; simulation: Simulation } | null> => {
    const userId = await requireUser();
    const supabase = createSupabaseAdminClient();

    const { data, error } = await supabase
        .from("simulation_sessions")
        .select("*")
        .eq("id", sessionId)
        .eq("user_id", userId)
        .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) return null;

    const row = data as SessionRow;

    const { data: simulationRow, error: simulationError } = await supabase
        .from("simulations")
        .select(SIMULATION_COLUMNS)
        .eq("id", row.simulation_id)
        .maybeSingle();

    if (simulationError) throw new Error(simulationError.message);
    if (!simulationRow) return null;

    const simulation = toSimulation(simulationRow as SimulationRow);

    return { session: toSession(row, simulation.kind), simulation };
};

/**
 * Read a session on behalf of a verified launch token.
 *
 * The one function here that does not call auth(): it is reached from the token
 * exchange route, where identity came from the token's HMAC instead of a cookie
 * — the heavy app is a different origin and carries no Clerk session. `userId`
 * is therefore a parameter, but it is the *verified* claim, and it is still
 * matched against the row. A caller who invents one gets null.
 */
export const getSimulationSessionForUser = async (
    sessionId: string,
    userId: string,
): Promise<{ session: SimulationSession; simulation: Simulation } | null> => {
    if (!sessionId || !userId) return null;
    const supabase = createSupabaseAdminClient();

    const { data, error } = await supabase
        .from("simulation_sessions")
        .select("*")
        .eq("id", sessionId)
        .eq("user_id", userId)
        .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) return null;

    const row = data as SessionRow;

    const { data: simulationRow, error: simulationError } = await supabase
        .from("simulations")
        .select(SIMULATION_COLUMNS)
        .eq("id", row.simulation_id)
        .maybeSingle();

    if (simulationError) throw new Error(simulationError.message);
    if (!simulationRow) return null;

    const simulation = toSimulation(simulationRow as SimulationRow);

    return { session: toSession(row, simulation.kind), simulation };
};

/**
 * Spend the launch token: pending → active, exactly once.
 *
 * The `is("launch_jti", null)` in the update is the whole mechanism. Two tabs
 * opening the same link race, both read a pending row, and both try to claim
 * it; the filter means the database picks one and the loser's update matches
 * zero rows. Doing this as a conditional UPDATE rather than read-then-write is
 * what makes it safe without a transaction the JS client cannot open.
 *
 * Re-presenting the *same* jti is allowed — that is a page refresh, not a
 * replay, and a student whose canvas crashed should be able to reload.
 */
export const activateSimulationSession = async ({ sessionId, userId, jti }: {
    sessionId: string;
    userId: string;
    jti: string;
}): Promise<{ ok: true; session: SimulationSession } | { ok: false; reason: string }> => {
    const supabase = createSupabaseAdminClient();

    // Read the row directly rather than through getSimulationSessionForUser,
    // because this is the one place that needs launch_jti — which the mapped
    // SimulationSession deliberately does not carry into the app.
    const { data: existing, error: readError } = await supabase
        .from("simulation_sessions")
        .select("*")
        .eq("id", sessionId)
        .eq("user_id", userId)
        .maybeSingle();

    if (readError) throw new Error(readError.message);
    if (!existing) return { ok: false, reason: "NOT_FOUND" };

    const row = existing as SessionRow;

    const { data: simulationRow, error: simulationError } = await supabase
        .from("simulations")
        .select(SIMULATION_COLUMNS)
        .eq("id", row.simulation_id)
        .maybeSingle();

    if (simulationError) throw new Error(simulationError.message);
    if (!simulationRow) return { ok: false, reason: "NOT_FOUND" };

    const kind = (simulationRow as SimulationRow).kind;

    if (row.status === SESSION_STATUS.COMPLETED) {
        return { ok: false, reason: "ALREADY_COMPLETED" };
    }
    if (new Date(row.expires_at).getTime() < Date.now()) {
        await supabase
            .from("simulation_sessions")
            .update({ status: SESSION_STATUS.EXPIRED })
            .eq("id", sessionId);
        return { ok: false, reason: "EXPIRED" };
    }

    // A refresh: same token, session already open. Reloading a crashed canvas
    // should work. A *different* token against an open session is a replay.
    if (row.status === SESSION_STATUS.ACTIVE) {
        if (row.launch_jti && row.launch_jti !== jti) {
            return { ok: false, reason: "BAD_TOKEN" };
        }
        return { ok: true, session: toSession(row, kind) };
    }

    if (!canTransition(row.status, SESSION_STATUS.ACTIVE)) {
        return { ok: false, reason: "BAD_TOKEN" };
    }

    const now = new Date().toISOString();

    const { data, error } = await supabase
        .from("simulation_sessions")
        .update({
            status: SESSION_STATUS.ACTIVE,
            launch_jti: jti,
            launched_at: now,
            started_at: now,
        })
        .eq("id", sessionId)
        .eq("user_id", userId)
        .is("launch_jti", null)
        .select()
        .maybeSingle();

    if (error) throw new Error(error.message);
    // Lost the race, or the token was already spent by a different one.
    if (!data) return { ok: false, reason: "BAD_TOKEN" };

    return { ok: true, session: toSession(data as SessionRow, kind) };
};

/**
 * Record the result and close the session.
 *
 * The browser's `score` never survives this function: normalize*Result() drops
 * it and recomputes from the counts, which are themselves clamped to what the
 * engine could have produced.
 *
 * Two posts of the same result must not count twice, and the `ALREADY_COMPLETED`
 * check below is not enough on its own — it reads the status three round-trips
 * before the write, so two concurrent posts can both pass it. `upsert` on
 * session_id makes the result row idempotent, and the status write is a
 * compare-and-set whose outcome decides whether this call is the one that gets
 * to advance the student's progress. Without that, a double-post appends two
 * rows to somebody's history for one hearing.
 */
export const completeSimulationSession = async ({ sessionId, userId, result }: {
    sessionId: string;
    userId: string;
    result: unknown;
}): Promise<
    | { ok: true; result: CourtroomResult | ClassroomResult }
    | { ok: false; reason: string }
> => {
    const supabase = createSupabaseAdminClient();

    const current = await getSimulationSessionForUser(sessionId, userId);
    if (!current) return { ok: false, reason: "NOT_FOUND" };

    const { session, simulation } = current;

    if (session.status === SESSION_STATUS.COMPLETED) {
        return { ok: false, reason: "ALREADY_COMPLETED" };
    }

    const normalized = simulation.kind === SIMULATION_KIND.CLASSROOM
        ? normalizeClassroomResult(result)
        : normalizeCourtroomResult(result);

    // The courtroom result carries a transcript; the classroom one does not.
    const transcript = "transcript" in normalized ? normalized.transcript : null;

    // The `performance` column holds the rest of the normalized record: the
    // per-axis marks and the counts they were derived from. Score and transcript
    // are lifted out because they have their own columns, and a number stored
    // twice is a number that can disagree with itself.
    const {
        score,
        transcript: _transcript,
        kind: _kind,
        ...detail
    } = normalized as Record<string, unknown> & { score: number };

    const { error: resultError } = await supabase
        .from("simulation_results")
        .upsert({
            session_id: sessionId,
            user_id: userId,
            simulation_id: simulation.id,
            kind: simulation.kind,
            score,
            completed: normalized.completed,
            duration_ms: Math.max(0, Math.round((normalized.duration ?? 0) * 1000)),
            performance: detail,
            transcript,
        }, { onConflict: "session_id" });

    if (resultError) throw new Error(resultError.message);

    // Compare-and-set. `neq COMPLETED` rather than a list of the statuses that
    // may proceed, because a late result for a session the abandon beacon
    // already closed is still that student's result and should still be stored —
    // the only status that must not be overwritten is a completion that has
    // already happened. `select` makes the outcome readable: no row back means
    // another request got here first.
    const { data: closed, error: sessionError } = await supabase
        .from("simulation_sessions")
        .update({
            status: SESSION_STATUS.COMPLETED,
            completed_at: new Date().toISOString(),
        })
        .eq("id", sessionId)
        .eq("user_id", userId)
        .neq("status", SESSION_STATUS.COMPLETED)
        .select("id")
        .maybeSingle();

    if (sessionError) throw new Error(sessionError.message);

    // Lost the race. The result row is already correct — the upsert above is
    // keyed on session_id — so there is nothing to undo and nothing to add.
    if (!closed) return { ok: false, reason: "ALREADY_COMPLETED" };

    await recordCompanionProgress(session.companionId, userId);

    return { ok: true, result: normalized };
};

/**
 * Advancing the student's progress — in the only currency Converso actually has.
 *
 * The integration plan asks for lesson and course progress to move when a
 * simulation finishes. Converso has neither table: there are companions, and
 * `session_history` is the append-only log of "this person worked with this
 * companion", which is what the dashboard's Recent sessions and the profile's
 * journey are both read from. So a finished hearing earns exactly what a
 * finished voice session earns — one row, same two columns, same table. Nothing
 * here is a new schema, and nothing here is a second progress system.
 *
 * Four deliberate choices:
 *
 * The companion comes from the *session*, never from the simulation. It is
 * tempting to fall back to `simulation.companionId` when the session has none,
 * and it is wrong: `createSimulationSession` already resolves
 * `companionId ?? simulation.companionId` and freezes the answer onto the row,
 * so a null here means both were null when the student pressed Start. The
 * fallback could then only produce a value if the catalogue row was pointed at a
 * companion *after* the session opened — crediting a companion the student never
 * launched from, and contradicting the session's own record of what happened.
 * The seeded catalogue ships with `companion_id` null (see 0002), so this is the
 * live path rather than a hypothetical.
 *
 * A simulation with no companion writes nothing. The catalogue allows a
 * standalone hearing that belongs to no companion, and inventing a row for it
 * would put a null in a column the LMS joins on.
 *
 * The user id is handed in rather than read from `auth()`, unlike
 * `addToSessionHistory` in companion.actions.ts. That function is called from a
 * lesson page and has a Clerk cookie; this one is reached from an iframe on
 * another origin whose only credential is a launch token that has already been
 * verified. Reading `auth()` here would return null and silently drop every
 * hearing's progress.
 *
 * It never throws. The result is already stored and the session already closed
 * by the time this runs; turning a graded hearing into a 500 because a history
 * row failed would lose the student their mark to save a dashboard entry. The
 * cost of that choice is that the failure is only in the server log, so the
 * message names the row it could not write — the likeliest cause is a
 * `companion_id` that no longer exists in `companions`, which neither
 * `simulations.companion_id` nor `simulation_sessions.companion_id` has a
 * foreign key to catch earlier.
 */
const recordCompanionProgress = async (
    companionId: string | null | undefined,
    userId: string,
): Promise<void> => {
    if (!companionId) return;

    try {
        const supabase = createSupabaseAdminClient();
        const { error } = await supabase
            .from("session_history")
            .insert({ companion_id: companionId, user_id: userId });

        if (error) throw new Error(error.message);
    } catch (err) {
        console.error(
            `[simulations] could not record progress for companion ${companionId}:`,
            err instanceof Error ? err.message : err,
        );
    }
};

/**
 * A student who walks away.
 *
 * Takes the user id rather than reading it, for the same reason
 * `getSimulationSessionForUser` does: the caller is the abandon route, and when
 * that route was reached from the courtroom there is no Clerk cookie to read —
 * only a launch token whose claim has already been verified. The id handed in
 * here is that verified claim, never a value off a request body.
 *
 * Narrowed to pending and active on purpose. A completed session must not be
 * reopened as abandoned by a late beacon arriving after the results were saved.
 */
export const abandonSimulationSessionForUser = async (
    sessionId: string,
    userId: string,
): Promise<void> => {
    const supabase = createSupabaseAdminClient();

    const { error } = await supabase
        .from("simulation_sessions")
        .update({ status: SESSION_STATUS.ABANDONED })
        .eq("id", sessionId)
        .eq("user_id", userId)
        .in("status", [SESSION_STATUS.PENDING, SESSION_STATUS.ACTIVE]);

    if (error) throw new Error(error.message);
};

/** The same thing for a caller that does have a Clerk cookie: the lesson page. */
export const abandonSimulationSession = async (sessionId: string): Promise<void> => {
    const userId = await requireUser();
    await abandonSimulationSessionForUser(sessionId, userId);
};

/**
 * Where a student left off, so a half-finished trial can be resumed.
 *
 * Small on purpose: the cursor and the camera, nothing that decides what the
 * student is allowed to do. Authority lives in the engine; this is a bookmark.
 */
export const saveSessionProgress = async ({ sessionId, userId, progress }: {
    sessionId: string;
    userId: string;
    progress: Record<string, unknown>;
}): Promise<void> => {
    const supabase = createSupabaseAdminClient();

    const current = await getSimulationSessionForUser(sessionId, userId);
    if (!current) return;

    const { error } = await supabase
        .from("simulation_sessions")
        .update({ metadata: { ...current.session.metadata, progress } })
        .eq("id", sessionId)
        .eq("user_id", userId)
        .eq("status", SESSION_STATUS.ACTIVE);

    if (error) throw new Error(error.message);
};

/* ---------------------------------------------------------------------------
   History
   --------------------------------------------------------------------------- */

export type SimulationHistoryEntry = {
    id: string;
    sessionId: string;
    kind: SimulationKind;
    score: number;
    completed: boolean;
    durationMs: number;
    createdAt: string;
    title: string;
    slug: string;
    subject: string | null;
    performance: Record<string, unknown>;
};

/**
 * The student's own results, newest first.
 *
 * Sweeps stale sessions before reading — this is the natural place for it, and
 * it means the app needs no cron. The function is a no-op when nothing is stale,
 * and it is not fatal if the RPC is missing, because a missing sweep should not
 * blank out a history page.
 */
export const getSimulationHistory = async ({ limit = 10 }: { limit?: number } = {}):
    Promise<SimulationHistoryEntry[]> => {
    const userId = await requireUser();
    const supabase = createSupabaseAdminClient();

    const { error: sweepError } = await supabase.rpc("expire_stale_simulation_sessions");
    if (sweepError) console.warn("[simulations] expiry sweep skipped:", sweepError.message);

    const { data, error } = await supabase
        .from("simulation_results")
        .select("id, session_id, kind, score, completed, duration_ms, performance, created_at, simulations(title, slug, subject)")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(limit);

    if (error) throw new Error(error.message);

    return (data ?? []).map((row: Record<string, unknown>) => {
        // Supabase returns an embedded row as an object, or an array when it
        // cannot prove the relationship is to-one. Handle both.
        const embedded = row.simulations as
            | { title: string; slug: string; subject: string | null }
            | { title: string; slug: string; subject: string | null }[]
            | null;
        const simulation = Array.isArray(embedded) ? embedded[0] : embedded;

        return {
            id: row.id as string,
            sessionId: row.session_id as string,
            kind: row.kind as SimulationKind,
            score: (row.score as number) ?? 0,
            completed: row.completed === true,
            durationMs: (row.duration_ms as number) ?? 0,
            createdAt: row.created_at as string,
            title: simulation?.title ?? "Simulation",
            slug: simulation?.slug ?? "",
            subject: simulation?.subject ?? null,
            performance: (row.performance as Record<string, unknown>) ?? {},
        };
    });
};

/* ---------------------------------------------------------------------------
   The classroom's own detail
   --------------------------------------------------------------------------- */

export const recordClassroomSession = async ({ sessionId, userId, language, register }: {
    sessionId: string;
    userId: string;
    language: string;
    register?: "formal" | "casual";
}): Promise<void> => {
    const supabase = createSupabaseAdminClient();

    const { error } = await supabase
        .from("classroom_sessions")
        .upsert({
            session_id: sessionId,
            user_id: userId,
            language,
            register: register ?? "formal",
        }, { onConflict: "session_id" });

    if (error) throw new Error(error.message);
};

/**
 * Count one exchange.
 *
 * Read-then-write rather than an atomic increment, because the JS client has no
 * `+= 1`. Safe enough: one browser, one room, one answer at a time — and the
 * number is a statistic, not an entitlement. The score that matters is computed
 * from the reported counts at completion.
 */
export const noteClassroomExchange = async ({ sessionId, userId, model }: {
    sessionId: string;
    userId: string;
    model?: string | null;
}): Promise<void> => {
    const supabase = createSupabaseAdminClient();

    const { data, error } = await supabase
        .from("classroom_sessions")
        .select("exchanges")
        .eq("session_id", sessionId)
        .eq("user_id", userId)
        .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) return;

    const { error: updateError } = await supabase
        .from("classroom_sessions")
        .update({
            exchanges: ((data.exchanges as number) ?? 0) + 1,
            ...(model ? { model } : {}),
        })
        .eq("session_id", sessionId)
        .eq("user_id", userId);

    if (updateError) throw new Error(updateError.message);
};
