/**
 * Your turn.
 *
 * The court has stopped and is waiting on the person playing a seat. Everything
 * this panel offers came out of the engine's YOUR_TURN message: the actions are
 * the ones the Courtroom State Engine has already established are legal in this
 * phase for this role, the exhibits are the ones that could actually be put in
 * right now, and the objection grounds are the ones the objection engine detected
 * in the question on the floor.
 *
 * So there is no legal reasoning below — not a single rule about who may do what.
 * A choice made here is a *proposal*: it goes back over the socket as
 * HUMAN_ACTION, through validateDecision like an agent's, and if it is refused the
 * engine asks again with the reason attached, which is shown verbatim. Two other
 * ways out: hand the turn to the AI, or, when the court is merely offering an
 * objection, let the question stand.
 */
import { useEffect, useRef, useState } from 'react'
import { sendCourtCommand } from '../state/useCourtSocket'
import { useCourtStore } from '../state/useCourtStore'

/** Courtroom actions in the words a person would use for them. */
const ACTION_LABELS = {
  SPEAK: 'Address the court',
  QUESTION_WITNESS: 'Question the witness',
  ANSWER: 'Answer',
  OBJECT: 'Object',
  RULE: 'Rule on the objection',
  GAVEL: 'Call for order',
  PRESENT_EVIDENCE: 'Present an exhibit',
  SHOW_EVIDENCE: 'Show an exhibit',
  ADMIT_EVIDENCE: 'Admit the exhibit',
  EXCLUDE_EVIDENCE: 'Exclude the exhibit',
  CALL_WITNESS: 'Call the witness',
  SWEAR_IN: 'Swear in the witness',
  POINT: 'Point',
  STAND: 'Rise',
  SIT: 'Be seated',
  LISTEN: 'Listen',
  WAIT: 'Say nothing',
  REACT: 'React',
}

/** What the words are for, so the field is never a blank box with no brief. */
const SPEECH_HINTS = {
  SPEAK: 'What you say to the court',
  QUESTION_WITNESS: 'Your question to the witness',
  ANSWER: 'Your answer',
  OBJECT: 'Objection, Your Honour —',
  RULE: 'The words of your ruling',
  GAVEL: 'Order in court —',
  PRESENT_EVIDENCE: 'How you introduce the exhibit',
  SHOW_EVIDENCE: 'What you draw the court to',
  ADMIT_EVIDENCE: 'The words admitting it to the record',
  EXCLUDE_EVIDENCE: 'The words keeping it out',
  CALL_WITNESS: 'Call the witness to the box',
}

const RULING_LABELS = { SUSTAIN: 'Sustained', OVERRULE: 'Overruled' }

function actionLabel(action) {
  if (ACTION_LABELS[action]) return ACTION_LABELS[action]
  return String(action || '')
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/^./, (c) => c.toUpperCase())
}

function phaseLabel(phase) {
  return String(phase || '').toLowerCase().replace(/_/g, ' ')
}

export default function TurnPanel() {
  const prompt = useCourtStore((s) => s.human.prompt)
  const waiting = useCourtStore((s) => s.human.waiting)
  const seatLabel = useCourtStore((s) => s.human.label)
  const error = useCourtStore((s) => s.human.error)

  const kind = prompt?.kind || null
  // The engine numbers its questions, so identity comes from the court rather
  // than from a guess. The old key — kind, turn number and role glued together —
  // could not tell two objection offers inside one turn apart, so a refusal on
  // the second looked like the first and the draft was kept when it should have
  // been cleared. `id` also rides back on every answer as `replyTo`, which is
  // what stops a click that lands late from being applied to the next question.
  const promptId = prompt ? (prompt.id ?? `${kind}:${prompt.turnNumber}:${prompt.role}`) : null

  const [action, setAction] = useState(null)
  const [evidence, setEvidence] = useState(null)
  const [speech, setSpeech] = useState('')
  const [ruling, setRuling] = useState(null)
  const [category, setCategory] = useState(null)
  const [sent, setSent] = useState(false)
  const seen = useRef(null)

  // A fresh question resets the draft. A *re-ask* of the same question — which is
  // what a refusal is — keeps the words, because it was the move that was refused
  // and not usually the sentence.
  useEffect(() => {
    if (!prompt) return
    const actions = prompt.actions || []
    setAction(actions.includes(prompt.expect) ? prompt.expect : actions[0] || null)
    setEvidence(null)
    setRuling(null)
    setCategory(prompt.grounds?.[0]?.category || null)
    setSent(false)
    if (seen.current !== promptId) {
      setSpeech('')
      seen.current = promptId
    }
  }, [prompt, promptId])

  if (!waiting || !prompt) return null

  const exhibitsFor = prompt.evidenceOptions?.[action] || []
  const exhibitTitle = (id) => prompt.evidence?.find((x) => x.id === id)?.title || id
  const speaks = (prompt.speaks || []).includes(action)
  const needsRuling = Boolean(prompt.rulings?.length) || kind === 'RULING'
  // A speaking action with nothing said is refused upstream as NOTHING_TO_SAY, so
  // the button waits rather than earning a pointless refusal. An objection and a
  // ruling both have standard words the engine supplies if you type none, so those
  // are free to be a single click.
  const wordsMissing = kind === 'TURN' && speaks && !speech.trim()
  // Same courtesy for the exhibit. The engine listed several documents this action
  // could be taken against and cannot guess which — it fills one in only when
  // there is exactly one — so an unmade choice is an unfinished draft, not a move
  // to send and have refused as EVIDENCE_MISSING_ID.
  const exhibitMissing = kind === 'TURN' && exhibitsFor.length > 1 && !evidence

  const ready = kind === 'OBJECTION'
    ? Boolean(category)
    : needsRuling
      ? Boolean(ruling)
      : Boolean(action) && !wordsMissing && !exhibitMissing

  const submit = () => {
    if (!ready || sent) return
    // `replyTo` names the question being answered. The court closes questions on
    // its own schedule — a refusal comes back as a new one, an objection can
    // interrupt — so an answer that arrives a moment late would otherwise be
    // applied to whatever is open instead, putting words written for one question
    // into the mouth of another.
    const payload = { type: 'HUMAN_ACTION', replyTo: prompt.id, speech: speech.trim() }
    if (kind === 'OBJECTION') {
      payload.action = 'OBJECT'
      payload.category = category
    } else if (kind === 'RULING') {
      payload.action = 'RULE'
      payload.ruling = ruling
    } else {
      payload.action = action
      if (ruling) payload.ruling = ruling
      if (evidence || exhibitsFor.length === 1) payload.evidence = evidence || exhibitsFor[0]
    }
    setSent(true)
    sendCourtCommand(payload)
  }

  const handOff = () => {
    if (sent) return
    setSent(true)
    sendCourtCommand({ type: 'HUMAN_HANDOFF', replyTo: prompt.id })
  }

  const letStand = () => {
    if (sent) return
    setSent(true)
    sendCourtCommand({ type: 'HUMAN_PASS', replyTo: prompt.id })
  }

  const onKeyDown = (ev) => {
    if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) {
      ev.preventDefault()
      submit()
    }
  }

  return (
    <section className="turn" aria-live="polite">
      <header className="turn-head">
        <div>
          <div className="turn-eyebrow">
            {kind === 'OBJECTION' ? 'Object?' : kind === 'RULING' ? 'The bench rules' : 'Your turn'}
          </div>
          <div className="turn-seat">{seatLabel || prompt.role}</div>
        </div>
        <div className="turn-where">
          <span>{phaseLabel(prompt.phase)}</span>
          <span className="turn-num">turn {prompt.turnNumber}</span>
        </div>
      </header>

      <div className="turn-scroll">
        {prompt.note ? <p className="turn-note">{prompt.note}</p> : null}

        {prompt.rejection ? (
          <p className="turn-refused">
            <span>The court refuses that</span>
            {prompt.rejection.message}
          </p>
        ) : null}

        {error ? <p className="turn-refused"><span>The court</span>{error}</p> : null}

        {prompt.witness ? (
          <p className="turn-ctx">
            <span>In the box</span>
            {prompt.witness.name}
            {prompt.witness.role ? `, ${prompt.witness.role}` : ''}
          </p>
        ) : null}

        {prompt.question ? (
          <p className="turn-ctx quote">
            <span>{kind === 'TURN' ? 'Last question' : 'The question'}</span>
            “{prompt.question}”
          </p>
        ) : null}

        {prompt.answer && kind === 'TURN' ? (
          <p className="turn-ctx quote">
            <span>Answer</span>
            “{prompt.answer}”
          </p>
        ) : null}

        {prompt.struck ? (
          <p className="turn-ctx">
            <span>Struck — do not ask again</span>
            “{prompt.struck}”
          </p>
        ) : null}

        {kind === 'RULING' && prompt.objection ? (
          <p className="turn-ctx">
            <span>{prompt.objection.by === 'prosecutor' ? 'The prosecution objects' : 'The defence objects'}</span>
            {prompt.objection.label || prompt.objection.category}
            {prompt.objection.explains ? ` — ${prompt.objection.explains}` : ''}
          </p>
        ) : null}

        {/* --- what you may do ------------------------------------------- */}

        {kind === 'TURN' ? (
          <>
            <div className="turn-label">The court will allow</div>
            <div className="turn-acts">
              {(prompt.actions || []).map((a) => (
                <button
                  key={a}
                  type="button"
                  className="turn-act"
                  data-on={a === action ? 'yes' : 'no'}
                  onClick={() => { setAction(a); setEvidence(null) }}
                >
                  {actionLabel(a)}
                </button>
              ))}
            </div>
          </>
        ) : null}

        {kind === 'OBJECTION' ? (
          <>
            <div className="turn-label">
              On what ground
              {prompt.grounds?.length ? <em>{prompt.grounds.length} detected in the question</em> : null}
            </div>
            <div className="turn-grounds">
              {(prompt.grounds || []).map((g) => (
                <button
                  key={g.category}
                  type="button"
                  className="ground"
                  data-on={g.category === category ? 'yes' : 'no'}
                  onClick={() => setCategory(g.category)}
                >
                  <span className="ground-label">{g.label}</span>
                  {g.note ? <span className="ground-note">{g.note}</span> : null}
                </button>
              ))}
            </div>
            <label className="turn-field">
              <span>Any other ground</span>
              <select
                className="sel"
                value={category || ''}
                onChange={(ev) => setCategory(ev.target.value || null)}
              >
                <option value="">choose a ground</option>
                {(prompt.categories || []).map((c) => (
                  <option key={c.category} value={c.category}>
                    {c.label} — {c.explains}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : null}

        {needsRuling ? (
          <>
            <div className="turn-label">Your ruling</div>
            <div className="turn-acts">
              {(prompt.rulings || ['SUSTAIN', 'OVERRULE']).map((r) => (
                <button
                  key={r}
                  type="button"
                  className="turn-act wide"
                  data-on={r === ruling ? 'yes' : 'no'}
                  onClick={() => setRuling(r)}
                >
                  {RULING_LABELS[r] || r}
                </button>
              ))}
            </div>
          </>
        ) : null}

        {kind === 'TURN' && exhibitsFor.length ? (
          <label className="turn-field">
            <span>Which exhibit</span>
            {exhibitsFor.length === 1 ? (
              <span className="turn-one">
                {exhibitsFor[0]} · {exhibitTitle(exhibitsFor[0])}
              </span>
            ) : (
              <select
                className="sel"
                value={evidence || ''}
                onChange={(ev) => setEvidence(ev.target.value || null)}
              >
                <option value="">choose an exhibit</option>
                {exhibitsFor.map((id) => (
                  <option key={id} value={id}>{id} · {exhibitTitle(id)}</option>
                ))}
              </select>
            )}
          </label>
        ) : null}

        {(kind !== 'TURN' || speaks) ? (
          <label className="turn-field">
            <span>{SPEECH_HINTS[kind === 'OBJECTION' ? 'OBJECT' : kind === 'RULING' ? 'RULE' : action] || 'Your words'}</span>
            <textarea
              className="turn-say"
              rows={3}
              value={speech}
              placeholder={kind === 'OBJECTION' ? 'Objection, Your Honour — the question is leading.' : ''}
              onChange={(ev) => setSpeech(ev.target.value)}
              onKeyDown={onKeyDown}
            />
          </label>
        ) : null}
      </div>

      <footer className="turn-foot">
        <button type="button" className="turn-go" disabled={!ready || sent} onClick={submit}>
          {sent ? 'With the court…' : kind === 'OBJECTION' ? 'Raise it' : 'Say it'}
        </button>
        {kind === 'OBJECTION' ? (
          <button type="button" className="turn-alt" disabled={sent} onClick={letStand}>
            Let it stand
          </button>
        ) : null}
        <button type="button" className="turn-alt" disabled={sent} onClick={handOff}>
          Let the AI take this turn
        </button>
        <span className="turn-hint">
          {exhibitMissing ? 'choose an exhibit' : wordsMissing ? 'the court needs your words' : '⌘↵'}
        </span>
      </footer>
    </section>
  )
}
