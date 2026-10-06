/**
 * The court record, as kept by the clerk.
 *
 * Click the clerk and this opens: the transcript exactly as the engine's
 * CourtroomState recorded it, phase by phase, with the exhibits and rulings
 * beneath. Nothing is composed here — every line, and the order of them, is the
 * engine's record. The panel scrolls it, and the save button writes it out in the
 * layout a court record has: heading, charges, appearances, then the proceedings.
 */
import { useEffect, useMemo, useRef } from 'react'
import { CHARACTER_REGISTRY } from '../config/characterRegistry'
import { useCourtStore } from '../state/useCourtStore'

const SPEAKER = (role) => CHARACTER_REGISTRY[role]?.label || role || 'unknown'

const phaseTitle = (phase) =>
  String(phase || '').replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase())

/** Actions that are business of the court rather than speech, noted as such. */
const ACTION_NOTE = {
  RULE: 'ruling',
  OBJECT: 'objection',
  ADMIT_EVIDENCE: 'admitted',
  EXCLUDE_EVIDENCE: 'excluded',
  PRESENT_EVIDENCE: 'exhibit',
  SHOW_EVIDENCE: 'exhibit',
  GAVEL: 'order',
  QUESTION_WITNESS: 'question',
  ANSWER: 'testimony',
}

/** Split the flat transcript into phase blocks, keeping the engine's order. */
function inPhases(lines) {
  const blocks = []
  for (const line of lines) {
    const last = blocks[blocks.length - 1]
    if (!last || last.phase !== line.phase) blocks.push({ phase: line.phase, lines: [line] })
    else last.lines.push(line)
  }
  return blocks
}

const pad = (n) => String(n).padStart(2, '0')

function wrap(text, width = 78, indent = '    ') {
  const words = String(text).split(/\s+/)
  const out = []
  let row = ''
  for (const word of words) {
    if (row && (row + ' ' + word).length > width) {
      out.push(indent + row)
      row = word
    } else {
      row = row ? `${row} ${word}` : word
    }
  }
  if (row) out.push(indent + row)
  return out.join('\n')
}

/** The saved file: a court record rather than a log dump. */
function buildRecord(court, humanRole) {
  const c = court?.case || {}
  const state = court?.state || {}
  const lines = state.transcript || []
  const now = new Date()
  const out = []

  out.push('IN THE COURT OF SESSIONS')
  if (c.jurisdiction) out.push(wrap(c.jurisdiction, 78, ''))
  out.push('')
  out.push(String(c.title || 'Criminal trial').toUpperCase())
  if (c.id) out.push(`Case No. ${c.id}`)
  if (c.accused) out.push(`Accused: ${c.accused}`)
  out.push('')

  if (c.charges?.length) {
    out.push('CHARGES')
    c.charges.forEach((charge, i) => {
      out.push(`  ${i + 1}. ${charge.label}${charge.statute ? ` (${charge.statute})` : ''}`)
      if (charge.particulars) out.push(wrap(charge.particulars))
    })
    out.push('')
  }

  out.push('APPEARANCES')
  const seat = (role, label) => {
    const who = role === humanRole ? 'played by the user' : 'played by the simulation'
    out.push(`  ${label.padEnd(18)}${SPEAKER(role)} — ${who}`)
  }
  seat('judge', 'Bench')
  seat('prosecutor', 'For the State')
  seat('defense', 'For the accused')
  out.push(`  ${'Also present'.padEnd(18)}Clerk of the court, witness, accused, escort`)
  out.push('')

  out.push('PROCEEDINGS')
  out.push('')
  if (!lines.length) {
    out.push('  The court had not yet opened when this record was taken.')
  }
  let phase = null
  for (const line of lines) {
    if (line.phase !== phase) {
      phase = line.phase
      out.push(`  — ${phaseTitle(phase).toUpperCase()} —`)
      out.push('')
    }
    const at = line.at ? new Date(line.at) : null
    const stamp = at ? `${pad(at.getHours())}:${pad(at.getMinutes())}` : '     '
    const note = ACTION_NOTE[line.action] ? ` (${ACTION_NOTE[line.action]})` : ''
    out.push(`  ${stamp}  ${SPEAKER(line.role).toUpperCase()}${note}:`)
    out.push(wrap(line.text, 74, '      '))
    out.push('')
  }

  const items = court?.evidence?.items || []
  if (items.length) {
    out.push('EXHIBITS')
    for (const item of items) {
      out.push(`  ${item.id.padEnd(12)}${item.title || 'exhibit'} — ${item.status}`)
    }
    out.push('')
  }

  if (state.rulings?.length) {
    out.push('RULINGS ON OBJECTIONS')
    for (const r of state.rulings) {
      out.push(`  ${String(r.id).padEnd(8)}${SPEAKER(r.by)} — ${r.category} — ${r.ruling}`)
      if (r.targetQuestion) out.push(wrap(`Question: “${r.targetQuestion}”`, 74, '      '))
    }
    out.push('')
  }

  out.push(`Record taken ${now.toLocaleString()}.`)
  out.push('This is the record of a training simulation and not of a real court.')
  return out.join('\n')
}

export default function TranscriptPanel() {
  const open = useCourtStore((s) => s.transcriptOpen)
  const close = useCourtStore((s) => s.closeTranscript)
  const court = useCourtStore((s) => s.court)
  const humanRole = useCourtStore((s) => s.human.role)
  const dialogue = useCourtStore((s) => s.dialogue)
  const scroll = useRef(null)

  const lines = court?.state?.transcript || []
  const blocks = useMemo(() => inPhases(lines), [lines])

  // The record follows the proceedings: a new line arriving while the panel is
  // open scrolls to it, the way a reader would.
  useEffect(() => {
    if (!open || !scroll.current) return
    scroll.current.scrollTop = scroll.current.scrollHeight
  }, [open, lines.length])

  useEffect(() => {
    if (!open) return undefined
    const onKey = (ev) => {
      if (ev.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, close])

  if (!open) return null

  // The line still being delivered is not in the record yet — the engine writes it
  // when the beat is applied. Shown greyed so the record never looks behind.
  const live = dialogue.text && dialogue.speaker
    && lines[lines.length - 1]?.text !== dialogue.text
    ? { role: dialogue.speaker, text: dialogue.text }
    : null

  const save = () => {
    const text = buildRecord(court, humanRole)
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `court-record-${court?.case?.id || 'session'}.txt`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    <section className="rec">
      <header className="rec-head">
        <div>
          <div className="rec-eyebrow">Clerk of the court</div>
          <div className="rec-title">{court?.case?.title || 'Court session transcript'}</div>
        </div>
        <button type="button" className="cp-close" onClick={close} title="Close (Esc)">×</button>
      </header>

      <div className="rec-scroll" ref={scroll}>
        {!blocks.length ? (
          <p className="rec-empty">Nothing has been said on the record yet.</p>
        ) : null}

        {blocks.map((block, i) => (
          <div className="rec-block" key={`${block.phase}-${i}`}>
            <div className="rec-phase">{phaseTitle(block.phase)}</div>
            {block.lines.map((line) => (
              <p className="rec-line" key={`${line.index}-${line.at}`}>
                <span className="rec-who" data-seat={line.role || undefined}>
                  {SPEAKER(line.role)}
                  {line.played ? <em title="spoken by you">you</em> : null}
                  {ACTION_NOTE[line.action] ? <i>{ACTION_NOTE[line.action]}</i> : null}
                </span>
                {line.text}
              </p>
            ))}
          </div>
        ))}

        {live ? (
          <p className="rec-line live">
            <span className="rec-who" data-seat={live.role || undefined}>
              {SPEAKER(live.role)}<i>speaking</i>
            </span>
            {live.text}
          </p>
        ) : null}
      </div>

      <footer className="rec-foot">
        <button type="button" className="turn-go" onClick={save} disabled={!lines.length}>
          Save the record
        </button>
        <span className="rec-count">
          {lines.length} {lines.length === 1 ? 'entry' : 'entries'}
          {court?.evidence?.admitted?.length
            ? ` · ${court.evidence.admitted.length} admitted`
            : ''}
        </span>
      </footer>
    </section>
  )
}
