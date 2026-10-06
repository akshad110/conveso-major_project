import { useEffect } from 'react'
import { useGLTF } from '@react-three/drei'
import { COURTROOM_MODEL } from '../config/courtroomLayout'
import { useCourtStore } from '../state/useCourtStore'

/**
 * The courtroom environment, loaded exactly as authored. No transform, no scale,
 * no geometry edits, no material edits — the characters are fitted to the room,
 * never the reverse.
 */
export default function Courtroom() {
  const { scene } = useGLTF(COURTROOM_MODEL)

  useEffect(() => {
    scene.traverse((o) => {
      if (o.isMesh) {
        // The room receives shadows but does not cast them. This is an interior:
        // when the ceiling and walls cast, they occlude the exterior key light
        // before it reaches anything, leaving the whole room lit by ambient only
        // — flat, dark, and nothing like the authored materials. Characters still
        // cast onto the floor and furniture, so figures stay grounded.
        o.castShadow = false
        o.receiveShadow = true
      }
    })
    useCourtStore.getState().setCourtroomLoaded(true)
  }, [scene])

  return <primitive object={scene} />
}

useGLTF.preload(COURTROOM_MODEL)
