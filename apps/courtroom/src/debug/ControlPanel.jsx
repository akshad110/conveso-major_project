/**
 * Controls panel.
 *
 * Collapsed by default to a single button, and never more than a corner of the
 * screen when open — the room is the point, not the instrumentation.
 *
 * One character is under manual control at a time. The panel says who in its
 * header and every action button below applies to that character only, which is
 * also exactly what the keyboard does: 1-7 pick the seat, letters drive it.
 */
import { Fragment } from 'react'
import { useCourtStore } from '../state/useCourtStore'
import { playAnimation } from '../state/animationManager'
import { actionsForRole } from '../config/animationMap'
import { CAMERA_PRESETS, cameraForRole } from '../config/cameraPresets'
import { ROLE_ORDER, CHARACTER_REGISTRY } from '../config/characterRegistry'
import { KEY_ACTIONS, KEY_HELP } from './useDebugControls'
import SeatingPlan from '../ui/SeatingPlan'

/** Reverse of KEY_ACTIONS, so a button can show the key that does the same thing. */
const KEY_FOR_ACTION = Object.entries(KEY_ACTIONS).reduce((acc, [key, action]) => {
  acc[action] = key.toUpperCase()
  return acc
}, {})

/** REACT is what the N key sends for anyone who has no NERVOUS clip. */
const keyForAction = (action) => KEY_FOR_ACTION[action] || (action === 'REACT' ? 'N' : null)

const title = (s) => s.replace(/_/g, ' ').toLowerCase()

export default function ControlPanel({ onClose }) {
  const selectedRole = useCourtStore((s) => s.selectedRole)
  const selectRole = useCourtStore((s) => s.selectRole)
  const characters = useCourtStore((s) => s.characters)
  const camera = useCourtStore((s) => s.camera)
  const cameraMode = useCourtStore((s) => s.cameraMode)
  const setCamera = useCourtStore((s) => s.setCamera)
  const toggleCameraMode = useCourtStore((s) => s.toggleCameraMode)
  const lastEvent = useCourtStore((s) => s.lastEvent)

  const me = characters[selectedRole] || {}
  const actions = actionsForRole(selectedRole)
  const clips = me.clips || []
  // The export caveat lives in the registry, not in per-frame store state.
  const note = CHARACTER_REGISTRY[selectedRole]?.note

  return (
    <aside className="cp grain" aria-label="Controls">
      <header className="cp-head">
        <div>
          <span className="cp-eyebrow">Controlling</span>
          <div className="cp-who">
            <span className="cp-name">{me.label || '—'}</span>
            <span className={`cp-state ${me.status || 'pending'}`}>
              {me.status === 'ready' ? `${clips.length} clips` : me.status || 'pending'}
            </span>
          </div>
        </div>
        <button className="cp-close" onClick={onClose} title="Hide controls (H)" aria-label="Hide controls">
          ×
        </button>
      </header>

      <div className="cp-scroll">
        <section className="cp-sec">
          <h2 className="cp-label">
            Who you control <em>tap a seat · keys 1–{ROLE_ORDER.length}</em>
          </h2>
          <div className="pick">
            <SeatingPlan
              selected={selectedRole}
              onSelect={selectRole}
              statusFor={(role) => characters[role]?.status}
            />
            <div className="read">
              <div className="read-row">
                <span className="read-k">Playing</span>
                <span className="read-v">
                  {me.current || <span className="sub">nothing yet</span>}
                </span>
                {me.fallback ? (
                  <span className="read-fb" title={me.reason || 'no exact clip in this export'}>
                    fallback
                  </span>
                ) : null}
              </div>
              <div className="read-row">
                <span className="read-k">Asked for</span>
                <span className="read-v">
                  {me.action || <span className="sub">—</span>}
                </span>
              </div>
              <div className="read-row">
                <span className="read-k">Posture</span>
                <span className="read-v">{me.posture || '—'}</span>
              </div>
              <div className="read-row">
                <span className="read-k">Last event</span>
                <span className="read-v">
                  {lastEvent?.event || lastEvent?.type || <span className="sub">none</span>}
                </span>
              </div>
            </div>
          </div>
        </section>

        <section className="cp-sec">
          <h2 className="cp-label">
            {me.label || 'Character'} actions <em>{selectedRole}</em>
          </h2>
          <div className="acts">
            {actions.map((action) => {
              const key = keyForAction(action)
              return (
                <button
                  key={action}
                  className="act"
                  onClick={() => playAnimation(selectedRole, action)}
                  title={`Play ${title(action)} on the ${me.label}`}
                >
                  {title(action)}
                  {key ? <span className="act-key">{key}</span> : null}
                </button>
              )
            })}
          </div>
        </section>

        <section className="cp-sec">
          <h2 className="cp-label">Camera</h2>
          <div className="cp-grid">
            <label className="field">
              <span>Shot</span>
              <select className="sel" value={camera} onChange={(e) => setCamera(e.target.value)}>
                {Object.keys(CAMERA_PRESETS).map((name) => (
                  <option key={name} value={name}>
                    {title(name.replace(/^CAMERA_/, ''))}
                  </option>
                ))}
              </select>
            </label>
            <div className="field">
              <span>View</span>
              <button
                className={`toggle ${cameraMode === 'free' ? 'on' : ''}`}
                onClick={toggleCameraMode}
                title="Toggle free orbit (F)"
              >
                {cameraMode === 'free' ? 'Free orbit' : 'Fixed shots'}
              </button>
            </div>
          </div>
          <div className="cp-grid" style={{ marginTop: 8 }}>
            <button className="toggle" onClick={() => setCamera(cameraForRole(selectedRole))}>
              Cut to {me.label || 'selection'}
            </button>
            <button className="toggle" onClick={() => setCamera('CAMERA_WIDE')}>
              Wide shot
            </button>
          </div>
        </section>

        <details className="disc">
          <summary>Clips on this character</summary>
          <div className="disc-body">
            {clips.length ? (
              <>
                <div className="acts">
                  {clips.map((clip) => (
                    <button
                      key={clip}
                      className="act raw"
                      onClick={() => playAnimation(selectedRole, clip)}
                      title={`Play the raw ${clip} clip`}
                    >
                      {clip}
                    </button>
                  ))}
                </div>
                <p className="note" style={{ marginTop: 9 }}>
                  Read off the loaded GLB, not a hard-coded list. Clicking one plays it raw,
                  bypassing the action mapping.
                </p>
              </>
            ) : (
              <p className="note">
                Still loading <code>{selectedRole}.glb</code>.
              </p>
            )}
          </div>
        </details>

        <details className="disc">
          <summary>Keyboard</summary>
          <div className="disc-body">
            <dl className="keys">
              {KEY_HELP.map(([key, what]) => (
                <Fragment key={key}>
                  <dt>{key}</dt>
                  <dd>{what}</dd>
                </Fragment>
              ))}
            </dl>
          </div>
        </details>

        {note ? (
          <details className="disc">
            <summary>About this export</summary>
            <div className="disc-body">
              <p className="note">{note}</p>
            </div>
          </details>
        ) : null}
      </div>
    </aside>
  )
}
