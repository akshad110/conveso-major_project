"use client";

import { getLanguage } from "@/lib/languages.mjs";
import { useAITeacher } from "@/hooks/useAITeacher";
import { useEffect, useState } from "react";

export const TypingBox = () => {
  const askAI = useAITeacher((state) => state.askAI);
  const loading = useAITeacher((state) => state.loading);
  const language = useAITeacher((state) => state.language);
  const error = useAITeacher((state) => state.error);
  const voiceWarning = useAITeacher((state) => state.voiceWarning);
  const ollama = useAITeacher((state) => state.ollama);
  const checkOllama = useAITeacher((state) => state.checkOllama);
  const lastMs = useAITeacher((state) => state.lastMs);
  const lastCached = useAITeacher((state) => state.lastCached);
  const lastSource = useAITeacher((state) => state.lastSource);
  const [question, setQuestion] = useState("");
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    // Also asks Ollama to load the model, so the first answer isn't paying for it.
    checkOllama();
  }, [checkOllama]);

  // A local model takes seconds, not milliseconds. A spinner with no numbers on it
  // feels broken; a counter feels like progress.
  useEffect(() => {
    if (!loading) return undefined;
    setElapsed(0);
    const startedAt = Date.now();
    const timer = setInterval(() => setElapsed(Math.round((Date.now() - startedAt) / 100) / 10), 100);
    return () => clearInterval(timer);
  }, [loading]);

  const config = getLanguage(language);

  const ask = () => {
    askAI(question);
    setQuestion("");
  };

  return (
    // nd-float: a matte panel with a lit top edge, held up in front of the room.
    // Not frosted — a blurred card over a 3D scene reads as a video call.
    <div className="nd-float ask" data-language={language}>
      <div>
        <h2>How do you say it in {config.label}?</h2>
        <p style={{ color: "var(--ink-dim)", marginTop: 6 }}>
          Type it in English — or in{" "}
          <span className={config.fontClass} style={{ color: "var(--hue)" }}>
            {config.native}
          </span>{" "}
          if you already know some, spelling and all. The teacher puts the natural
          version on the board, then breaks the grammar down.
        </p>
      </div>

      {loading ? (
        // The same waveform the LMS uses for a talking tutor, in its third state.
        // One animated element in the whole design, reused by meaning.
        <div className="ask-status">
          <span className="nd-wave" data-state="connecting" aria-hidden="true">
            {[0, 1, 2, 3, 4].map((i) => (
              // --i staggers the bars; the pack computes animation-delay from it.
              <i key={i} className="nd-wave-bar" style={{ "--i": i }} />
            ))}
          </span>
          <span className="ask-elapsed">
            THINKING · {elapsed.toFixed(1)}S
            {elapsed > 25 && " · COLD MODEL LOAD IS SLOW THE FIRST TIME"}
          </span>
        </div>
      ) : (
        <div className="ask-row">
          <input
            className="nd-field"
            placeholder={config.sample}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                ask();
              }
            }}
          />
          <button className="nd-btn nd-btn-flame" onClick={ask}>
            Ask
          </button>
        </div>
      )}

      {error && (
        <div className="nd-notice nd-notice-bad" style={{ padding: "14px 16px" }}>
          <p style={{ fontWeight: 500 }}>{error.message}</p>
          {error.hint && <p>{error.hint}</p>}
        </div>
      )}

      {!error && voiceWarning && (
        <p style={{ fontSize: 13, color: "var(--warn)" }}>{voiceWarning}</p>
      )}

      {/* Machine facts: mono, uppercase, quiet. Which model, how long it took. */}
      <p className="nd-meta">
        {ollama.checked ? (
          ollama.ok ? (
            <>
              LOCAL · {ollama.model}
              {lastMs !== null && (
                <>
                  {" · "}
                  {lastCached
                    ? "CACHED"
                    : lastSource === "phrasebook"
                      ? "PHRASEBOOK"
                      : `${(lastMs / 1000).toFixed(1)}S`}
                </>
              )}
            </>
          ) : (
            <>OLLAMA UNREACHABLE — {ollama.hint}</>
          )
        ) : (
          <>CHECKING FOR OLLAMA…</>
        )}
      </p>
    </div>
  );
};
