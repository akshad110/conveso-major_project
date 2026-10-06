import { NextRequest, NextResponse } from "next/server";
import { LAUNCH_ERROR_TEXT } from "@converso/contracts";
import { saveSessionProgress } from "@/lib/actions/simulation.actions";
import { corsHeaders, readLaunchToken } from "@/lib/launch";

/**
 * A bookmark, saved as the student goes.
 *
 * Deliberately tiny and deliberately not authoritative: it records where they
 * had got to so a reload can resume, and nothing about what they are allowed to
 * do next. The engine decides that, from its own state, every time.
 *
 * Called on a timer and on page-hide, so it answers 204 and stays quiet — a
 * failed bookmark must never interrupt a hearing.
 */

export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ sessionId: string }> },
) {
    const { sessionId } = await params;

    const token = readLaunchToken(req, req.nextUrl.searchParams.get("token"));
    if (!token.ok) {
        return NextResponse.json(
            { error: token.error, message: LAUNCH_ERROR_TEXT[token.error as keyof typeof LAUNCH_ERROR_TEXT] },
            { status: 401, headers: corsHeaders(req) },
        );
    }
    if (token.claims.sessionId !== sessionId) {
        return new NextResponse(null, { status: 403, headers: corsHeaders(req) });
    }

    let body: Record<string, unknown>;
    try {
        body = await req.json();
    } catch {
        return new NextResponse(null, { status: 400, headers: corsHeaders(req) });
    }

    // Whitelisted, not merged wholesale: metadata is a jsonb column and an
    // unbounded object from a browser is an unbounded row.
    const progress = {
        turn: typeof body.turn === "number" ? Math.max(0, Math.round(body.turn)) : 0,
        phase: typeof body.phase === "string" ? body.phase.slice(0, 64) : null,
        camera: typeof body.camera === "string" ? body.camera.slice(0, 64) : null,
        at: new Date().toISOString(),
    };

    try {
        await saveSessionProgress({ sessionId, userId: token.claims.userId, progress });
        return new NextResponse(null, { status: 204, headers: corsHeaders(req) });
    } catch (err) {
        console.error("[simulations/:id/progress]", err);
        return new NextResponse(null, { status: 500, headers: corsHeaders(req) });
    }
}

export async function OPTIONS(req: NextRequest) {
    return new NextResponse(null, { status: 204, headers: corsHeaders(req) });
}
