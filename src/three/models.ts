// Kenney Tower Defense Kit (CC0) GLTF model registry.
//
// The whole kit shares ONE 512×512 texture atlas ("colormap") and ONE material,
// so every model is coherent by construction and we can drive the entire board +
// towers with a HANDFUL of shared materials (atlas map + per-role tint/emissive).
//
// The GLBs reference `Textures/colormap.png`, which is NOT shipped here — but the
// kit's alternate colourway `variation-a.png` uses the identical UV layout, so a
// LoadingManager URL-modifier transparently redirects to it. If that ever fails
// the meshes still load (correct shapes); we log once and fall back to flat tints.
//
// Lifecycle: this is a PERSISTENT module singleton. BootScene preloads it once;
// every BattleView3D CLONES from it (never re-loads) and, on teardown, disposes
// only the materials IT created — never the registry's shared geometry/atlas, so
// the next battle re-uploads cleanly to its fresh GL context.

import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { qa } from '../game/qa'

const KIT_BASE = `${import.meta.env.BASE_URL}models/kenney-td/`

// Every model we actually use this pass (board tiles + scatter details; towers
// are now procedural — see towerModels.ts — so the kit tower parts aren't loaded).
export const MODEL_NAMES = [
  // tiles
  'tile', 'tile-straight', 'tile-corner-round', 'tile-spawn', 'tile-end',
  // scatter details
  'detail-tree', 'detail-tree-large', 'detail-rocks', 'detail-rocks-large',
  'detail-crystal', 'detail-crystal-large',
  // markers
  'selection-a',
] as const

export type ModelName = (typeof MODEL_NAMES)[number]

class ModelRegistry {
  private scenes = new Map<string, THREE.Object3D>()
  private manager = new THREE.LoadingManager()
  private loader: GLTFLoader
  private loadPromise: Promise<void> | null = null
  ready = false
  atlasWarned = false

  constructor() {
    THREE.Cache.enabled = true // fetch each GLB + the shared atlas exactly once
    // The shipped atlas is `variation-a.png`; the GLBs point at the missing
    // `colormap.png`. Redirect so the kit renders with its authored texture.
    this.manager.setURLModifier((url) =>
      url.indexOf('colormap.png') >= 0 ? url.replace('colormap.png', 'variation-a.png') : url,
    )
    this.loader = new GLTFLoader(this.manager)
  }

  /** Preload every kit model once. Safe to call repeatedly (returns the same promise). */
  load(onProgress?: (frac: number) => void): Promise<void> {
    if (this.loadPromise) return this.loadPromise
    const names = MODEL_NAMES as readonly string[]
    let done = 0
    const one = (n: string) =>
      this.loader
        .loadAsync(KIT_BASE + n + '.glb')
        .then((gltf) => { this.scenes.set(n, gltf.scene) })
        .catch((err) => {
          // FAIL LOUD (D2): a missing GLB used to console.error then silently
          // clone() an empty Group — props just absent, detectable by nobody in
          // QA terms. Emit telemetry so a dropped kit model is a red juicecheck,
          // not an invisible gap (juicecheck asserts models.ready + every
          // MODEL_NAMES entry has()).
          console.error('[models] failed to load', n, err)
          if (qa.enabled) qa.emit('asset', { what: 'kit-model', url: n })
        })
        .finally(() => { done++; onProgress?.(done / names.length) })
    this.loadPromise = Promise.all(names.map(one)).then(() => {
      this.ready = true
      // Sanity-check the texture redirect landed; warn once if we're untextured.
      const m = this.material('tile')
      if (m && !(m as THREE.MeshStandardMaterial).map && !this.atlasWarned) {
        this.atlasWarned = true
        console.warn('[models] atlas texture missing — models will render with flat tints')
      }
    })
    return this.loadPromise
  }

  has(name: string): boolean { return this.scenes.has(name) }

  /** Deep clone of a model root; shares registry geometry + material references. */
  clone(name: string): THREE.Object3D {
    const s = this.scenes.get(name)
    return s ? s.clone(true) : new THREE.Group()
  }

  /** First mesh's material from a loaded model (the shared atlas material). */
  material(name: string): THREE.Material | null {
    const s = this.scenes.get(name)
    if (!s) return null
    let mat: THREE.Material | null = null
    s.traverse((o) => {
      const m = o as THREE.Mesh
      if (m.isMesh && !mat) mat = Array.isArray(m.material) ? m.material[0] : m.material
    })
    return mat
  }

  /** The shared kit atlas texture (or null if it failed to load). Never dispose it. */
  atlas(): THREE.Texture | null {
    const m = this.material('tile') as THREE.MeshStandardMaterial | null
    return m ? m.map : null
  }

  /**
   * A single BufferGeometry baked into local space (node transforms applied) for a
   * model, suitable for InstancedMesh. Returns null if the model has no mesh.
   */
  geometry(name: string): THREE.BufferGeometry | null {
    const s = this.scenes.get(name)
    if (!s) return null
    s.updateMatrixWorld(true)
    let geo: THREE.BufferGeometry | null = null
    s.traverse((o) => {
      const m = o as THREE.Mesh
      if (m.isMesh && !geo) {
        const g = m.geometry.clone()
        g.applyMatrix4(m.matrixWorld)
        geo = g
      }
    })
    return geo
  }
}

// Persistent singleton — survives BattleScene restarts.
export const models = new ModelRegistry()
