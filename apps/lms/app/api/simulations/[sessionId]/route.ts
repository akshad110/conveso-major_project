import { NextRequest, NextResponse } from "next/server";
import { LAUNCH_ERROR_TEXT, SIMULATION_KIND } from "@converso/contracts";
import {
    activateSimulationSession,
    getSimulationSessionForUser,
} from "@/lib/actions/simulation.actions";
import { corsHeaders, readLaunchToken } from "@/lib/launch";

/**
 * The exchange: a launch token in, a session out.
 *
 * This is the heavy app's first call and its only source of truth. It arrives
 * from another origin with no cookie, so the token is the identity — and the
 * token is checked here, never in the browser.
 *
 * What goes back is a description of the work: which case, which seat, which
 * characters and clips to download. What does not go back is any credential,
 * any provider key, or anything about another student.
 */

const fail = (req: NextRequest, code: keyof typeof LAUNCH_ERROR_TEXT, status: number) =>
    NextResponse.json(
        { error: code, message: LAUNCH_ERROR_TEXT[code] },
        { status, headers: corsHeaders(req) },
    );

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ sessionId: string }> },
) {
    const { sessionId } = await params;

    // The token may also ride in the query string, because an iframe's first
    // navigation cannot set a header. Headers are preferred and tried first.
    const token = readLaunchToken(req, req.nextUrl.searchParams.get("token"));
    if (!token.ok) {
        return fail(req, token.error as keyof typeof LAUNCH_ERROR_TEXT, 401);
    }

    // The token names a session; the URL names a session. If they disagree,
    // somebody is pointing a valid token at somebody else's row.
    if (token.claims.sessionId !== sessionId) {
        return fail(req, "BAD_TOKEN", 403);
    }

    try {
        const activated = await activateSimulationSession({
            sessionId,
            userId: token.claims.userId,
            jti: token.claims.jti,
        });

        if (!activated.ok) {
            const code = activated.reason as keyof typeof LAUNCH_ERROR_TEXT;
            const status = code === "NOT_FOUND" ? 404 : code === "ALREADY_COMPLETED" ? 409 : 401;
            return fail(req, code in LAUNCH_ERROR_TEXT ? code : "BAD_TOKEN", status);
        }

        const current = await getSimulationSessionForUser(sessionId, token.claims.userId);
        if (!current) return fail(req, "NOT_FOUND", 404);

        const { session, simulation } = current;

        return NextResponse.json(
            {
                session: {
                    id: session.id,
                    kind: session.kind,
                    // The seat is stamped from the session row, never taken from
                    // the client. The courtroom reads this and does not ask.
                    role: session.role,
                    status: session.status,
                    startedAt: session.startedAt,
                    expiresAt: session.expiresAt,
                    // Where to pick up, if there is anywhere to pick up from.
                    progress: session.metadata?.progress ?? null,
                },
                simulation: {
                    id: simulation.id,
                    slug: simulation.slug,
                    kind: simulation.kind,
                    title: simulation.title,
                    description: simulation.description,
                    difficulty: simulation.difficulty,
                    caseId: simulation.kind === SIMULATION_KIND.COURTROOM
                        ? simulation.caseId
                        : null,
                    // The load list. Names of characters and clips, not the
                    // characters themselves — no GLB has ever been in this table.
                    configuration: simulation.configuration,
                },
            },
            { headers: corsHeaders(req) },
        );
    } catch (err) {
        // The Supabase message, the stack, the column that was missing: all of
        // that is for this log line. The browser gets one sentence.
        console.error("[simulations/:id]", err);
        return fail(req, "UNAVAILABLE", 500);
    }
}

export async function OPTIONS(req: NextRequest) {
    return new NextResponse(null, { status: 204, headers: corsHeaders(req) });
}
