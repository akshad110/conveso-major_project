/**
 * The two cutscenes: how the case is put to the player, and how it is put away.
 *
 * Every panel is a real frame of the exhibit the court is going to argue about —
 * the Camera 02 recording, pushed to high contrast — so the pictures here and the
 * footage on the courtroom monitor are the same footage. That is the point. The
 * player watches the opening, then sits down in a room where the same six minutes
 * are the whole case.
 *
 * It reads nothing from the store and sends nothing to the engine. A cutscene is
 * not a courtroom event; it is the frame around one.
 */
import { useState, useEffect, useRef, useCallback } from 'react'

/**
 * Panels, in order. `img` is a still cut from the exhibit video, `pan` is a slow
 * drift across it expressed as a fraction of the frame — small numbers, because
 * this is a still photograph being looked at, not a camera move.
 */
const CUTSCENES = {
  opening: [
    {
      img: '/video/frame_0.jpg',
      caption: 'Nightingale Road, the eleventh of September. Thorne’s Timepieces keeps its light on until one in the morning.',
      pan: { start: [0, 0], end: [0.1, 0.05] },
    },
    {
      img: '/video/frame_1.jpg',
      caption: '23:51. A man comes up the road from the east and goes in. The camera never gets his face.',
      pan: { start: [-0.05, 0], end: [0.02, 0.02] },
    },
    {
      img: '/video/frame_2.jpg',
      caption: '23:52. Camera 02 fails. For six minutes the street has no witness — and everything the State must prove happens inside them.',
      pan: { start: [0, 0], end: [0, 0.08] },
    },
  ],
  closing: [
    {
      img: '/video/frame_3.jpg',
      caption: '23:58. The picture comes back. The door stands open, the lights are off, and Julian Thorne will not get up from his bench again.',
      pan: { start: [0, 0], end: [0.06, 0.04] },
    },
    {
      img: '/video/frame_4.jpg',
      caption: '23:58:56. Someone walks out and turns west. Heavier than the man who went in, the technical officer said. West — not east.',
      pan: { start: [0.04, 0], end: [-0.04, 0] },
    },
    {
      img: '/video/frame_5.jpg',
      caption: 'The record closes on what the camera could prove, and what it could not. Six minutes of nothing is still six minutes of nothing.',
      pan: { start: [0, 0], end: [0, 0.05] },
    },
  ],
}

const TYPE_MS = 40
const PAN_MS = 4000
const HOLD_MS = 1000

/** Someone who has asked for less motion gets the panels without the drift. */
function prefersReducedMotion() {
  return typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

export default function Cutscene({ type, onComplete }) {
  const [index, setIndex] = useState(0)
  const [text, setText] = useState('')
  const [pan, setPan] = useState([0, 0])

  // Held so the panel can be torn down mid-flight — on skip, or when the player
  // closes the tab. Without this the pan keeps ticking against a component that
  // is no longer on screen.
  const frameRef = useRef(0)
  const holdRef = useRef(0)

  const panels = CUTSCENES[type] || []
  const panel = panels[index]

  const advance = useCallback(() => {
    cancelAnimationFrame(frameRef.current)
    clearTimeout(holdRef.current)
    if (index < panels.length - 1) setIndex(index + 1)
    else onComplete?.()
  }, [index, panels.length, onComplete])

  // Type the caption out, then drift across the picture, then hold, then move on.
  useEffect(() => {
    if (!panel) return undefined
    setText('')
    setPan(panel.pan.start)

    let typed = 0
    const typing = setInterval(() => {
      typed += 1
      setText(panel.caption.slice(0, typed))
      if (typed < panel.caption.length) return

      clearInterval(typing)
      if (prefersReducedMotion()) {
        holdRef.current = setTimeout(advance, PAN_MS)
        return
      }

      const [sx, sy] = panel.pan.start
      const [ex, ey] = panel.pan.end
      const began = performance.now()
      const tick = (now) => {
        const t = Math.min((now - began) / PAN_MS, 1)
        setPan([sx + (ex - sx) * t, sy + (ey - sy) * t])
        if (t < 1) frameRef.current = requestAnimationFrame(tick)
        else holdRef.current = setTimeout(advance, HOLD_MS)
      }
      frameRef.current = requestAnimationFrame(tick)
    }, TYPE_MS)

    return () => {
      clearInterval(typing)
      cancelAnimationFrame(frameRef.current)
      clearTimeout(holdRef.current)
    }
  }, [index, panel, advance])

  // The next picture is fetched while this one is being read, so the cut between
  // panels does not flash black.
  useEffect(() => {
    const next = panels[index + 1]
    if (!next) return
    const img = new Image()
    img.src = next.img
  }, [index, panels])

  // Skipping is a thing people do, and they should not have to find the button.
  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape' || event.key === ' ' || event.key === 'Enter') {
        event.preventDefault()
        advance()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [advance])

  if (!panel) return null

  return (
    <div className="cutscene">
      <div
        className="cutscene-bg"
        style={{
          backgroundImage: `url(${panel.img})`,
          backgroundSize: '110% 110%',
          backgroundPosition: `${50 + pan[0] * 100}% ${50 + pan[1] * 100}%`,
        }}
      >
        <div className="cutscene-overlay" />
        <div className="cutscene-panel">
          <p className="cutscene-text">
            {text}
            <span className="cursor">|</span>
          </p>
          <button className="cutscene-skip" onClick={advance}>SKIP</button>
        </div>
      </div>
    </div>
  )
}
