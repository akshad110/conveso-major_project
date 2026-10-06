import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { clipMeta, resolveAction, ROLE_IDLE, DERIVED_CLIPS } from '../config/animationMap'
import { WITNESS_STAND } from '../config/courtroomLayout'
import { advanceWalk } from './walkPath'
import { registerCharacter } from '../state/animationManager'
import { useCourtStore } from '../state/useCourtStore'

const DEFAULT_FADE = 0.35
const SUBCLIP_FPS = 30

/**
 * One court character: loads its merged GLB, parks it on a named spawn point,
 * owns its AnimationMixer, and exposes an imperative play() to the animation
 * manager.
 *
 * Conflict prevention works off a monotonically increasing play token. Anything
 * scheduled by an earlier play() (a queued posture transition, an auto-return to
 * idle) checks its token before running, so a newer request always wins instead
 * of two clips fighting for the skeleton.
 */
export default function CharacterController({
  role,
  model,
  position,
  rotationY,
  scale = 1,
  startPosture = 'standing',
  onReady,
  /**
   * Given only to characters that answer to a click — currently the clerk, who
   * keeps the record. Purely a way in: the handler decides what happens, and the
   * character's animation and camera are untouched by being clicked.
   */
  onPick,
  onHover,
}) {
  const group = useRef()
  const gltf = useGLTF(model)

  // Clone so the cached GLTF is never mutated and a second mount is safe.
  const scene = useMemo(() => {
    const clone = cloneSkinned(gltf.scene)
    clone.traverse((o) => {
      if (o.isMesh || o.isSkinnedMesh) {
        o.castShadow = true
        o.receiveShadow = true
        // Skinned bounds go stale once bones move; without this the character
        // pops out of view at some camera angles.
        o.frustumCulled = false
      }
    })
    return clone
  }, [gltf.scene])

  /**
   * Build the clip table straight off the loaded GLB — clip names are read, never
   * assumed — then add any derived subclips this role needs.
   */
  const rig = useMemo(() => {
    const mixer = new THREE.AnimationMixer(scene)
    const clips = new Map()

    for (const clip of gltf.animations || []) {
      if (clip && clip.name) clips.set(clip.name, clip)
    }

    const derived = DERIVED_CLIPS[role] || {}
    for (const [name, spec] of Object.entries(derived)) {
      // A derived clip is a stand-in for a clip the export does not have. If the
      // export does have it, the authored one wins — always. Without this guard a
      // richer GLB makes the character worse: the judge ships a real SIT_DOWN and
      // a real SIT_IDLE_LOOP, and both were being overwritten by slices cut out
      // of SIT_WRITE, so the bench sat down wrong and then idled head-down.
      if (clips.has(name)) continue
      const src = clips.get(spec.from)
      if (!src) continue
      const startFrame = Math.max(0, Math.round(spec.start * src.duration * SUBCLIP_FPS))
      const endFrame = Math.max(startFrame + 2, Math.round(spec.end * src.duration * SUBCLIP_FPS))
      try {
        const sub = THREE.AnimationUtils.subclip(src, name, startFrame, endFrame, SUBCLIP_FPS)
        if (sub.duration > 0.05 && sub.tracks.length) clips.set(name, sub)
      } catch (err) {
        console.warn(`[${role}] could not derive ${name} from ${spec.from}`, err)
      }
    }

    const actions = new Map()
    for (const [name, clip] of clips) actions.set(name, mixer.clipAction(clip))

    return { mixer, clips, actions, available: new Set(clips.keys()) }
  }, [scene, gltf.animations, role])

  // Imperative runtime state — intentionally outside React state.
  const rt = useRef({
    current: null, // THREE.AnimationAction
    currentClip: null,
    action: null, // logical action name
    posture: startPosture,
    token: 0,
    timer: null,
    /** An active walk: { legs, i, facing, clip, heading, onArrive }, or null. */
    walk: null,
    /** Scratch pose handed to the pure walker each frame. Never reallocated. */
    pose: { x: position[0], y: position[1], z: position[2], yaw: rotationY },
    /** Where this character belongs when nothing is asking it to be elsewhere. */
    home: { position: [...position], rotationY },
  })

  const api = useMemo(() => {
    const { mixer, clips, actions, available } = rig

    const report = (patch) => {
      useCourtStore.getState().setCharacterStatus(role, patch)
    }

    const idleActionName = (posture) =>
      (ROLE_IDLE[role] && ROLE_IDLE[role][posture]) || 'IDLE'

    const clear = () => {
      if (rt.current.timer) {
        clearTimeout(rt.current.timer)
        rt.current.timer = null
      }
    }

    const after = (clipName, token, fade, fn) => {
      const clip = clips.get(clipName)
      const wait = Math.max(0, (clip ? clip.duration : 0.5) * 1000 - fade * 1000 * 0.5)
      rt.current.timer = setTimeout(() => {
        if (rt.current.token !== token) return // superseded
        fn()
      }, wait)
    }

    const crossfade = (clipName, fade, loop, timeScale = 1) => {
      const next = actions.get(clipName)
      if (!next) return false
      const prev = rt.current.current

      next.reset()
      next.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1)
      next.clampWhenFinished = !loop
      next.enabled = true
      next.setEffectiveTimeScale(timeScale)
      next.setEffectiveWeight(1)
      next.play()

      if (prev && prev !== next && fade > 0) {
        prev.crossFadeTo(next, fade, false)
        // Park the outgoing action once it is inaudible, so it stops costing
        // anything, but only if it hasn't become current again meanwhile.
        setTimeout(() => {
          if (rt.current.current !== prev) prev.stop()
        }, fade * 1000 + 50)
      } else if (prev && prev !== next) {
        prev.stop()
      }

      rt.current.current = next
      rt.current.currentClip = clipName
      return true
    }

    /**
     * @param {string} action logical action, or '__IDLE__' for "come to rest"
     */
    const play = (action, options = {}) => {
      const fade = options.fade ?? DEFAULT_FADE
      const requested = action === '__IDLE__' ? idleActionName(rt.current.posture) : action
      const res = resolveAction(role, requested, available)

      if (!res.clip) {
        report({ action: requested, current: null, fallback: true, reason: res.reason })
        return res
      }

      const meta = clipMeta(res.clip)
      clear()
      const token = ++rt.current.token

      // Insert a posture transition when the target clip belongs to the other
      // posture, e.g. asked to SPEAK while seated -> STAND_UP, then SPEAK.
      if (!options.force && !meta.transition && meta.posture !== rt.current.posture) {
        const basePosture = rt.current.posture
        const bridge = meta.posture === 'standing' ? 'STAND_UP' : 'SIT_DOWN'
        if (available.has(bridge)) {
          const bridgeMeta = clipMeta(bridge)
          crossfade(bridge, fade, false, options.timeScale ?? 1)
          rt.current.posture = bridgeMeta.posture
          rt.current.action = requested
          report({
            action: requested,
            current: `${bridge} -> ${res.clip}`,
            posture: rt.current.posture,
            fallback: res.fallback,
            reason: res.fallback ? res.reason : `posture transition via ${bridge}`,
          })
          after(bridge, token, fade, () => {
            crossfade(res.clip, 0.25, meta.loop, options.timeScale ?? 1)
            report({ current: res.clip, reason: res.reason })
            if (!meta.loop && (options.autoReturn ?? meta.autoReturn)) {
              // A one-shot that needed a bridge also returns across it, so a
              // seated character that stood to gesture ends up seated again.
              after(res.clip, token, 0.25, () =>
                play(basePosture === 'seated' ? 'SIT' : 'STAND', { fade: 0.35 }),
              )
            }
            options.onFinish?.()
          })
          return res
        }
        // No bridging clip on this character — switch posture directly rather
        // than refusing to play.
        rt.current.posture = meta.posture
      } else {
        rt.current.posture = meta.posture
      }

      crossfade(res.clip, fade, meta.loop, options.timeScale ?? 1)
      rt.current.action = requested
      report({
        action: requested,
        current: res.clip,
        posture: rt.current.posture,
        fallback: res.fallback,
        reason: res.reason,
      })

      if (!meta.loop) {
        const wantsReturn = options.autoReturn ?? meta.autoReturn ?? meta.transition
        after(res.clip, token, fade, () => {
          if (wantsReturn) play('__IDLE__', { fade: 0.4 })
          options.onFinish?.()
        })
      }

      return res
    }

    const getState = () => ({
      role,
      clips: [...available],
      current: rt.current.currentClip,
      action: rt.current.action,
      posture: rt.current.posture,
      walking: Boolean(rt.current.walk),
    })

    /**
     * Walk this character through a list of floor positions and square up.
     *
     * The clip stays an in-place walk cycle and the object is moved by hand, so
     * nothing depends on root motion being authored into the export — which is
     * as well, since only one of the nine characters has a clip that travels.
     *
     * A character who is sitting will stand up first: play() inserts that
     * bridge itself, and the step below refuses to move anyone whose walk cycle
     * has not actually started, so no one slides out of a chair.
     *
     * @param {number[][]} waypoints floor positions, in order
     * @param {number|null} facing   yaw to settle on, or null to keep the heading
     */
    const walkTo = (waypoints, facing = null, options = {}) => {
      const g = group.current
      if (!g) return false
      const legs = (waypoints || []).filter((p) => Array.isArray(p) && p.length === 3)
      const target = typeof facing === 'number' ? facing : null
      const walk = {
        legs,
        i: 0,
        facing: target,
        clip: null,
        heading: g.rotation.y,
        speed: options.speed ?? WITNESS_STAND.speed,
        turnRate: options.turnRate ?? WITNESS_STAND.turnRate,
        onArrive: options.onArrive,
      }

      if (!legs.length) {
        // Nowhere to go. Still honour the facing, so "take the stand" from the
        // stand is a turn on the spot rather than a no-op.
        if (target === null) {
          rt.current.walk = null
          options.onArrive?.()
        } else {
          rt.current.walk = walk
        }
        return true
      }

      const res = play(options.action || 'WALK', { fade: 0.3 })
      walk.clip = res?.clip || null
      rt.current.walk = walk
      report({ walking: true })
      return true
    }

    /** Send this character back to the spawn the registry gave it. */
    const walkHome = (options = {}) =>
      walkTo([rt.current.home.position], rt.current.home.rotationY, options)

    /** Where this character is standing right now, in world space. */
    const where = () => {
      const g = group.current
      return g
        ? [g.position.x, g.position.y, g.position.z]
        : [...rt.current.home.position]
    }

    /** The spawn this character belongs to when nothing is moving it. */
    const home = () => ({
      position: [...rt.current.home.position],
      rotationY: rt.current.home.rotationY,
    })

    /** Advance an active walk. Called once per frame; a no-op when idle. */
    const step = (delta) => {
      const g = group.current
      const walk = rt.current.walk
      if (!g || !walk) return

      // Not moving until the walk cycle is the clip actually on the skeleton.
      // This is what stops a seated character sliding out of their chair while
      // the STAND_UP bridge play() inserted is still running.
      if (walk.clip && rt.current.currentClip !== walk.clip) return

      // Hand the pose to the pure walker and take it back. Reusing one object
      // keeps this allocation-free at 60 fps.
      const pose = rt.current.pose
      pose.x = g.position.x
      pose.y = g.position.y
      pose.z = g.position.z
      pose.yaw = g.rotation.y

      const done = advanceWalk(pose, walk, delta)

      g.position.set(pose.x, pose.y, pose.z)
      g.rotation.y = pose.yaw
      if (!done) return

      rt.current.walk = null
      report({ walking: false })
      play('__IDLE__', { fade: 0.4 })
      walk.onArrive?.()
    }

    const stop = () => {
      clear()
      rt.current.token++
      rt.current.walk = null
      mixer.stopAllAction()
      rt.current.current = null
      rt.current.currentClip = null
    }

    return { role, play, getState, stop, walkTo, walkHome, where, home, step, mixer, available }
  }, [rig, role, startPosture])

  /**
   * Position and facing are set on the object rather than passed as props.
   *
   * A walk moves the object, and R3F re-applies a `position` prop whenever the
   * scene re-renders — which would snap a character back to its spawn mid-stride.
   * The registry still decides where everyone starts and returns to; those
   * numbers simply arrive through here. A genuine change of spawn cancels any
   * walk in progress, which is the right answer: the character has been moved.
   */
  useLayoutEffect(() => {
    const g = group.current
    if (!g) return
    g.position.set(position[0], position[1], position[2])
    g.rotation.set(0, rotationY, 0)
    rt.current.walk = null
    rt.current.home = { position: [position[0], position[1], position[2]], rotationY }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position[0], position[1], position[2], rotationY])

  // Register with the manager and settle into the resting idle.
  useEffect(() => {
    const unregister = registerCharacter(role, api)
    useCourtStore.getState().setCharacterStatus(role, {
      status: 'ready',
      clips: [...api.available],
      posture: startPosture,
    })
    rt.current.posture = startPosture
    api.play('__IDLE__', { fade: 0, force: true })
    onReady?.(role, api)
    return () => {
      unregister()
      api.stop()
    }
  }, [api, role, startPosture, onReady])

  useEffect(() => () => rig.mixer.uncacheRoot(scene), [rig, scene])

  useFrame((_, delta) => {
    rig.mixer.update(delta)
    api.step(delta)
  })

  const interactive = typeof onPick === 'function'

  return (
    <group
      ref={group}
      scale={scale}
      name={`character_${role}`}
      onClick={interactive ? (ev) => { ev.stopPropagation(); onPick(role) } : undefined}
      onPointerOver={interactive ? (ev) => { ev.stopPropagation(); onHover?.(role, true) } : undefined}
      onPointerOut={interactive ? () => onHover?.(role, false) : undefined}
    >
      <primitive object={scene} />
    </group>
  )
}
