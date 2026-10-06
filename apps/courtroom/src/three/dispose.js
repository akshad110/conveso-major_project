/**
 * Giving the room back.
 *
 * Three.js allocates on the GPU, and the GPU is not garbage collected. A
 * geometry, a material and a texture each hold a driver-side buffer that lives
 * until something calls `dispose()` on it; dropping the last JavaScript
 * reference does not call it. On top of that, drei's `useGLTF` keeps every model
 * it has ever parsed in a module-level cache so that a second mount is instant —
 * the right default, and also the reason this app's 105 MB room and its cast
 * stay resident for as long as the document does.
 *
 * Two things here are deliberately *not* done, because something else already
 * does them properly and doing them twice is how teardown turns into a crash:
 *
 *   - The renderer. React Three Fiber disposes the WebGL context when the Canvas
 *     unmounts, including forcing context loss so the browser gets its slot
 *     back. Disposing it from here as well would mean disposing it out of order
 *     with R3F's own teardown.
 *   - Mixers and render targets. CharacterController uncaches its mixer root and
 *     RenderEnvironment disposes its PMREM target, both on their own unmount.
 *
 * What nothing else does is the scene content. R3F never disposes an object
 * given to it as `<primitive>` — by design, because the object is not R3F's to
 * free — and the courtroom and every character are exactly that. So the room's
 * geometry, its materials and its textures survive an unmount untouched, and
 * the parsed GLB behind them survives in drei's cache. That gap is this file.
 *
 * None of it matters when the browser destroys the document: closing a tab frees
 * everything, and an iframe removed from the DOM takes its context with it. It
 * matters when the document *outlives* the hearing — a dev server hot-reloading
 * the scene, a host that mounts the courtroom, takes it away and mounts it
 * again. There, nothing above frees itself, and the second hearing starts with
 * the first one still in memory.
 */
import { useGLTF } from '@react-three/drei'
import { COURTROOM_MODEL } from '../config/courtroomLayout'
import { CHARACTER_REGISTRY, ROLE_ORDER } from '../config/characterRegistry'
import { releaseCharacters } from '../state/animationManager'

/**
 * The scene, captured once by the Canvas.
 *
 * Module-level rather than in the store on purpose: this is a live three.js
 * object, and putting it in zustand would both re-render every subscriber when
 * it changed and leave it one careless subscription away from being read during
 * a render pass.
 */
let root = null

export function captureScene(scene) {
  root = scene
}

/**
 * Every model path this app is capable of loading.
 *
 * Read from the registry rather than from whatever happens to be on screen: a
 * cast narrowed for one case still leaves the models of an earlier, wider case
 * in the cache. `useGLTF.clear` ignores a URL it never loaded, so naming them
 * all costs nothing and forgetting one costs 7 MB.
 */
function everyModel() {
  const paths = [COURTROOM_MODEL]
  for (const role of ROLE_ORDER) {
    const model = CHARACTER_REGISTRY[role]?.model
    if (model) paths.push(model)
  }
  return [...new Set(paths)]
}

/** Textures hang off materials by name, and the names differ per material type. */
function disposeMaterial(material, seen) {
  if (!material || seen.has(material)) return false
  seen.add(material)
  for (const value of Object.values(material)) {
    if (value && value.isTexture) value.dispose()
  }
  material.dispose()
  return true
}

/**
 * Free the scene content and the model cache.
 *
 * Must run while the scene still has its children — that is, from the unmount
 * of a component *above* the Canvas, whose cleanup React runs before it detaches
 * anything below it. Run afterwards, this would traverse an empty scene and
 * report, accurately, that it freed nothing.
 *
 * @returns {number} how many geometries and materials were released. Zero from
 *   a page that actually ran a hearing means this did not find the scene it was
 *   supposed to free, which is worth knowing.
 */
export function disposeCourtroom() {
  // 1. Stop the clock first. Nothing may touch a skeleton after this point: a
  //    mixer updating bones whose geometry has been freed is a crash, not a leak.
  releaseCharacters()

  let freed = 0
  const seenMaterials = new Set()

  if (root) {
    /*
     * Characters are SkeletonUtils clones of the cached GLTF, and a clone shares
     * its geometry and materials with the original rather than copying them. So
     * one walk of the live scene reaches the buffers behind both, and the `seen`
     * set stops a material shared by six characters being counted six times.
     */
    root.traverse((object) => {
      if (object.geometry) {
        object.geometry.dispose()
        freed += 1
      }
      const material = object.material
      if (Array.isArray(material)) {
        for (const m of material) if (disposeMaterial(m, seenMaterials)) freed += 1
      } else if (material && disposeMaterial(material, seenMaterials)) {
        freed += 1
      }
      if (object.skeleton) object.skeleton.dispose?.()
    })

    // The environment map is set on the scene rather than parented to it, so a
    // traverse never reaches it. RenderEnvironment disposes its own render
    // target; this covers a scene that outlives it.
    if (root.environment?.isTexture) {
      root.environment.dispose()
      root.environment = null
      freed += 1
    }
  }

  // 2. The parsed models, so nothing can resolve one out of the cache now.
  try {
    useGLTF.clear(everyModel())
  } catch (err) {
    console.warn('[courtroom] could not clear the model cache', err)
  }

  root = null

  // 3. The console handles. Convenient while wiring things up, and a reference
  //    to a whole event system if they are left behind.
  if (typeof window !== 'undefined') {
    delete window.courtAnim
    delete window.courtEvents
    delete window.courtMock
  }

  return freed
}
