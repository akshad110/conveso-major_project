import "server-only";

/**
 * Minting and checking the doorway into a heavy app.
 *
 * `server-only` at the top is not decoration. This module reads
 * LAUNCH_TOKEN_SECRET, and the import will make the build fail loudly if a
 * client component ever pulls it in — which is a much better outcome than a
 * signing secret quietly ending up in a JavaScript bundle.
 *
 * The courtroom and the classroom are separate origins with no Clerk session of
 * their own. They do not get a login screen and they do not get a database key.
 * What they get is a token that says "this user, this session, for the next two
 * minutes", which they hand straight back to Converso to exchange for the one
 * session it describes. The token is never inspected in the browser; it is an
 * opaque string that travels from a query parameter to a fetch header.
 */

import { sign, verify } from "@converso/launch-token";
import {
    LAUNCH_ERRORS,
    LAUNCH_TOKEN_TTL_SECONDS,
    SIMULATION_KIND,
} from "@converso/contracts";
import type { PlayableRole, SimulationKind } from "@converso/contracts";

/**
 * Where each heavy app lives.
 *
 * These two variables already existed — components/workspace/SpatialStage.tsx
 * reads them to decide whether a scene is connected — so the integration reuses
 * them rather than introducing a second name for the same URL.
 *
 * They are NEXT_PUBLIC because the iframe src is, by nature, public. The secret
 * below is not, and the two must never be confused.
 */
export const SCENE_URLS: Record<SimulationKind, string | undefined> = {
    courtroom: process.env.NEXT_PUBLIC_COURTROOM_URL,
    classroom: process.env.NEXT_PUBLIC_LANGUAGE_SCENE_URL,
};

/**
 * The engine also serves a small demo page on its own host. A launch URL pointed
 * at that host opens the demo instead of the 3D courtroom. Send those launches
 * to the courtroom app; the engine stays on the websocket only.
 */
const COURTROOM_APP_URL = "https://conveso-major-project-2.onrender.com";

export const sceneUrl = (kind: SimulationKind): string | undefined => {
    const configured = SCENE_URLS[kind];
    if (!configured || kind !== SIMULATION_KIND.COURTROOM) return configured;
    try {
        if (new URL(configured).hostname === "courtroom-engine.onrender.com") {
            return COURTROOM_APP_URL;
        }
    } catch {
        return configured;
    }
    return configured;
};

const secret = () => process.env.LAUNCH_TOKEN_SECRET;

/**
 * Whether launching is possible at all.
 *
 * Checked before a Start control is drawn, so a missing secret shows up as a
 * disabled button with a reason rather than as a 500 after the student clicks.
 */
export const launchReadiness = (kind: SimulationKind) => {
    const url = sceneUrl(kind);
    const key = secret();
    if (!url) return { ok: false as const, reason: `${kind === SIMULATION_KIND.COURTROOM ? "NEXT_PUBLIC_COURTROOM_URL" : "NEXT_PUBLIC_LANGUAGE_SCENE_URL"} is not set` };
    if (!key) return { ok: false as const, reason: "LAUNCH_TOKEN_SECRET is not set" };
    if (key.length < 16) return { ok: false as const, reason: "LAUNCH_TOKEN_SECRET is too short (16+ characters)" };
    return { ok: true as const, url };
};

/**
 * The URL to point an iframe at.
 *
 * Built here rather than in the component because only the server may hold the
 * secret. The token rides as a query parameter — the heavy app reads it once on
 * boot, exchanges it, and is expected to strip it from its own address bar so a
 * copied URL is a dead link within two minutes either way.
 */
export const mintLaunchUrl = ({ sessionId, userId, kind, role }: {
    sessionId: string;
    userId: string;
    kind: SimulationKind;
    role?: PlayableRole | null;
}): string => {
    const ready = launchReadiness(kind);
    if (!ready.ok) throw new Error(`Cannot launch: ${ready.reason}`);

    const token = sign(
        { sessionId, userId, kind, role: role ?? null },
        secret() as string,
        LAUNCH_TOKEN_TTL_SECONDS,
    );

    // Preserve whatever the operator already put in the variable — a path, a
    // port, an existing query string — instead of assuming a bare origin.
    const url = new URL(ready.url);
    url.searchParams.set("session", sessionId);
    url.searchParams.set("token", token);

    return url.toString();
};

export type VerifiedLaunch = {
    sessionId: string;
    userId: string;
    kind: SimulationKind;
    role: PlayableRole | null;
    jti: string;
};

/**
 * Which origins may call the session endpoints.
 *
 * Derived from the two scene URLs rather than configured separately, so there
 * is one place to change when a port moves and no chance of the allow-list
 * drifting away from what is actually embedded.
 *
 * Deliberately not `*`: these endpoints answer with a student's session, and a
 * wildcard would let any page on the internet try its luck with a token it
 * happened to capture. Echoing back only a known origin also keeps
 * `credentials: include` usable if it is ever needed.
 */
const allowedOrigins = (): string[] => {
    const origins: string[] = [];
    for (const kind of Object.keys(SCENE_URLS) as SimulationKind[]) {
        const url = sceneUrl(kind);
        if (!url) continue;
        try {
            origins.push(new URL(url).origin);
        } catch {
            console.warn("[launch] ignoring unparseable scene URL:", url);
        }
    }
    return origins;
};

export const corsHeaders = (request: Request): Record<string, string> => {
    const origin = request.headers.get("origin");
    const headers: Record<string, string> = {
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "content-type, authorization, x-launch-token",
        "Access-Control-Max-Age": "600",
        Vary: "Origin",
    };
    if (origin && allowedOrigins().includes(origin)) {
        headers["Access-Control-Allow-Origin"] = origin;
    }
    return headers;
};

/**
 * Read a token a heavy app sent back.
 *
 * Accepts it from the Authorization header or an `x-launch-token` header, and
 * from the body only as a last resort — headers do not end up in access logs
 * and referrers the way query strings do.
 *
 * Returns a coarse error code and nothing else on failure. The caller turns it
 * into one of LAUNCH_ERROR_TEXT's sentences; the reason a signature failed is
 * for the server log, not for the student.
 */
export const readLaunchToken = (
    request: Request,
    fallback?: string | null,
): { ok: true; claims: VerifiedLaunch } | { ok: false; error: string } => {
    const header = request.headers.get("authorization");
    const bearer = header?.toLowerCase().startsWith("bearer ")
        ? header.slice(7).trim()
        : null;

    const token = bearer || request.headers.get("x-launch-token") || fallback || "";

    if (!token) return { ok: false, error: LAUNCH_ERRORS.NO_TOKEN };

    const key = secret();
    if (!key) {
        console.error("[launch] LAUNCH_TOKEN_SECRET is not set; refusing every token");
        return { ok: false, error: LAUNCH_ERRORS.UNAVAILABLE };
    }

    const result = verify(token, key);
    if (!result.ok) {
        // NO_SECRET and BAD_TOKEN both mean "not a token we minted". EXPIRED is
        // worth telling apart, because the student's fix is different: start again.
        const error = result.error === "EXPIRED"
            ? LAUNCH_ERRORS.EXPIRED
            : LAUNCH_ERRORS.BAD_TOKEN;
        return { ok: false, error };
    }

    const claims = result.claims as {
        sessionId: string;
        userId: string;
        kind: string;
        role: string | null;
        id: string;
    };

    return {
        ok: true,
        claims: {
            sessionId: claims.sessionId,
            userId: claims.userId,
            kind: claims.kind as SimulationKind,
            role: (claims.role as PlayableRole | null) ?? null,
            jti: claims.id,
        },
    };
};
