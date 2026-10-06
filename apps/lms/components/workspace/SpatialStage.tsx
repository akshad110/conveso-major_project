"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, RotateCcw } from "lucide-react";
import { FRAME_MESSAGES, PLAYABLE_ROLES, SIMULATION_FRAME_SOURCES } from "@converso/contracts";
import { getSubjectGlow } from "@/lib/utils";

/**
 * The mount point for a 3D scene that lives in another app.
 *
 * Two companions are meant to open onto a rendered world rather than onto a
 * document: the language tutor gets a speaking model, and the law tutor gets the
 * courtroom. Neither scene belongs in this repository — they are their own
 * builds with their own asset pipelines — so this component is the seam, not the
 * scene.
 *
 * The seam has three states, and the middle one is the point of this file.
 *
 *   not configured   the env var is unset. Says so, names the variable.
 *   ready            configured, but nothing has started. Draws a Start control.
 *   live             an iframe holding a session the server opened.
 *
 * The "ready" state exists because a scene is expensive. An iframe that boots on
 * page load downloads a courtroom's worth of GLB whether or not the student
 * wanted one, on a page whose actual job is the conversation beside it. Waiting
 * for a click costs nothing and means the other eight subjects never pay for the
 * two that have scenes.
 *
 * It also gives the launch token somewhere honest to come from. The URL in the
 * iframe is minted by POST /api/simulations/start, so it carries a signed,
 * two-minute claim about who this student is — which is how an app on another
 * origin knows anything at all without a second login or a database key. None of
 * that is visible here; this component receives an opaque string and sets an
 * attribute with it.
 */

type Phase = "ready" | "starting" | "live" | "failed";

interface Props {
  subject: string;
  title: string;
  /** What the scene will show once it is wired up. One honest sentence. */
  description: string;
  /** The env var an integrator needs to set. Shown verbatim in the empty state. */
  envVar: string;
  src?: string;
  /** Overlaid on the scene — the topic, so the room knows what the lesson is. */
  caption?: string;
  /** Which companion is asking. Used to find the simulation attached to it. */
  companionId?: string;
  /** Lets a student pick a seat before the hearing opens. Courtroom only. */
  seats?: boolean;
  /**
   * Launch as soon as the companion page opens.
   * A law or language companion's click is the start — the room should be
   * the thing that appears, not a second button in front of it.
   */
  autoStart?: boolean;
}

const STEPS = [
  { id: "session", label: "Opening a session" },
  { id: "token", label: "Signing the launch" },
  { id: "scene", label: "Loading the scene" },
];

export default function SpatialStage({
  subject,
  title,
  description,
  envVar,
  src,
  caption,
  companionId,
  seats = false,
  autoStart = false,
}: Props) {
  const glow = getSubjectGlow(subject);

  const [phase, setPhase] = useState<Phase>("ready");
  const [launchUrl, setLaunchUrl] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [role, setRole] = useState<string>(seats ? "prosecutor" : "");
  const [step, setStep] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);

  // A student who navigates away mid-hearing has abandoned it, not finished it.
  // Best-effort by nature: keepalive because the page is already unloading.
  const openSession = useRef<string | null>(null);
  /** The scene's window, so a message from it can be told apart from any other. */
  const frame = useRef<HTMLIFrameElement | null>(null);
  useEffect(() => {
    openSession.current = sessionId;
  }, [sessionId]);

  useEffect(() => {
    const leave = () => {
      const id = openSession.current;
      if (!id) return;
      navigator.sendBeacon?.(
        `/api/simulations/${id}/abandon`,
        new Blob([JSON.stringify({})], { type: "application/json" }),
      );
    };
    window.addEventListener("pagehide", leave);
    return () => {
      window.removeEventListener("pagehide", leave);
    };
  }, []);

  /**
   * The scene asking to be put away.
   *
   * A courtroom in an iframe cannot navigate the page that framed it and should
   * not be able to, so "Return to lesson" is a message rather than a redirect.
   * Every message is checked three ways before it moves anything: it has to come
   * from the window this component mounted, from the origin the scene is served
   * from, and carry one of the `source` tags a Converso scene stamps. The first
   * check is the one that matters — `event.source` cannot be forged by another
   * frame — and the other two make an accident as unlikely as an attack.
   *
   * The tag is checked against the contract's list rather than against one
   * hard-coded name, because two scenes send this message: the courtroom and the
   * language room. A listener that knew only the courtroom's tag would ignore the
   * classroom's button and leave the student stuck in the frame.
   *
   * What it does is the same thing the close button does: back to "ready", scene
   * unmounted. The session is not completed here, because pressing a button in a
   * browser is not a hearing ending; the scene's own abandon beacon settles that
   * with the server, and it declines to fire if a result was already reported.
   */
  useEffect(() => {
    if (phase !== "live" || !src) return undefined;

    let expected: string;
    try {
      expected = new URL(src, window.location.origin).origin;
    } catch {
      // A malformed NEXT_PUBLIC_*_URL. Wiring up a listener that can never match
      // is worse than not having one, because it looks like it works.
      return undefined;
    }

    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
      if (event.origin !== expected) return;
      const data = event.data as { source?: string; type?: string } | null;
      if (!data?.source || !SIMULATION_FRAME_SOURCES.includes(data.source)) return;
      if (data.type !== FRAME_MESSAGES.RETURN_TO_LESSON) return;

      setPhase("ready");
      setLaunchUrl(null);
      setSessionId(null);
      setStep(0);
    };

    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
    };
  }, [phase, src]);

  const start = useCallback(async () => {
    setPhase("starting");
    setProblem(null);
    setStep(0);

    try {
      const res = await fetch("/api/simulations/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          companionId,
          subject,
          ...(seats && role ? { role } : {}),
        }),
      });

      setStep(1);

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        // The server has already decided what a student may be told. Show that
        // sentence; the reason behind it is in the server log.
        setProblem(data.error || "Could not start the session.");
        setPhase("failed");
        return;
      }

      setStep(2);
      setSessionId(data.sessionId ?? null);
      setLaunchUrl(data.url ?? null);
      setPhase("live");
    } catch {
      setProblem("Could not reach Converso. Check your connection and try again.");
      setPhase("failed");
    }
  }, [companionId, subject, seats, role]);

  // Defer one tick so React's development remount cancels the first call
  // before it hits the server, and a later visit still launches again.
  useEffect(() => {
    if (!autoStart || !src) return undefined;
    const timer = window.setTimeout(() => {
      void start();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [autoStart, src, start]);

  /* --- nothing to launch ------------------------------------------------- */

  if (!src) {
    return (
      <div className="panel relative flex h-full min-h-0 flex-col overflow-hidden p-0">
        <Header title={title} glow={glow} status="scene not connected" />
        <div className="grid min-h-0 flex-1 place-items-center p-8">
          <div className="max-w-sm text-center">
            {/* A single hairline horizon rather than a spinner: nothing is
                loading, so nothing should look like it is. */}
            <div
              className="mx-auto mb-6 h-px w-32"
              style={{ background: `linear-gradient(90deg, transparent, ${glow}, transparent)` }}
            />
            <p className="font-display text-lg text-[var(--ink)]">Scene comes later</p>
            <p className="mt-2 text-sm leading-relaxed text-[var(--ink-dim)]">{description}</p>
            <p className="meta mt-6">set {envVar}</p>
            <p className="mt-2 text-xs leading-relaxed text-[var(--ink-faint)]">
              The conversation beside this works now. Only the render is waiting.
            </p>
          </div>
        </div>
      </div>
    );
  }

  /* --- running ----------------------------------------------------------- */

  if (phase === "live" && launchUrl) {
    return (
      <div className="panel relative flex h-full min-h-0 flex-col overflow-hidden p-0">
        <Header title={title} glow={glow} status="live" />
        <div className="relative min-h-0 flex-1">
          <iframe
            ref={frame}
            title={title}
            src={launchUrl}
            allow="camera; microphone; xr-spatial-tracking; fullscreen"
            className="h-full w-full border-0 bg-[var(--ground-deep)]"
          />
          {caption && (
            <p className="pointer-events-none absolute bottom-3 left-3 rounded-[8px] border border-[var(--edge)] bg-[var(--ground-deep)]/85 px-2.5 py-1.5 text-xs text-[var(--ink-dim)]">
              {caption}
            </p>
          )}
          <a
            href={launchUrl}
            target="_blank"
            rel="noreferrer"
            className="btn-icon absolute right-3 top-3 bg-[var(--ground-deep)]/85"
            aria-label="Open the scene in its own tab"
          >
            <ExternalLink size={14} />
          </a>
        </div>
      </div>
    );
  }

  /* --- ready, starting, failed ------------------------------------------- */

  return (
    <div className="panel relative flex h-full min-h-0 flex-col overflow-hidden p-0">
      <Header
        title={title}
        glow={glow}
        status={phase === "starting" ? "opening" : phase === "failed" ? "not started" : "ready"}
      />

      <div className="grid min-h-0 flex-1 place-items-center p-8">
        <div className="w-full max-w-sm">
          <div
            className="mx-auto mb-6 h-px w-32"
            style={{ background: `linear-gradient(90deg, transparent, ${glow}, transparent)` }}
          />

          <p className="text-center font-display text-lg text-[var(--ink)]">{title}</p>
          <p className="mt-2 text-center text-sm leading-relaxed text-[var(--ink-dim)]">
            {description}
          </p>

          {phase === "starting" ? (
            // The same three-step boot the courtroom itself uses, so the wait
            // looks like one continuous thing across the iframe boundary.
            <ol className="nd-steps mt-7">
              {STEPS.map((s, i) => (
                <li
                  key={s.id}
                  className="nd-step"
                  data-state={i < step ? "done" : i === step ? "active" : undefined}
                >
                  {s.label}
                </li>
              ))}
            </ol>
          ) : (
            <>
              {seats && (
                <div className="mt-7">
                  <p className="meta mb-2">your seat</p>
                  <div className="flex flex-wrap gap-2">
                    {PLAYABLE_ROLES.map((seat) => (
                      <button
                        key={seat}
                        type="button"
                        onClick={() => setRole(seat)}
                        data-seat={seat}
                        className="tool px-3 py-1.5 text-xs capitalize transition-colors"
                        style={
                          role === seat
                            ? { borderColor: glow, color: "var(--ink)" }
                            : { color: "var(--ink-dim)" }
                        }
                        aria-pressed={role === seat}
                      >
                        {seat}
                      </button>
                    ))}
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-[var(--ink-faint)]">
                    The other six are played by the engine. Whichever you take, the
                    same rules decide whether a move is allowed.
                  </p>
                </div>
              )}

              <button
                type="button"
                onClick={start}
                className="btn-flame mt-7 w-full justify-center"
              >
                {phase === "failed" ? (
                  <>
                    <RotateCcw size={14} /> Try again
                  </>
                ) : (
                  `Start ${title}`
                )}
              </button>

              {problem && (
                <p className="nd-notice nd-notice-bad mt-4 px-3 py-2 text-xs leading-relaxed">
                  {problem}
                </p>
              )}

              <p className="mt-3 text-center text-xs leading-relaxed text-[var(--ink-faint)]">
                Opens in this panel. Nothing downloads until you start.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const Header = ({ title, glow, status }: { title: string; glow: string; status: string }) => (
  <div className="flex shrink-0 items-center gap-2 border-b border-[var(--edge)] px-4 py-2.5">
    <span className="meta" style={{ color: glow }}>
      {title}
    </span>
    <span className="meta ml-auto">{status}</span>
  </div>
);
