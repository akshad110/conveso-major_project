import { useCourtStore } from '../state/useCourtStore'
import { CHARACTER_REGISTRY } from '../config/characterRegistry'

/** Court state pill plus the current speaker's line. */
export default function DialogueBar() {
  const dialogue = useCourtStore((s) => s.dialogue)
  const courtState = useCourtStore((s) => s.courtState)
  const label = dialogue.speaker ? CHARACTER_REGISTRY[dialogue.speaker]?.label : null

  return (
    <div className="hud">
      <div className="hud-state">{courtState.replace(/_/g, ' ')}</div>
      {dialogue.text ? (
        // data-seat is what lets the suite's palette reach this bar: the pack
        // maps each of the seven seats to one accent, and the registry's ids
        // are those seven names. It sets --seat, which the left-hand mark and
        // the speaker's name below draw in. Omitted when nobody is named, so
        // both fall back to a plain hairline rather than guessing a colour.
        <div
          className={`hud-line ${dialogue.paused ? 'paused' : ''}`}
          data-seat={dialogue.speaker || undefined}
        >
          {label ? <span className="hud-speaker">{label}</span> : null}
          <span className="hud-text">{dialogue.text}</span>
        </div>
      ) : null}
    </div>
  )
}
