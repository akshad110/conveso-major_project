"use client";

import { getLanguage, getSpeechMode } from "@/lib/languages.mjs";
import { useAITeacher } from "@/hooks/useAITeacher";
import { useEffect, useRef } from "react";

/** Play / stop, at board scale. Two paths in one outline, so one component. */
const SpeakIcon = ({ playing }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    strokeWidth={1.5}
    stroke="currentColor"
    width={64}
    height={64}
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
    />
    {playing ? (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 9.563C9 9.252 9.252 9 9.563 9h4.874c.311 0 .563.252.563.563v4.874c0 .311-.252.563-.563.563H9.564A.562.562 0 0 1 9 14.437V9.564Z"
      />
    ) : (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15.91 11.672a.375.375 0 0 1 0 .656l-5.603 3.113a.375.375 0 0 1-.557-.328V8.887c0-.286.307-.466.557-.327l5.603 3.112Z"
      />
    )}
  </svg>
);

export const MessagesList = () => {
  const messages = useAITeacher((state) => state.messages);
  const playMessage = useAITeacher((state) => state.playMessage);
  const stopMessage = useAITeacher((state) => state.stopMessage);
  const currentMessage = useAITeacher((state) => state.currentMessage);
  const english = useAITeacher((state) => state.english);
  const showReading = useAITeacher((state) => state.showReading);
  const classroom = useAITeacher((state) => state.classroom);
  const language = useAITeacher((state) => state.language);

  const container = useRef();

  useEffect(() => {
    container.current.scrollTo({
      top: container.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages.length]);

  const board = getLanguage(language).board;

  const renderEnglish = (englishText) =>
    english ? <p className="board-english">{englishText}</p> : null;

  /** Same renderer for every language — the reading line is furigana, romaji or nothing. */
  const renderTarget = (words, languageCode) => {
    const config = getLanguage(languageCode);
    return (
      <p className={`board-target ${config.fontClass}`}>
        {(words || []).map((word, i) => (
          <span key={i} className="board-word">
            {showReading && config.reading.enabled && word.reading && (
              <span className="board-reading">{word.reading}</span>
            )}
            {word.word}
          </span>
        ))}
      </p>
    );
  };

  return (
    <div
      className="board"
      data-language={language}
      style={
        classroom === "default"
          ? { width: 1288, height: 676 }
          : { width: 2528, height: 856 }
      }
      ref={container}
    >
      {messages.length === 0 && (
        <div className="board-idle">
          <h2 className="board-idle-title">{board.title}</h2>
          <p className={`board-idle-native ${getLanguage(language).fontClass}`}>
            {board.native}
          </p>
          <p className="board-idle-hint">Ask something below to begin</p>
        </div>
      )}
      {messages.map((message, i) => {
        const languageCode = message.language || message.answer.language;
        const mode = getSpeechMode(languageCode, message.speech);
        const playing = currentMessage === message;
        return (
          <div key={i} data-language={languageCode}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 16 }}>
              <div style={{ flex: "1 1 auto" }}>
                {/* Machine facts first, in mono: which language, which register. */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    flexWrap: "wrap",
                    gap: 14,
                  }}
                >
                  <span className="board-tag">{getLanguage(languageCode).label}</span>
                  <span className="board-tag board-tag-hue">
                    {mode.label}
                    {mode.note ? (
                      <span className="board-tag-note">{mode.note}</span>
                    ) : null}
                  </span>
                  {renderEnglish(message.answer.english)}
                </div>

                {renderTarget(message.answer.translation, languageCode)}
              </div>
              <button
                className="board-speak"
                data-playing={playing}
                aria-label={playing ? "Stop" : "Play"}
                onClick={() => (playing ? stopMessage(message) : playMessage(message))}
              >
                <SpeakIcon playing={playing} />
              </button>
            </div>

            <div className="board-grammar">
              <span className="board-grammar-label">Grammar breakdown</span>
              {message.answer.grammarBreakdown.map((grammar, j) => (
                <div key={j} style={{ marginTop: 18 }}>
                  {message.answer.grammarBreakdown.length > 1 && (
                    <>
                      {renderEnglish(grammar.english)}
                      {renderTarget(grammar.translation, languageCode)}
                    </>
                  )}

                  <div className="board-chunks">
                    {grammar.chunks.map((chunk, k) => (
                      <div key={k} className="board-chunk">
                        {renderTarget(chunk.translation, languageCode)}
                        <p className="board-chunk-meaning">{chunk.meaning}</p>
                        <p className="board-chunk-role">{chunk.grammar}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {(message.answer.model || message.voiceName) && (
              <p className="board-source">
                {message.answer.model ? `${message.answer.model} · LOCAL` : ""}
                {message.answer.model && message.voiceName ? " · " : ""}
                {message.voiceName ? `VOICE: ${message.voiceName}` : ""}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
};
