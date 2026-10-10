import {
  BoxGeometry,
  DoubleSide,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  type BufferGeometry,
  type Material,
  type Object3D,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
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
import { buildProceduralGeometry } from './procedural-models';
import { cachedFetch } from '@/lib/preload';
import { naturalMaterial } from './natural-material';

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
  const byMaterial = new Map<Material, BufferGeometry[]>();
  const base = new Matrix4().makeTranslation(offset[0], offset[1], offset[2]).multiply(new Matrix4().makeScale(scale, scale, scale));
  root.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    const mat = (Array.isArray(o.material) ? o.material[0] : o.material) as Material;
    const g = (o.geometry as BufferGeometry).clone().applyMatrix4(new Matrix4().multiplyMatrices(base, o.matrixWorld));
    const list = byMaterial.get(mat) ?? [];
    list.push(g);
    byMaterial.set(mat, list);
  });
  const parts: ModelPart[] = [];
  for (const [material, geos] of byMaterial) {
    const merged = geos.length === 1 ? geos[0]! : mergeGeometries(geos, false);
    if (merged) parts.push({ geometry: merged, material });
  }
  return parts;
}

/**
 * Resolves asset definitions to renderable geometry: procedural generators, Blockbench models
 * or GLB files (looked up through the content-hashed asset manifest). Failures degrade to a
 * collider-sized placeholder box and are reported, never thrown into the render loop.
 */
export class AssetLibrary {
  private manifest: AssetManifest | null = null;
  private readonly visuals = new Map<number, AssetVisual>();
  private readonly loading = new Map<number, Promise<AssetVisual>>();
  private readonly gltf = new GLTFLoader();
  readonly errors: string[] = [];

  constructor(private readonly registry: AssetRegistry) {}

  private async getManifest(): Promise<AssetManifest> {
    if (this.manifest) return this.manifest;
    const res = await fetch(ASSET_MANIFEST_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`asset manifest unavailable (${res.status}); run pnpm assets:build`);
    this.manifest = assetManifestSchema.parse(await res.json());
    return this.manifest;
  }

  get(numericId: number): AssetVisual | undefined {
    return this.visuals.get(numericId);
  }

  load(numericId: number): Promise<AssetVisual> | undefined {
    const existing = this.loading.get(numericId);
    if (existing) return existing;
    const def = this.registry.byNumericId(numericId);
    if (!def) return undefined;
    const p = this.build(def)
      .catch((err: unknown) => {
        const msg = `${def.id}: ${(err as Error).message}`;
        this.errors.push(msg);
        console.warn('asset failed to load, using placeholder:', msg);
        return { def, parts: [this.placeholder(def)] };
      })
      .then((v) => {
        for (const part of v.parts) applyOcclusionFade(part.material);
        this.visuals.set(numericId, v);
        return v;
      });
    this.loading.set(numericId, p);
    return p;
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
        if (model.generator === 'rock' || model.generator === 'slab') naturalMaterial(material, 'rock');
        else naturalMaterial(material, 'tree');
        return { def, parts: [{ geometry, material }] };
      }
      case 'bbmodel': {
        const entry = (await this.getManifest()).files[model.path];
        if (!entry) throw new Error(`model ${model.path} missing from manifest`);
        const res = await cachedFetch(entry.url);
        if (!res.ok) throw new Error(`fetch ${entry.url} failed (${res.status})`);
        return { def, parts: await loadBBModel(await res.json(), model.unitsPerMeter, model.offset) };
      }
      case 'glb': {
        const entry = (await this.getManifest()).files[model.path];
        if (!entry) throw new Error(`model ${model.path} missing from manifest`);
        const gltf = await this.gltf.loadAsync(entry.url);
        return { def, parts: flattenScene(gltf.scene, model.scale, model.offset) };
      }
    }
  }
}
