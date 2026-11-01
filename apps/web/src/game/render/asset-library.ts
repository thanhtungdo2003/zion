import { collectAssetLights } from './asset-lights';
import {
  Box3,
  BoxGeometry,
  DoubleSide,
  Euler,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  Vector3,
  type BufferGeometry,
  type Color,
  type Material,
  type Object3D,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  ASSET_MANIFEST_URL,
  assetManifestSchema,
  type AssetDefinition,
  type AssetManifest,
  type AssetRegistry,
} from '@zion/assets';
import { loadBBModel, type ModelPart } from './bbmodel-loader';
import { applyOcclusionFade } from './occlusion-fade';
import { preserveAlphaCoverage } from './alpha-coverage';
import { buildProceduralGeometry } from './procedural-models';
import { cachedFetch } from '@/lib/preload';
import { modelBytes } from '@/lib/model-cache';
import { gltfLoader } from './gltf-loader';
import { API_URL } from '@/lib/api';
import { uploadedModelUrl } from '@zion/assets';
import { mossyRock, naturalMaterial } from './natural-material';
import { assetProfile, layerMaterial } from './surface-layers';
import { prepareGlass } from './glass';
import { ResourceDisposer } from './resources';

export interface AssetVisual {
  def: AssetDefinition;
  parts: ModelPart[];
}

/** Shared uniforms for vegetation wind sway. */
export const windUniforms = { uTime: { value: 0 } };

function swayMaterial(sway: number): MeshLambertMaterial {
  const mat = new MeshLambertMaterial({ vertexColors: true, side: DoubleSide });
  if (sway > 0) {
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = windUniforms.uTime;
      shader.uniforms.uSway = { value: sway };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uSway;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          #ifdef USE_INSTANCING
            vec3 iOrigin = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
          #else
            vec3 iOrigin = vec3(0.0);
          #endif
          float hgt = max(position.y, 0.0);
          float phase = iOrigin.x * 0.21 + iOrigin.z * 0.17;
          float bend = uSway * hgt * hgt * 0.006;
          transformed.x += sin(uTime * 1.3 + phase) * bend;
          transformed.z += cos(uTime * 1.1 + phase * 1.3) * bend * 0.6;`,
        );
    };
    mat.customProgramCacheKey = () => `sway-${sway}`;
  }
  return mat;
}

/** Flattens a glTF scene into one merged geometry per material (instancing-friendly). */
function flattenScene(root: Object3D, scale: number, offset: readonly [number, number, number]): ModelPart[] {
  root.updateMatrixWorld(true);
  const byMaterial = new Map<string, {material:Material;geos:BufferGeometry[];wheel?:number;wheelCenter?:readonly [number,number,number];rotor?:'main'|'tail';rotorCenter?:readonly [number,number,number]}>();
  const base = new Matrix4().makeTranslation(offset[0], offset[1], offset[2]).multiply(new Matrix4().makeScale(scale, scale, scale));
  root.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    const mat = (Array.isArray(o.material) ? o.material[0] : o.material) as Material;
    const g = (o.geometry as BufferGeometry).clone().applyMatrix4(new Matrix4().multiplyMatrices(base, o.matrixWorld));
    const wheel=o.userData.vehicleWheel as number|undefined;
    const wheelCenter=o.userData.wheelCenter as [number,number,number]|undefined;
    if(wheelCenter)g.translate(-wheelCenter[0],-wheelCenter[1],-wheelCenter[2]);
    const rotor=o.userData.vehicleRotor as 'main'|'tail'|undefined, rotorCenter=o.userData.rotorCenter as [number,number,number]|undefined;
    if(rotor&&rotorCenter)g.translate(-rotorCenter[0]*scale-offset[0],-rotorCenter[1]*scale-offset[1],-rotorCenter[2]*scale-offset[2]);
    const key=mat.uuid+':'+(wheel??rotor??'body');
    const list = byMaterial.get(key) ?? {material:mat,geos:[],wheel,wheelCenter,...(rotor&&rotorCenter?{rotor,rotorCenter:[rotorCenter[0]*scale+offset[0],rotorCenter[1]*scale+offset[1],rotorCenter[2]*scale+offset[2]] as const}:{})};
    list.geos.push(g);
    byMaterial.set(key, list);
  });
  const parts: ModelPart[] = [];
  for (const {material,geos,wheel,wheelCenter,rotor,rotorCenter} of byMaterial.values()) {
    const merged = geos.length === 1 ? geos[0]! : mergeGeometries(geos, false);
    if (merged) parts.push({ geometry: merged, material, wheel, wheelCenter, ...(rotor && rotorCenter ? { rotor, rotorCenter } : {}) });
    if (geos.length > 1) for (const geometry of geos) geometry.dispose();
  }
  return parts;
}

/**
 * Resolves asset definitions to renderable geometry: procedural generators, Blockbench models
 * or GLB files (looked up through the content-hashed asset manifest). Failures degrade to a
 * collider-sized placeholder box and are reported, never thrown into the render loop.
 */
/** A change made in the Model Studio to one of the game's own models (server asset-overrides.ts). */
export interface AssetOverride { id: number; base: number; kind: 'replace' | 'variant' | 'hide'; name: string; weight: number; version: number; bytes: number }
/** Visual ids of the models mixed in among a game model's instances: VARIANT_ID + override id. */
export const VARIANT_ID = 900_000;

export async function fetchAssetOverrides(): Promise<AssetOverride[]> {
  const res = await fetch(`${API_URL}/api/asset-overrides`, { cache: 'no-store' });
  return res.ok ? await res.json() as AssetOverride[] : [];
}

export class AssetLibrary {
  private glbActive = 0;
  private readonly glbWaiters: Array<() => void> = [];
  /** A tree or big plant: drawn as a depth impostor beyond its model's range (render/impostor.ts). */
  hasImpostor(numericId: number): boolean {
    const def = this.registry.byNumericId(this.baseOf(numericId));
    return !!def && (def.category === 'tree' || def.category === 'vegetation') && def.bounds.radius > 1.2;
  }
  inRange(numericId: number, distanceSquared: number): boolean {
    const def = this.registry.byNumericId(this.baseOf(numericId));
    return !!def && distanceSquared <= def.render.maxDistance ** 2;
  }
  private async acquireGlb(): Promise<() => void> {
    if (this.glbActive >= 2) await new Promise<void>(resolve => this.glbWaiters.push(resolve));
    else this.glbActive++;
    return () => {
      const next = this.glbWaiters.shift();
      if (next) next();
      else this.glbActive--;
    };
  }
  private manifest: AssetManifest | null = null;
  private manifestLoading: Promise<AssetManifest> | null = null;
  private readonly visuals = new Map<number, AssetVisual>();
  private readonly loading = new Map<number, Promise<AssetVisual>>();
  private readonly gltf = gltfLoader();
  private disposed = false;
  private readonly resources = new ResourceDisposer();
  readonly errors: string[] = [];

  /**
   * `game`: the game itself (editor-only markers such as light sources are not drawn).
   * `overrides`: apply the Model Studio's changes to the game's models (on by default in game).
   */
  constructor(private readonly registry: AssetRegistry, private readonly options: { game?: boolean; overrides?: boolean } = {}) {
    this.overridesReady = options.overrides ?? options.game ? this.refreshOverrides() : Promise.resolve();
  }

  /* -------------------------------------------- the Model Studio's changes to game models */

  private byBase = new Map<number, { replace?: AssetOverride; hide?: AssetOverride; variants: AssetOverride[] }>();
  private overrideById = new Map<number, AssetOverride>();
  /** Settled once the changes are known (models wait for it before they are built). */
  overridesReady: Promise<void>;

  /** Applies a list of changes; models they touch are built again the next time they are asked for. */
  setOverrides(list: readonly AssetOverride[]): void {
    const touched = new Set<number>([...this.overrideById.values()].flatMap((o) => [o.base, VARIANT_ID + o.id]));
    this.byBase.clear(); this.overrideById.clear();
    for (const o of list) {
      this.overrideById.set(o.id, o);
      let e = this.byBase.get(o.base);
      if (!e) this.byBase.set(o.base, e = { variants: [] });
      if (o.kind === 'variant') e.variants.push(o); else e[o.kind] = o;
      touched.add(o.base); touched.add(VARIANT_ID + o.id);
    }
    for (const id of touched) {
      const v = this.visuals.get(id);
      if (v) this.releaseVisual(v);
      this.visuals.delete(id); this.loading.delete(id);
    }
  }

  /** Fetches the changes from the server again (the Studio after an edit). */
  refreshOverrides(): Promise<void> {
    return fetchAssetOverrides().then((list) => this.setOverrides(list)).catch(() => undefined);
  }

  /**
   * The model to draw for an instance of `asset` at (x, z): the asset itself, one of the models
   * mixed in among it (chosen by position and weight, the same every time), or −1: hidden.
   */
  pick(asset: number, x: number, z: number): number {
    const e = this.byBase.get(asset);
    if (!e) return asset;
    if (e.hide) return -1;
    if (!e.variants.length) return asset;
    let h = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453; h -= Math.floor(h);
    let total = 1;
    for (const v of e.variants) total += v.weight;
    let at = h * total - 1;
    if (at < 0) return asset;
    for (const v of e.variants) { if ((at -= v.weight) < 0) return VARIANT_ID + v.id; }
    return asset;
  }

  /** The game model a visual id stands for (a mixed-in model: the one it is mixed among). */
  baseOf(id: number): number {
    return id >= VARIANT_ID ? this.overrideById.get(id - VARIANT_ID)?.base ?? id : id;
  }

  /** Builds a model from a Studio file, fitted to the game model's size and footing. */
  private async buildOverride(def: AssetDefinition, o: AssetOverride): Promise<AssetVisual> {
    const release = await this.acquireGlb();
    try {
      const url = new URL(`${API_URL}/api/asset-overrides/${o.id}.glb?v=${o.version}`, typeof location !== 'undefined' ? location.href : 'http://localhost/').href;
      const gltf = await this.gltf.parseAsync(await modelBytes(url), url.slice(0, url.lastIndexOf('/') + 1));
      const parts = flattenScene(gltf.scene, 1, [0, 0, 0]);
      const box = new Box3();
      for (const part of parts) { part.geometry.computeBoundingBox(); box.union(part.geometry.boundingBox!); }
      const size = box.getSize(new Vector3());
      const k = size.y > 1e-4 ? def.bounds.height / size.y : 1;
      const fit = new Matrix4().makeScale(k, k, k).premultiply(new Matrix4().makeTranslation(-(box.min.x + box.max.x) / 2 * k, -box.min.y * k, -(box.min.z + box.max.z) / 2 * k));
      for (const part of parts) { part.geometry.applyMatrix4(fit); part.geometry.computeBoundingSphere(); }
      if (def.category === 'rock' || def.category === 'tree' || def.category === 'vegetation') for (const part of parts) {
        const m = part.material as { roughness?: number; metalness?: number; needsUpdate: boolean };
        if (m.roughness !== undefined) { m.roughness = Math.max(m.roughness, .9); m.metalness = 0; m.needsUpdate = true; }
        if (!part.geometry.getAttribute('normal')) part.geometry.computeVertexNormals();
      }
      gltf.scene.traverse((node) => { if (node instanceof Mesh) this.resources.release(node.geometry); });
      return { def, parts };
    } finally { release(); }
  }

  private async getManifest(): Promise<AssetManifest> {
    if (this.manifest) return this.manifest;
    this.manifestLoading ??= (async () => {
      const res = await fetch(ASSET_MANIFEST_URL, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`asset manifest unavailable (${res.status}); run pnpm assets:build`);
      this.manifest = assetManifestSchema.parse(await res.json());
      return this.manifest;
    })().catch((err: unknown) => { this.manifestLoading = null; throw err; });
    return this.manifestLoading;
  }

  get(numericId: number): AssetVisual | undefined {
    return this.visuals.get(numericId);
  }

  load(numericId: number): Promise<AssetVisual> | undefined {
    if (this.disposed) return undefined;
    const existing = this.loading.get(numericId);
    if (existing) return existing;
    const def = this.registry.byNumericId(this.baseOf(numericId));
    if (!def) return undefined;
    const p = this.overridesReady.then(() => {
      // Hidden in the Studio: nothing to draw. Replaced or mixed in: the Studio's file.
      const e = this.byBase.get(def.numericId);
      if (numericId >= VARIANT_ID) { const o = this.overrideById.get(numericId - VARIANT_ID); return o ? this.buildOverride(def, o) : Promise.resolve({ def, parts: [] }); }
      if (e?.hide) return Promise.resolve({ def, parts: [] } as AssetVisual);
      if (e?.replace) return this.buildOverride(def, e.replace);
      return this.buildWithRetry(def);
    })
      .catch((err: unknown) => {
        const msg = `${def.id}: ${(err as Error).message}`;
        this.errors.push(msg);
        console.warn('asset failed to load, using placeholder:', msg);
        return { def, parts: [this.placeholder(def)] };
      })
      .then((v) => {
        if (this.disposed) { this.releaseVisual(v); return v; }
        // Cut-out leaves keep their coverage at a distance (alpha-coverage.ts).
        // Wear, weathering and per-instance variation by the kind of object (surface-layers.ts).
        const profile = assetProfile(def);
        for (const part of v.parts) layerMaterial(part.material, profile, def.bounds.height, part.geometry);
        for (const part of v.parts) applyOcclusionFade(preserveAlphaCoverage(part.material));
        // Window glass that shots, blasts and blows break (glass.ts).
        prepareGlass(numericId, v);
        this.visuals.set(numericId, v);
        return v;
      });
    this.loading.set(numericId, p);
    return p;
  }

  private releaseVisual(v: AssetVisual): void {
    for (const part of v.parts) {
      this.resources.release(part.geometry);
      this.resources.release(part.material);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const visual of this.visuals.values()) this.releaseVisual(visual);
    this.visuals.clear();
    this.loading.clear();
  }

  /**
   * A model that fails to download (a dropped connection, a busy server right after a deploy) is
   * tried again a couple of times before it is shown as a placeholder.
   */
  private async buildWithRetry(def: AssetDefinition): Promise<AssetVisual> {
    for (let attempt = 0; ; attempt++) {
      try { return await this.build(def); } catch (err) {
        const missing = err instanceof Error && /missing from manifest/.test(err.message);
        if (missing || attempt >= 2 || this.disposed) throw err;
        await new Promise((r) => setTimeout(r, 1000 * 3 ** attempt));
      }
    }
  }

  private placeholder(def: AssetDefinition): ModelPart {
    const r = def.bounds.radius;
    const g = new BoxGeometry(r, def.bounds.height, r).translate(0, def.bounds.height / 2, 0);
    return { geometry: g, material: new MeshLambertMaterial({ color: 0xff00ff }) };
  }

  private async build(def: AssetDefinition): Promise<AssetVisual> {
    const model = def.model;
    switch (model.kind) {
      case 'procedural': {
        const geometry = buildProceduralGeometry(model.generator, model.params, def.numericId);
        const material = swayMaterial(def.render.sway);
        if (model.generator === 'light_source') {
          material.emissive.set(0xffc94a); material.emissiveIntensity = .9;
          if (this.options.game) material.visible = false;
          return { def, parts: [{ geometry, material }] };
        }
        if (def.numericId === 2210) { material.polygonOffset = true; material.polygonOffsetFactor = -2; material.polygonOffsetUnits = -2; }
        if (model.generator === 'rock' || model.generator === 'slab') naturalMaterial(material, 'rock');
        else if (model.generator !== 'bridge_block' && model.generator !== 'water_tank') naturalMaterial(material, 'tree');
        return { def, parts: [{ geometry, material }] };
      }
      case 'bbmodel': {
        const entry = (await this.getManifest()).files[model.path];
        if (!entry) throw new Error(`model ${model.path} missing from manifest`);
        const res = await cachedFetch(entry.url);
        if (!res.ok) throw new Error(`fetch ${entry.url} failed (${res.status})`);
        if (!model.rotation) return { def, parts: await loadBBModel(await res.json(), model.unitsPerMeter, model.offset, model.axisScale) };
        // Turned about the model origin first, then offset (leaning and fallen variants).
        const parts = await loadBBModel(await res.json(), model.unitsPerMeter, [0, 0, 0], model.axisScale);
        const turn = new Matrix4().makeTranslation(...model.offset).multiply(new Matrix4().makeRotationFromEuler(new Euler(...model.rotation)));
        for (const part of parts) { part.geometry.applyMatrix4(turn); part.geometry.computeBoundingSphere(); }
        return { def, parts };
      }
      case 'glb': {
        const release = await this.acquireGlb();
        try {
        if (this.disposed) throw new Error('asset library disposed');
        // A map model uploaded in the Studio is served by the API, not the asset manifest.
        const uploaded = uploadedModelUrl(def.numericId, model.path);
        const entry = uploaded ? { url: `${API_URL}${uploaded}` } : (await this.getManifest()).files[model.path];
        if (!entry) throw new Error(`model ${model.path} missing from manifest`);
        // From this machine when it already has this version (kept between matches).
        const url = new URL(entry.url, typeof location !== 'undefined' ? location.href : 'http://localhost/').href;
        const gltf = await this.gltf.parseAsync(await modelBytes(url), url.slice(0, url.lastIndexOf('/') + 1));
        const parts = flattenScene(gltf.scene, model.scale, model.offset);
        // Lamps saved in the model (glowing blocks): lit in game like the camp's.
        collectAssetLights(def.numericId, gltf.scene, model.scale, model.offset);
        // Rocks, trees and plants are matte: no glossy highlights from photographed packs.
        // Buildings and whole maps: no mirror-like floors under lamps (rough, a little sheen at most).
        if (def.category === 'structure') for (const part of parts) {
          const m = part.material as { roughness?: number; needsUpdate: boolean };
          if (m.roughness !== undefined && m.roughness < .85) { m.roughness = .85; m.needsUpdate = true; }
        }
        if (def.category === 'rock' || def.category === 'tree' || def.category === 'vegetation') for (const part of parts) {
          const m = part.material as { roughness?: number; metalness?: number; roughnessMap?: unknown; metalnessMap?: unknown; map?: unknown; vertexColors?: boolean; color?: Color; needsUpdate: boolean };
          if (m.roughness === undefined) continue;
          m.roughness = 1; m.metalness = 0; m.roughnessMap = null; m.metalnessMap = null; m.needsUpdate = true;
          // Some packs ship rocks without normals, with vertex colours they do not have, or with a
          // near-black base colour meant for a texture that is not there: all render pitch black.
          if (!part.geometry.getAttribute('normal')) part.geometry.computeVertexNormals();
          if (m.vertexColors && !part.geometry.getAttribute('color')) m.vertexColors = false;
          if (def.category === 'rock' && m.color && !m.map && m.color.r + m.color.g + m.color.b < .25) m.color.set('#8b877e');
          // Rocks gather moss in green, damp country (on their tops, in their cracks).
          if (def.category === 'rock') mossyRock(part.material);
        }
        // Flattened parts own cloned buffers but retain the original materials/textures.
        gltf.scene.traverse((node) => { if (node instanceof Mesh) this.resources.release(node.geometry); });
        return { def, parts };
        } finally { release(); }
      }
    }
  }
}
