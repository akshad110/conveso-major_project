import { Suspense, useCallback } from 'react'
import { Canvas } from '@react-three/fiber'
import * as THREE from 'three'
import Courtroom from './Courtroom'
import CharacterController from './CharacterController'
import CameraRig from './CameraRig'
import EvidenceMonitor from './EvidenceMonitor'
import RenderEnvironment from './RenderEnvironment'
import { captureScene } from './dispose'
import { activeRoles, characterPlacement } from '../config/characterRegistry'
import { DEFAULT_CAMERA, getPreset } from '../config/cameraPresets'
import { useCourtStore } from '../state/useCourtStore'

/**
 * Courtroom lighting.
 *
 * This is an interior lit by its own ceiling, not by the sun. The room measures
 * 16 x 11 m with the ceiling at Y 6.0, and the ceiling carries a modelled light
 * panel 15.1 x 9.7 m at Y 6.01 whose material is emissive at strength 20. So the
 * room already declares where its light comes from; these lamps only have to
 * agree with it.
 *
 * The GLB used to ship its own `Sun` — a KHR_lights_punctual directional at
 * intensity 1366 with colour [1.34, 0.94, 0.61]. drei honours that extension, so
 * it was being added on top of everything below: an over-unity, warm-tinted light
 * that clipped the floor and walls to white and skewed every hue warm. The
 * courtroom model no longer contains it. If a future re-export brings it back,
 * that is the first thing to look for.
 *
 * Every light here is white or near-white on purpose. A tinted light is a hue
 * shift applied to every material in the room, which is the fastest way to make
 * authored assets look wrong.
 *
 * Intensities are deliberately modest: most of the illumination comes from the
 * neutral environment in RenderEnvironment, and these only add direction and
 * shadow on top of it.
 */
function Lighting() {
  return (
    <>
      {/* Just enough to keep the deepest corners from crushing to black. */}
      <ambientLight intensity={0.22} />

      {/*
        Key light: the ceiling panel, so it sits just under the 6.0 m ceiling
        rather than outside the building — the old rig had this at Y 6.5, above
        the roof. Aimed down and slightly across so the wood keeps some modelling
        instead of going flat. The only shadow caster; its frustum covers the
        whole 16 x 11 m floor with a little margin.
      */}
      <directionalLight
        position={[3, 5.6, 2.5]}
        intensity={0.85}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-11}
        shadow-camera-right={11}
        shadow-camera-top={9}
        shadow-camera-bottom={-9}
        shadow-camera-near={0.5}
        shadow-camera-far={20}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
      />

      {/* Fill from the opposite corner so the far wall is not a silhouette. */}
      <directionalLight position={[-5, 4.4, -3]} intensity={0.22} />

      {/* Practical over the bench, to give the judge his own modelling. Barely
          warm — 0xfff4e6, not orange — and short-range so it stays a highlight
          on the bench rather than lighting the room. */}
      <pointLight position={[-6.4, 3.4, 0]} color="#fff4e6" intensity={4.5} distance={7} decay={2} />
    </>
  )
}

export default function CourtroomScene() {
  const opening = getPreset(DEFAULT_CAMERA)

  /**
   * The clerk keeps the record, so the clerk is the way to it. A click opens the
   * transcript panel and does nothing else: no camera move, no animation, no
   * message to the engine. The rest of the room is not clickable.
   */
  const pickClerk = useCallback(() => {
    useCourtStore.getState().toggleTranscript()
    useCourtStore.getState().setClerkHover(false)
  }, [])

  const hoverClerk = useCallback((_role, over) => {
    useCourtStore.getState().setClerkHover(over)
    document.body.style.cursor = over ? 'pointer' : ''
  }, [])

  return (
    <Canvas
      shadows
      dpr={[1, 1.75]}
      gl={{
        antialias: true,
        powerPreference: 'high-performance',
        // Set here and again in RenderEnvironment: R3F would otherwise apply its
        // ACES Filmic default, which is what was shifting the asset colours.
        toneMapping: THREE.NeutralToneMapping ?? THREE.NoToneMapping,
        outputColorSpace: THREE.SRGBColorSpace,
      }}
      camera={{ position: opening.position, fov: opening.fov, near: 0.1, far: 200 }}
      /*
       * The only place the scene is handed out. `dispose.js` needs it to give
       * the GPU its memory back when the hearing ends, and this is the one
       * moment R3F offers it. Nothing else reads it: it is a live three.js
       * object and keeping it in the store would put it one careless
       * subscription away from being touched mid-render.
       */
      onCreated={({ scene }) => captureScene(scene)}
    >
      {/* Warm near-black, to match the room's own panelling rather than fight it. */}
      <color attach="background" args={['#0e0a08']} />
      <RenderEnvironment />
      <Lighting />
      <CameraRig />

      <Suspense fallback={null}>
        <Courtroom />
      </Suspense>

      {activeRoles().map((role) => {
        const p = characterPlacement(role)
        return (
          <Suspense key={role} fallback={null}>
            <CharacterController
              role={role}
              model={p.model}
              position={p.position}
              rotationY={p.rotationY}
              scale={p.scale}
              startPosture={p.startPosture}
              onPick={role === 'clerk' ? pickClerk : undefined}
              onHover={role === 'clerk' ? hoverClerk : undefined}
            />
          </Suspense>
        )
      })}

      <EvidenceMonitor />
    </Canvas>
  )
}
