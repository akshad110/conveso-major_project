/**
 * Colour pipeline and environment.
 *
 * The GLB materials are never touched — this is about not distorting them on the
 * way to the screen. Three things were pulling the render away from how the
 * assets look in their original preview:
 *
 * 1. React Three Fiber applies ACES Filmic tone mapping by default. ACES is a
 *    film look: it desaturates saturated colour and rolls highlights toward
 *    white, so a rosewood bench turns muddy brown and a saffron flag turns
 *    peach. We switch to Khronos PBR Neutral (THREE.NeutralToneMapping, three
 *    r166+), which exists precisely so the rendered colour tracks the material's
 *    base colour while still protecting highlights from clipping. If the three
 *    build is older than r166 we fall back to no tone mapping, which is less
 *    forgiving in the highlights but still colour-accurate.
 *
 * 2. There was no environment map. Every glTF preview tool lights the model with
 *    a neutral studio HDRI, so metal, varnish and eyes have something to
 *    reflect. With none, PBR metals resolve to near black and everything reads
 *    flat and dead. We generate the environment procedurally — no network fetch,
 *    which matters because this app has to run offline.
 *
 * 3. Lights were tinted. See CourtroomScene — the hemisphere light was mixing a
 *    blue sky with a brown ground, which is a hue shift applied to every surface
 *    in the room.
 *
 * Everything here degrades rather than throws: if the environment cannot be
 * built the scene still renders, just without reflections.
 */
import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'

/**
 * How much of the room's light comes from the environment rather than the lamps.
 *
 * The studio environment is bright by design and its overhead soft box points
 * straight down, so the floor sees more of it than the walls do. At 1.0 it both
 * flattens the courtroom's own shadows and pushes the pale floor toward clipping,
 * so it is dialled back to sit under the directional key light. This is the one
 * dial to reach for if the room ever looks too bright or too dark overall.
 */
const ENV_INTENSITY = 0.45

/**
 * A neutral studio, built by hand.
 *
 * This is the fallback for three's own RoomEnvironment, whose constructor has
 * taken a renderer argument in some versions and none in others. It is cruder
 * than the real thing — a soft box overhead, two side bounces, a darker floor —
 * but it is the same idea, and every surface is a pure grey on purpose: a tinted
 * environment would reintroduce exactly the hue shift this file exists to remove.
 */
function studioScene() {
  const scene = new THREE.Scene()
  const flat = (color, side = THREE.FrontSide) =>
    new THREE.MeshBasicMaterial({ color, side })

  const shell = new THREE.Mesh(new THREE.BoxGeometry(20, 12, 20), flat(0x6b6b6b, THREE.BackSide))
  scene.add(shell)

  const panel = (color, w, h, position, rotation) => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), flat(color, THREE.DoubleSide))
    mesh.position.fromArray(position)
    mesh.rotation.fromArray(rotation)
    scene.add(mesh)
  }

  panel(0xffffff, 14, 14, [0, 5.9, 0], [Math.PI / 2, 0, 0]) // soft box overhead
  panel(0x8f8f8f, 12, 8, [-9.9, 2, 0], [0, Math.PI / 2, 0]) // bounce, house left
  panel(0x8f8f8f, 12, 8, [9.9, 2, 0], [0, -Math.PI / 2, 0]) // bounce, house right
  panel(0x4a4a4a, 20, 20, [0, -5.9, 0], [-Math.PI / 2, 0, 0]) // floor, darker

  return scene
}

/** The environment scene is rendered once by PMREM, then it is dead weight. */
function disposeScene(scene) {
  scene.traverse((o) => {
    o.geometry?.dispose()
    if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose())
    else o.material?.dispose()
  })
}

export default function RenderEnvironment() {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)

  // Tone mapping and output colour space. Also set on the Canvas gl prop —
  // stated twice deliberately, because R3F's ACES default is what we are undoing.
  useEffect(() => {
    gl.toneMapping = THREE.NeutralToneMapping ?? THREE.NoToneMapping
    gl.toneMappingExposure = 1
    gl.outputColorSpace = THREE.SRGBColorSpace
  }, [gl])

  // Neutral studio environment, generated rather than downloaded.
  useEffect(() => {
    let pmrem
    let target
    let cancelled = false

    const build = async () => {
      try {
        const mod = await import('three/examples/jsm/environments/RoomEnvironment.js')
        // The renderer argument is required by some three versions and ignored
        // by others, so passing it is the form that works in both.
        return new mod.RoomEnvironment(gl)
      } catch (err) {
        console.warn('[courtroom] RoomEnvironment unavailable; using inline studio', err)
        return studioScene()
      }
    }

    build()
      .then((envScene) => {
        if (cancelled) {
          disposeScene(envScene)
          return
        }
        pmrem = new THREE.PMREMGenerator(gl)
        target = pmrem.fromScene(envScene, 0.04)
        disposeScene(envScene)
        scene.environment = target.texture
        if ('environmentIntensity' in scene) scene.environmentIntensity = ENV_INTENSITY
      })
      .catch((err) => {
        // Non-fatal: the room just loses its reflections.
        console.warn('[courtroom] no environment map; PBR reflections disabled', err)
      })

    return () => {
      cancelled = true
      scene.environment = null
      target?.dispose()
      pmrem?.dispose()
    }
  }, [gl, scene])

  return null
}
