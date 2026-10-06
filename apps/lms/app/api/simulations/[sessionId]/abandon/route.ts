import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { abandonSimulationSession, abandonSimulationSessionForUser } from "@/lib/actions/simulation.actions";
import { corsHeaders, readLaunchToken } from "@/lib/launch";

/**
 * The student left mid-hearing.
 *
 * Reached by `navigator.sendBeacon` from two different places, which is why it
 * accepts two different credentials:
 *
 *   from the lesson page   the host page's `pagehide` fires a beacon. Same
 *                          origin, so the Clerk cookie rides along.
 *   from the courtroom     the scene's own `pagehide` fires one. Another origin,
 *                          so the cookie does not travel and the launch token
 *                          goes in the query string instead — a beacon cannot
 *                          set a header, and this is the one call where that
 *                          matters.
 *
 * The shape of a beacon decides the rest of this file. There is no chance to read
 * a response, and no guarantee it arrives at all:
 *
 *   - it answers 204 and never anything a caller would want to read;
 *   - a failure is logged and swallowed. A session left 'active' is swept to
 *     'expired' three hours later by `expire_stale_simulation_sessions()`, so
 *     nothing is lost by not insisting here, and a 500 on unload helps no one.
 */

export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ sessionId: string }> },
) {
    const { sessionId } = await params;

    try {
        const token = readLaunchToken(req, req.nextUrl.searchParams.get("token"));

        if (token.ok) {
            // A token for one session must not close another, exactly as on every
            // other token-authed route.
            if (token.claims.sessionId === sessionId) {
                await abandonSimulationSessionForUser(sessionId, token.claims.userId);
            }
        } else {
            const { userId } = await auth();
            if (userId) await abandonSimulationSession(sessionId);
        }
    } catch (err) {
        console.warn("[simulations/:id/abandon]", err);
    }

    return new NextResponse(null, { status: 204, headers: corsHeaders(req) });
}

export async function OPTIONS(req: NextRequest) {
    return new NextResponse(null, { status: 204, headers: corsHeaders(req) });
}
