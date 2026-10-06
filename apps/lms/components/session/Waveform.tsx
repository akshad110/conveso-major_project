"use client";

/**
 * The one piece of decoration in the interface, and it is not decoration.
 *
 * A voice session has four states and a student needs to know which one they
 * are in without reading a word: the line is flat when nothing is connected,
 * it scans while the call is being set up, it breathes while the companion is
 * listening to them, and it moves while the companion is talking. Everything
 * else on the page is deliberately still so that this reads instantly from the
 * corner of the eye.
 *
 * The animation lives in globals.css under .wave so that it can be driven by
 * a data attribute rather than by re-rendering React thirty times a second.
 */

const BARS = 40;

export default function Waveform({
  state,
  className = "",
}: {
  state: "idle" | "connecting" | "listening" | "speaking";
  className?: string;
}) {
  return (
    <div
      className={`wave ${className}`}
      data-state={state}
      role="img"
      aria-label={
        {
          idle: "Not connected",
          connecting: "Connecting",
          listening: "Listening to you",
          speaking: "Companion speaking",
        }[state]
      }
    >
      {Array.from({ length: BARS }).map((_, i) => (
        <span
          key={i}
          className="wave-bar"
          style={{ "--i": i } as React.CSSProperties}
        />
      ))}
    </div>
  );
}
