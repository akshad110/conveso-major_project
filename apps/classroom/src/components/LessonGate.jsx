"use client";

/**
 * The two things a launched lesson adds to this room, and a standalone one
 * never shows.
 *
 *   LessonGate  what a student sees while their session is being opened, and
 *               what they see if it will not open. Nothing is behind it: the
 *               room does not render until the handshake lands.
 *
 *   EndLesson   the way out. A hearing ends itself — the engine reaches a
 *               verdict — but nothing in a conversation with a teacher ever
 *               says "that was the lesson", so a launched classroom needs
 *               somewhere to say it. Without this the only way out is closing
 *               the tab, which Converso reads as an abandonment.
 *
 * The refusal text is printed exactly as Converso sent it. Every sentence a
 * student can be shown here is written once, in `LAUNCH_ERROR_TEXT`, and says
 * what to do about it; rewording one in the browser is how two parts of the
 * same product end up telling a student two different things about one session.
 * So this file chooses layout and nothing else — it has no copy of its own
 * beyond the headings and the buttons.
 */

export function LessonGate({ mode, refusal, canRetry, onRetry, onReturn }) {
  const refused = mode === "refused";

  return (
    <div className="lesson-gate" data-state={refused ? "refused" : "opening"}>
      <div className="lesson-gate-inner">
        <div className="lesson-gate-rule" />

        <p className="lesson-gate-title">
          {refused ? "The lesson could not be opened" : "Opening your lesson"}
        </p>

        {/* Verbatim. See the note at the top of this file. */}
        <p className="lesson-gate-message">
          {refused
            ? refusal?.message ||
              "This session could not be opened. Return to the lesson and try again."
            : "Checking your place with Converso."}
        </p>

        {refused ? (
          <div className="lesson-gate-actions">
            {canRetry ? (
              <button type="button" className="nd-btn nd-btn-flame" onClick={onRetry}>
                Try again
              </button>
            ) : null}
            <button type="button" className="nd-btn nd-btn-ghost" onClick={onReturn}>
              Return to lesson
            </button>
          </div>
        ) : null}

        {refused && refusal?.code ? (
          <p className="lesson-gate-code">{refusal.code}</p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * @param {{ onEnd: () => void, ending: boolean, questionsAsked: number }} props
 */
export function EndLesson({ onEnd, ending, questionsAsked }) {
  return (
    <div className="lesson-end">
      <button
        type="button"
        className="nd-btn nd-btn-sm"
        onClick={onEnd}
        disabled={ending}
        title="Report this lesson to Converso and go back"
      >
        {ending ? "Saving…" : "End lesson"}
      </button>
      {/* What will be reported, so pressing the button is never a surprise. */}
      <span className="lesson-end-count">
        {questionsAsked} {questionsAsked === 1 ? "question" : "questions"}
      </span>
    </div>
  );
}
