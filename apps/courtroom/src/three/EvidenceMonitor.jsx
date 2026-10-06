import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { EVIDENCE_MONITOR } from '../config/courtroomLayout'
import { getExhibit } from '../config/exhibits'
import { useCourtStore } from '../state/useCourtStore'

const TEX_W = 1024
const TEX_H = Math.round((TEX_W * EVIDENCE_MONITOR.height) / EVIDENCE_MONITOR.width)

/** The monitor is mounted facing into the room; some rooms need it flipped. */
function orient(texture) {
  texture.colorSpace = THREE.SRGBColorSpace
  if (EVIDENCE_MONITOR.mirrorU) {
    texture.wrapS = THREE.RepeatWrapping
    texture.repeat.x = -1
    texture.offset.x = 1
  }
  return texture
}

function wrap(ctx, text, maxWidth) {
  const words = String(text || '').split(/\s+/)
  const lines = []
  let line = ''
  for (const w of words) {
    const test = line ? `${line} ${w}` : w
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line)
      line = w
    } else {
      line = test
    }
  }
  if (line) lines.push(line)
  return lines
}

export default function EvidenceMonitor() {
  const evidence = useCourtStore((s) => s.evidence)
  const materialRef = useRef()
  /**
   * Which source the screen is showing. Held as state rather than assigned onto
   * the material, so the map is a prop like everything else in the scene and
   * React owns the swap.
   */
  const [playing, setPlaying] = useState(null)

  const { canvas, texture } = useMemo(() => {
    const c = document.createElement('canvas')
    c.width = TEX_W
    c.height = TEX_H
    return { canvas: c, texture: orient(new THREE.CanvasTexture(c)) }
  }, [])

  /**
   * One video element and one texture for the life of the component.
   *
   * The previous version built a fresh VideoTexture every time the effect ran,
   * which leaked a GPU texture per exhibit change and left the old ones
   * uploading frames nobody was looking at.
   */
  const { video, videoTexture } = useMemo(() => {
    const v = document.createElement('video')
    v.crossOrigin = 'anonymous'
    v.loop = true
    v.muted = true            // required for autoplay, and the exhibit is silent
    v.playsInline = true
    v.preload = 'auto'
    return { video: v, videoTexture: orient(new THREE.VideoTexture(v)) }
  }, [])

  useEffect(() => () => {
    video.pause()
    video.removeAttribute('src')
    videoTexture.dispose()
    texture.dispose()
  }, [video, videoTexture, texture])

  // Footage plays only while a video exhibit is actually up on the screen.
  useEffect(() => {
    const ex = evidence.visible ? getExhibit(evidence.id) : null
    const src = ex?.type === 'video' ? ex.video : null

    if (!src) {
      video.pause()
      setPlaying(null)
      return
    }

    if (video.getAttribute('src') !== src) {
      video.setAttribute('src', src)
      video.load()
    }
    setPlaying(src)
    // A browser that refuses to autoplay leaves the last frame on screen, which
    // is a still of the exhibit — wrong, but not broken.
    video.play().catch(() => {})
  }, [evidence.id, evidence.visible, video])

  useEffect(() => {
    // Footage is on the screen; there is no card to draw behind it.
    if (playing) return
    const ctx = canvas.getContext('2d')
    const pad = 46

    if (!evidence.visible) {
      ctx.fillStyle = '#080b12'
      ctx.fillRect(0, 0, TEX_W, TEX_H)
      ctx.strokeStyle = '#1b2436'
      ctx.lineWidth = 4
      ctx.strokeRect(pad / 2, pad / 2, TEX_W - pad, TEX_H - pad)
      ctx.fillStyle = '#26324a'
      ctx.font = '600 34px Georgia, serif'
      ctx.textAlign = 'center'
      ctx.fillText('COURT DISPLAY', TEX_W / 2, TEX_H / 2 + 12)
      ctx.textAlign = 'left'
      texture.needsUpdate = true
      return
    }

    const ex = getExhibit(evidence.id)
    if (!ex) return
    const exhibit = evidence.exhibit || ex.exhibit
    const title = evidence.title || ex.title
    const body = evidence.body || ex.body

    const g = ctx.createLinearGradient(0, 0, 0, TEX_H)
    g.addColorStop(0, '#12203a')
    g.addColorStop(1, '#0a1120')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, TEX_W, TEX_H)

    ctx.strokeStyle = '#c8a45a'
    ctx.lineWidth = 5
    ctx.strokeRect(pad / 2, pad / 2, TEX_W - pad, TEX_H - pad)

    ctx.fillStyle = '#c8a45a'
    ctx.font = '700 30px "Helvetica Neue", Arial, sans-serif'
    ctx.fillText(String(exhibit).toUpperCase(), pad, pad + 46)

    ctx.fillStyle = '#f2f5fb'
    ctx.font = '600 52px Georgia, serif'
    for (const [i, line] of wrap(ctx, title, TEX_W - pad * 2).slice(0, 2).entries()) {
      ctx.fillText(line, pad, pad + 118 + i * 58)
    }

    ctx.fillStyle = '#9fb0cc'
    ctx.font = '300 32px "Helvetica Neue", Arial, sans-serif'
    const lines = wrap(ctx, body, TEX_W - pad * 2).slice(0, 5)
    for (const [i, line] of lines.entries()) {
      ctx.fillText(line, pad, pad + 250 + i * 44)
    }

    texture.needsUpdate = true
  }, [canvas, texture, evidence, playing])

  useEffect(() => {
    if (materialRef.current) materialRef.current.needsUpdate = true
  }, [evidence.visible, playing])

  const position = useMemo(() => {
    const [x, y, z] = EVIDENCE_MONITOR.center
    return [x + 0.012, y, z]
  }, [])

  return (
    <mesh
      name="evidence_monitor"
      position={position}
      rotation={[0, EVIDENCE_MONITOR.rotationY, 0]}
    >
      <planeGeometry args={[EVIDENCE_MONITOR.width, EVIDENCE_MONITOR.height]} />
      <meshBasicMaterial
        ref={materialRef}
        map={playing ? videoTexture : texture}
        toneMapped={false}
        side={THREE.FrontSide}
      />
    </mesh>
  )
}
