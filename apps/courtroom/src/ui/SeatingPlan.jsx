/**
 * Seating plan.
 *
 * A top-down plan of the room used as the character picker, so choosing who you
 * control is the same gesture as pointing at a seat. Every dot is placed from the
 * real coordinates in SPAWN_POINTS — the same numbers the 3D scene uses — so if a
 * spawn point moves, this moves with it and can never drift out of agreement with
 * the room.
 *
 * Projection: the bench is at the left (world -X), so the horizontal axis is world
 * x and the vertical axis is world z, +Z at the top. Judge, Prosecutor and
 * Defendant are drawn large; the rest are still selectable, just quieter.
 *
 * Label side is per-seat and deliberate. Four pairs share a row in this room —
 * judge/clerk and police/defendant sit at the same z — so their names would
 * collide if every label hung below its dot. The ones marked `above` are lifted
 * to clear their neighbour.
 */
import { SPAWN_POINTS } from '../config/courtroomLayout'
import { CHARACTER_REGISTRY, ROLE_ORDER, PRIMARY_ROLES } from '../config/characterRegistry'

/** Metres of clear plan around the outermost seat. */
const MARGIN_X = 1.3
const MARGIN_Z = 1.4

/** Seats whose label is lifted above the dot to clear a same-row neighbour. */
const LABEL_ABOVE = new Set(['judge', 'police', 'defense'])

const SEATS = (() => {
  const rows = ROLE_ORDER.map((role) => {
    const entry = CHARACTER_REGISTRY[role]
    const spawn = SPAWN_POINTS[entry.spawn]
    return { role, label: entry.label, x: spawn.position[0], z: spawn.position[2] }
  })

  const x0 = Math.min(...rows.map((r) => r.x)) - MARGIN_X
  const x1 = Math.max(...rows.map((r) => r.x)) + MARGIN_X
  const zTop = Math.max(...rows.map((r) => r.z)) + MARGIN_Z
  const zBottom = Math.min(...rows.map((r) => r.z)) - MARGIN_Z

  return rows.map((r) => ({
    ...r,
    left: ((r.x - x0) / (x1 - x0)) * 100,
    top: ((zTop - r.z) / (zTop - zBottom)) * 100,
    primary: PRIMARY_ROLES.includes(r.role),
    above: LABEL_ABOVE.has(r.role),
  }))
})()

export default function SeatingPlan({ selected, onSelect, statusFor }) {
  return (
    <div className="plan" role="group" aria-label="Courtroom seating plan">
      <div className="plan-bench" aria-hidden="true">
        <span>BENCH</span>
      </div>
      <div className="plan-field">
        {SEATS.map((seat) => {
          const status = statusFor?.(seat.role) || 'pending'
          const on = seat.role === selected
          const cls = [
            'plan-seat',
            seat.primary ? 'primary' : '',
            seat.above ? 'above' : '',
            on ? 'on' : '',
            status === 'missing' ? 'missing' : '',
          ]
            .filter(Boolean)
            .join(' ')
          return (
            <button
              key={seat.role}
              type="button"
              className={cls}
              style={{ left: `${seat.left}%`, top: `${seat.top}%` }}
              onClick={() => onSelect(seat.role)}
              aria-pressed={on}
              title={`${seat.label} — x ${seat.x.toFixed(2)}, z ${seat.z.toFixed(2)}`}
            >
              <span className="plan-dot" />
              <span className="plan-name">{seat.label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
