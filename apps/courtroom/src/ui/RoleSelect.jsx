/**
 * The opening screen: which seat do you take?
 *
 * It exists because the engine has to know who is human *before* the first turn
 * is taken — a seat claimed after the court has opened is a seat that already
 * missed its turn. The socket says HOLD the moment it connects, so the trial
 * waits here for as long as this screen is up, and the choice made here is what
 * releases it.
 *
 * Nothing on this screen decides anything about the trial. Picking a seat sends
 * SET_HUMAN_ROLE and START and that is all; the engine confirms with HUMAN_ROLE,
 * refuses with ERROR, and remains the only thing that knows what a judge or a
 * prosecutor is allowed to do.
 */
import { useEffect, useState } from 'react'
import { CASES, caseFromLocation } from '../config/cases'
import { PLAYABLE_SEATS } from '../state/eventTypes'
import { sendCourtCommand } from '../state/useCourtSocket'
import { useCourtStore } from '../state/useCourtStore'

export default function RoleSelect() {
  const connection = useCourtStore((s) => s.connection)
  const startDismissed = useCourtStore((s) => s.human.startDismissed)
  const error = useCourtStore((s) => s.human.error)
  const courtCase = useCourtStore((s) => s.court?.case)
  const dismissStart = useCourtStore((s) => s.dismissStart)
  const [taking, setTaking] = useState(null)
  const [caseId, setCaseId] = useState(caseFromLocation)
  const [queuedRole, setQueuedRole] = useState(undefined)

  useEffect(() => {
    if (connection !== 'open' || startDismissed) return
    sendCourtCommand({ type: 'SET_CASE', caseId })
    if (queuedRole === undefined) return
    if (queuedRole) sendCourtCommand({ type: 'SET_HUMAN_ROLE', role: queuedRole })
    sendCourtCommand({ type: 'START' })
    setQueuedRole(undefined)
    dismissStart()
  }, [connection, caseId, startDismissed, queuedRole, dismissStart])

  // The cases are the front door. Waiting for the engine before drawing them
  // is how the page became a model with a developer panel and no hearing.
  if (startDismissed) return null

  const local = CASES.find((matter) => matter.id === caseId) || CASES[0]
  const live = courtCase?.id === caseId ? courtCase : null

  const pick = (id) => {
    setCaseId(id)
    const url = new URL(window.location.href)
    url.searchParams.set('case', id)
    window.history.replaceState(null, '', url)
  }

  const take = (role) => {
    if (taking) return
    setTaking(role ?? 'watch')
    if (connection !== 'open') {
      setQueuedRole(role)
      return
    }
    sendCourtCommand({ type: 'SET_CASE', caseId })
    if (role) sendCourtCommand({ type: 'SET_HUMAN_ROLE', role })
    sendCourtCommand({ type: 'START' })
    dismissStart()
  }

  const charges = live?.charges?.length ? live.charges : local.charges

  return (
    <div className="start">
      <div className="start-inner">
        <div className="start-rule" />
        <div className="start-cases">
          {CASES.map((matter) => (
            <button
              key={matter.id}
              type="button"
              className="start-case"
              data-on={matter.id === caseId ? 'yes' : 'no'}
              onClick={() => pick(matter.id)}
            >
              {matter.title}
            </button>
          ))}
        </div>
        <div className="start-eyebrow">{live?.jurisdiction ? 'Sessions Court' : 'Criminal trial'}</div>
        <h1 className="start-title">{live?.title || local.title}</h1>

        {charges.length ? (
          <ol className="start-charges">
            {charges.map((charge, index) => (
              <li key={charge?.id || `charge-${index}`}>
                <span className="start-statute">{charge.statute}</span>
                {charge.label}
              </li>
            ))}
          </ol>
        ) : null}

        <div className="start-ask">Take a seat. Every other seat is played by the AI.</div>

        <div className="start-seats">
          {PLAYABLE_SEATS.map((seat) => (
            <button
              key={seat.role}
              type="button"
              className="seat grain"
              disabled={Boolean(taking)}
              data-taking={taking === seat.role ? 'yes' : 'no'}
              onClick={() => take(seat.role)}
            >
              <span className="seat-bench">{seat.bench}</span>
              <span className="seat-label">{seat.label}</span>
              <span className="seat-duty">{seat.duty}</span>
              <span className="seat-go">{taking === seat.role ? 'Rising…' : 'Play this seat'}</span>
            </button>
          ))}
        </div>

        <button
          type="button"
          className="start-watch"
          disabled={Boolean(taking)}
          onClick={() => take(null)}
        >
          Or watch the AI try the case
        </button>

        {connection !== 'open' ? (
          <p className="start-ask">
            {queuedRole !== undefined
              ? 'Waking the hearing. Your seat is held.'
              : 'Both cases are here. The hearing connects in the background.'}
          </p>
        ) : null}

        {error ? <div className="start-error">{error}</div> : null}
      </div>
    </div>
  )
}
