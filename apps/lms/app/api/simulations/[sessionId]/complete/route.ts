import { NextRequest, NextResponse } from "next/server";
import { LAUNCH_ERROR_TEXT, problemsWithResult } from "@converso/contracts";
import type { SimulationKind } from "@converso/contracts";
import { completeSimulationSession } from "@/lib/actions/simulation.actions";
import { corsHeaders, readLaunchToken } from "@/lib/launch";

/**
 * The heavy app reports what happened.
 *
 * Everything in the body is a claim, including the score — especially the
 * score. completeSimulationSession() throws the browser's number away and
 * recomputes it from counts that have themselves been clamped to what the
 * engine could physically have produced. A student with the developer console
 * open can send `score: 100`; they will get back whatever their objections and
 * rulings were actually worth.
 *
 * The response repeats the stored result so the app can show the real mark
 * rather than the one it hoped for.
 */

const fail = (req: NextRequest, code: keyof typeof LAUNCH_ERROR_TEXT, status: number) =>
    NextResponse.json(
        { error: code, message: LAUNCH_ERROR_TEXT[code] },
        { status, headers: corsHeaders(req) },
    );

export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ sessionId: string }> },
) {
    const { sessionId } = await params;

    const token = readLaunchToken(req, req.nextUrl.searchParams.get("token"));
    if (!token.ok) return fail(req, token.error as keyof typeof LAUNCH_ERROR_TEXT, 401);
    if (token.claims.sessionId !== sessionId) return fail(req, "BAD_TOKEN", 403);

    let body: Record<string, unknown>;
    try {
        body = await req.json();
    } catch {
        return NextResponse.json(
            { error: "BAD_BODY", message: "Malformed request body." },
            { status: 400, headers: corsHeaders(req) },
        );
    }

    const problems = problemsWithResult(body, token.claims.kind as SimulationKind);
    if (problems.length) {
        return NextResponse.json(
            { error: "BAD_BODY", message: problems[0], problems },
            { status: 400, headers: corsHeaders(req) },
        );
    }

    try {
        const outcome = await completeSimulationSession({
            sessionId,
            userId: token.claims.userId,
            result: body,
        });

        if (!outcome.ok) {
            const code = outcome.reason as keyof typeof LAUNCH_ERROR_TEXT;
            const status = code === "NOT_FOUND" ? 404 : code === "ALREADY_COMPLETED" ? 409 : 400;
            return fail(req, code in LAUNCH_ERROR_TEXT ? code : "BAD_TOKEN", status);
        }

        return NextResponse.json(
            { ok: true, result: outcome.result },
            { headers: corsHeaders(req) },
        );
    } catch (err) {
        console.error("[simulations/:id/complete]", err);
        return fail(req, "UNAVAILABLE", 500);
    }
}

export async function OPTIONS(req: NextRequest) {
    return new NextResponse(null, { status: 204, headers: corsHeaders(req) });
}
