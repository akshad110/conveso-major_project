import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { getPreset, CAMERA_TRANSITION } from '../config/cameraPresets'
import { ROOM_BOUNDS } from '../config/courtroomLayout'
import { useCourtStore } from '../state/useCourtStore'

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

/**
 * Drives the default camera between named presets with an eased move, and hands
 * control to OrbitControls in free mode for debugging placement.
 */
export default function CameraRig() {
  const camera = useThree((s) => s.camera)
  const preset = useCourtStore((s) => s.camera)
  const mode = useCourtStore((s) => s.cameraMode)

  const target = useRef(new THREE.Vector3())
  const desiredPos = useRef(new THREE.Vector3())
  const desiredTarget = useRef(new THREE.Vector3())
  const desiredFov = useRef(camera.fov)
  const firstMove = useRef(true)

  const initial = useMemo(() => getPreset(preset), [])

  // Snap to the opening preset once, so frame one is already framed correctly.
  useEffect(() => {
    const p = initial
    camera.position.set(...p.position)
    target.current.set(...p.target)
    camera.fov = p.fov
    camera.updateProjectionMatrix()
    camera.lookAt(target.current)
  }, [camera, initial])

  useEffect(() => {
    const p = getPreset(preset)
    desiredPos.current.set(...p.position)
    desiredTarget.current.set(...p.target)
    desiredFov.current = p.fov
  }, [preset])

  useFrame((_, delta) => {
    if (mode === 'free') return

    const k = CAMERA_TRANSITION <= 0 || firstMove.current
      ? 1
      : 1 - Math.exp(-delta / (CAMERA_TRANSITION / 3))
    firstMove.current = false

    camera.position.lerp(desiredPos.current, k)
    target.current.lerp(desiredTarget.current, k)

    camera.position.set(
      clamp(camera.position.x, ROOM_BOUNDS.min[0], ROOM_BOUNDS.max[0]),
      clamp(camera.position.y, 0.3, ROOM_BOUNDS.max[1]),
      clamp(camera.position.z, ROOM_BOUNDS.min[2], ROOM_BOUNDS.max[2]),
    )

    if (Math.abs(camera.fov - desiredFov.current) > 0.01) {
      camera.fov += (desiredFov.current - camera.fov) * k
      camera.updateProjectionMatrix()
    }
    camera.lookAt(target.current)
  })

  if (mode === 'free') {
    return <OrbitControls makeDefault target={target.current} maxPolarAngle={Math.PI / 2.02} />
  }
  return null
}
