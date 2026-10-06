"use client";

import { getLanguage } from "@/lib/languages.mjs";
import { languages, teachers, useAITeacher } from "@/hooks/useAITeacher";

export const BoardSettings = () => {
  const showReading = useAITeacher((state) => state.showReading);
  const setShowReading = useAITeacher((state) => state.setShowReading);

  const english = useAITeacher((state) => state.english);
  const setEnglish = useAITeacher((state) => state.setEnglish);

  const teacher = useAITeacher((state) => state.teacher);
  const setTeacher = useAITeacher((state) => state.setTeacher);

  const speech = useAITeacher((state) => state.speech);
  const setSpeech = useAITeacher((state) => state.setSpeech);

  const classroom = useAITeacher((state) => state.classroom);
  const setClassroom = useAITeacher((state) => state.setClassroom);

  const language = useAITeacher((state) => state.language);
  const setLanguage = useAITeacher((state) => state.setLanguage);

  const config = getLanguage(language);

  return (
    <>
      {/* Who is teaching. A photograph, so a tile rather than a pill. */}
      <div className="board-rail" style={{ right: 0, bottom: "100%", gap: 28, marginBottom: 160 }}>
        {teachers.map((sensei) => (
          <button
            key={sensei}
            className="board-teacher"
            data-active={teacher === sensei}
            onClick={() => setTeacher(sensei)}
          >
            <img src={`/images/${sensei}.jpg`} alt={sensei} />
            <span className="board-teacher-name">{sensei}</span>
          </button>
        ))}
      </div>

      {/* Which room. */}
      <div className="board-rail" style={{ left: 0, bottom: "100%", marginBottom: 160 }}>
        <button
          className="board-pill"
          data-active={classroom === "default"}
          onClick={() => setClassroom("default")}
        >
          Default room
        </button>
        <button
          className="board-pill"
          data-active={classroom === "alternative"}
          onClick={() => setClassroom("alternative")}
        >
          Alternative room
        </button>
      </div>

      {/* Language picker — sits just above the board, the widest row on screen.
          Native script first, because that is what the eye is looking for; the
          English name below it is a label, so mono. */}
      <div
        className="board-rail"
        style={{ left: 0, right: 0, bottom: "100%", marginBottom: 24, justifyContent: "center" }}
      >
        {languages.map((code) => {
          const item = getLanguage(code);
          return (
            <button
              key={code}
              data-language={code}
              data-active={language === code}
              className="board-lang"
              onClick={() => setLanguage(code)}
            >
              <span className={`board-lang-native ${item.fontClass}`}>{item.native}</span>
              <span className="board-lang-label">{item.label}</span>
            </button>
          );
        })}
      </div>

      {/* Register: how formally the teacher should speak. */}
      <div className="board-rail" style={{ left: 0, top: "100%", marginTop: 80 }}>
        {config.speechModes.map((mode) => (
          <button
            key={mode.id}
            className="board-pill"
            data-active={speech === mode.id}
            onClick={() => setSpeech(mode.id)}
          >
            {mode.label}
            {mode.note ? <span className="board-pill-note"> {mode.note}</span> : null}
          </button>
        ))}
      </div>

      {/* What the board shows alongside the answer. */}
      <div className="board-rail" style={{ right: 0, top: "100%", marginTop: 80 }}>
        {config.reading.enabled && (
          <button
            className="board-pill"
            data-active={showReading}
            onClick={() => setShowReading(!showReading)}
          >
            {config.reading.label}
          </button>
        )}
        <button className="board-pill" data-active={english} onClick={() => setEnglish(!english)}>
          English
        </button>
      </div>
    </>
  );
};
