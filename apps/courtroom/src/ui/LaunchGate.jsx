/**
 * What a student sees when the launch has not opened yet, or will not open.
 *
 * Two screens in one file because they are two states of the same moment — the
 * handshake — and both sit in front of an unmounted Canvas. Nothing else is on
 * screen behind them: `App` does not render the room until this hook says the
 * cast is known, so this is the entire page.
 *
 * The refusal text is printed exactly as Converso sent it. Every sentence a
 * student can be shown here is written once, in `LAUNCH_ERROR_TEXT`, and says
 * what to do about it; rewording one in the browser is how two parts of the same
 * product end up telling a student two different things about one session. So
 * this component chooses layout and nothing else — it has no copy of its own
 * beyond the headings.
 *
 * Retry is offered only when the hook says the refusal is worth repeating. A
 * launch token is spent on its first exchange, so a button that re-sends an
 * expired one is a button that fails identically every time it is pressed.
 */

/**
 * The waiting screen: deliberately the loading curtain, not a new design.
 *
 * A student who pressed Start in a lesson should see one continuous act of
 * opening, and this is the first second of it. Reusing `.loading` means the
 * handshake and the 105 MB download look like the same wait, because to the
 * person waiting they are.
 */
function Opening() {
  return (
    <div className="loading">
      <div className="loading-inner">
        <div className="loading-rule" />
        <div className="loading-title">AI Courtroom Simulator</div>
        <div className="loading-sub">Opening your session</div>
        <div className="loading-bar">
          <div className="loading-fill gate-indeterminate" />
        </div>
        <div className="loading-meta">Checking your place in the hearing</div>
      </div>
    </div>
  )
}

/**
 * The refusal screen.
 *
 * @param {{ refusal: {code?: string, message?: string}, canRetry: boolean,
 *           onRetry: () => void, onReturn: () => void }} props
 */
function Refused({ refusal, canRetry, onRetry, onReturn }) {
  return (
    <div className="loading gate-refused">
      <div className="loading-inner">
        <div className="loading-rule" />
        <div className="loading-title">Court is not in session</div>

        {/* Verbatim. See the note at the top of this file. */}
        <p className="gate-message">
          {refusal?.message || 'This session could not be opened. Return to the lesson and try again.'}
        </p>

        <div className="gate-actions">
          {canRetry ? (
            <button className="gate-act" data-weight="primary" onClick={onRetry}>
              Try again
            </button>
          ) : null}
          <button className="gate-act" onClick={onReturn}>
            Return to lesson
          </button>
        </div>

        {/*
          * The code, quietly, in the face used for machine facts. A student does
          * not need it; a teacher reading it over their shoulder does, and it is
          * the difference between "it broke" and a reproducible report.
          */}
        {refusal?.code ? <div className="loading-meta gate-code">{refusal.code}</div> : null}
      </div>
    </div>
  )
}

/**
 * @param {{ mode: string, refusal: object, canRetry: boolean,
 *           onRetry: () => void, onReturn: () => void }} props
 */
export default function LaunchGate({ mode, refusal, canRetry, onRetry, onReturn }) {
  if (mode === 'refused') {
    return (
      <Refused refusal={refusal} canRetry={canRetry} onRetry={onRetry} onReturn={onReturn} />
    )
  }
  // 'opening', and also the tick before the handshake effect has run — both are
  // a student looking at a page that is still working out what it is.
  return <Opening />
}
