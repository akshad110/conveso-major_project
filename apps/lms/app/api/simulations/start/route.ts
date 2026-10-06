import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { SIMULATION_KIND, problemsWithSessionRequest } from "@converso/contracts";
import type { PlayableRole } from "@converso/contracts";
import {
    createSimulationSession,
    getSimulationForCompanion,
} from "@/lib/actions/simulation.actions";
import { launchReadiness, mintLaunchUrl } from "@/lib/launch";

/**
 * Start a simulation.
 *
 * The only endpoint in the flow that trusts a Clerk cookie, because it is the
 * only one called from a Converso page. Everything downstream is called by the
 * heavy app from another origin and carries a launch token instead.
 *
 * Accepts either a `simulationId` or a `companionId` — a lesson page knows which
 * companion it is, not which simulation hangs off it, and making the page look
 * that up first would be a round trip for nothing.
 */
export async function POST(req: NextRequest) {
    const { userId } = await auth();
    if (!userId) {
        return NextResponse.json({ error: "Sign in to start a simulation." }, { status: 401 });
    }

    let body: { simulationId?: string; companionId?: string; subject?: string; role?: string };
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: "Malformed request body." }, { status: 400 });
    }

    let simulationId = typeof body.simulationId === "string" ? body.simulationId : "";
    const companionId = typeof body.companionId === "string" ? body.companionId : "";
    const subject = typeof body.subject === "string" ? body.subject : "";

    if (!simulationId && (companionId || subject)) {
        try {
            const simulation = await getSimulationForCompanion(companionId, subject);
            if (!simulation) {
                return NextResponse.json(
                    { error: "This lesson has no simulation attached." },
                    { status: 404 },
                );
            }
            simulationId = simulation.id;
        } catch (err) {
            console.error("[simulations/start] lookup failed:", err);
            return NextResponse.json({ error: "Could not start the simulation." }, { status: 500 });
        }
    }

    const problems = problemsWithSessionRequest({ simulationId, role: body.role });
    if (problems.length) {
        return NextResponse.json({ error: problems[0], problems }, { status: 400 });
    }

    try {
        const { session, simulation } = await createSimulationSession({
            simulationId,
            role: (body.role as PlayableRole) ?? null,
            companionId: companionId || null,
        });

        // Checked after the row exists so the reason can name the variable. A
        // pending session with no URL is harmless — it expires on its own.
        const ready = launchReadiness(simulation.kind);
        if (!ready.ok) {
            console.error("[simulations/start] not launchable:", ready.reason);
            return NextResponse.json(
                { error: "The simulation service is not configured yet.", detail: ready.reason },
                { status: 503 },
            );
        }

        const url = mintLaunchUrl({
            sessionId: session.id,
            userId,
            kind: simulation.kind,
            role: session.role,
        });

        return NextResponse.json({
            sessionId: session.id,
            kind: simulation.kind,
            role: session.role,
            expiresAt: session.expiresAt,
            title: simulation.title,
            // The token is inside this URL. It goes into an iframe src and is
            // never read by our own client code.
            url,
            // Enough for a host page to show what is about to load without a
            // second request. Names and numbers only — no asset bytes.
            configuration: simulation.configuration,
            caseId: simulation.kind === SIMULATION_KIND.COURTROOM ? simulation.caseId : null,
        });
    } catch (err) {
        console.error("[simulations/start]", err);
        return NextResponse.json({ error: "Could not start the simulation." }, { status: 500 });
    }
}
