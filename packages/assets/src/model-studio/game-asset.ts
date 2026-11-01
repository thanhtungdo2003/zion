import { lotFitFromLegacy, type LotFit } from '@zion/shared';
import type { AssetDefinitionInput, ColliderDefinition } from '../schema';
import type { AssetKind } from './doc';
import type { AssetPlacement } from './export';

/**
 * Models published from the Model Studio into the game: each gets a numeric id in its own
 * reserved range and is registered at runtime (servers, chunk workers, clients), like the
 * Infection map uploads. It collides as itself — its opaque textured triangles (the hit mesh,
 * read from the file) found through one solid box — so doorways, stairs and window openings
 * work as modelled. Furniture and garden models of the game it uses ride along as `composite`
 * placements (expanded wherever the model is placed).
 */
export const STUDIO_MODEL_ASSET_MIN = 3000;
export const STUDIO_MODEL_ASSET_MAX = 3999;
export const isStudioModelAsset = (asset: number) => asset >= STUDIO_MODEL_ASSET_MIN && asset <= STUDIO_MODEL_ASSET_MAX;
export const studioModelPath = (asset: number) => `uploads/model-studio-${asset}.glb`;
export const studioModelUrl = (asset: number, version?: number) => `/api/model-assets/${asset}.glb${version ? `?v=${version}` : ''}`;

const CATEGORY: Record<AssetKind, 'structure' | 'rock' | 'vegetation' | 'decor'> = { building: 'structure', prop: 'decor', rock: 'rock', vegetation: 'vegetation', furniture: 'decor', vehicle: 'structure', weapon: 'decor', other: 'decor' };
const r3 = (v: number) => Math.round(v * 1000) / 1000;

export interface StudioAssetInput {
  asset: number;
  name: string;
  kind: AssetKind;
  /** Older single lot class (see lotFitFromLegacy); `fit` replaces it. */
  lotClass?: string;
  /** Where it fits on a map's lots: classes, conditions, kinds of area. */
  fit?: LotFit;
  /** Bounds of what collides and draws (model space, the model stands on y = 0). */
  min: [number, number, number];
  max: [number, number, number];
  /**
   * Bounds of the model's own triangles (its footprint: the house without its yard's trees and
   * furniture, which collide themselves). Absent: `min` / `max`.
   */
  solidMin?: [number, number, number];
  solidMax?: [number, number, number];
  refs: AssetPlacement[];
  /** The model has triangles of its own (else it is only its placed game models, which collide themselves). */
  solid?: boolean;
  /** Door leaves that open and close in game (export.ts; left out of the mesh). */
  doors?: ReadonlyArray<{ x: number; y: number; z: number; yaw: number; w: number; h: number; color?: string }>;
}

/** The game asset definition of a published model. */
export function studioModelAsset(input: StudioAssetInput): AssetDefinitionInput {
  const min = input.solidMin ?? input.min, max = input.solidMax ?? input.max;
  const half: [number, number, number] = [Math.max(.05, (max[0] - min[0]) / 2), Math.max(.05, (max[1] - Math.min(0, min[1])) / 2), Math.max(.05, (max[2] - min[2]) / 2)];
  const center: [number, number, number] = [(min[0] + max[0]) / 2, Math.min(0, min[1]) + half[1], (min[2] + max[2]) / 2];
  const colliders: ColliderDefinition[] = [{ type: 'box', center: center.map(r3) as [number, number, number], halfExtents: half.map((v) => r3(v + .05)) as [number, number, number], solid: true } as ColliderDefinition];
  const radius = Math.max(.05, Math.hypot(Math.max(Math.abs(input.min[0]), Math.abs(input.max[0])), Math.max(Math.abs(input.min[2]), Math.abs(input.max[2]))));
  const big = input.kind === 'building' || input.kind === 'vehicle';
  return {
    id: `studio.model_${input.asset}`, numericId: input.asset, name: input.name.slice(0, 64) || `Model ${input.asset}`,
    // Given a place on map lots, it is a building whatever kind it was left as.
    category: input.fit ? 'structure' : CATEGORY[input.kind],
    model: { kind: 'glb', path: studioModelPath(input.asset), scale: 1, offset: [0, 0, 0] },
    ...(input.solid === false ? { colliders: [], collisionLayer: 'none' } : { colliders, collisionLayer: 'static' }),
    bounds: { radius: r3(radius), height: r3(Math.max(.05, input.max[1])) },
    render: { maxDistance: big ? 700 : input.kind === 'rock' ? 450 : 220 },
    tags: ['model-studio', `kind:${input.kind}`],
    ...((input.fit ?? lotFitFromLegacy(input.lotClass)) ? { fit: input.fit ?? lotFitFromLegacy(input.lotClass) } : {}),
    ...(input.refs.length ? { composite: input.refs.slice(0, 512) } : {}),
    ...(input.doors?.length ? { doors: input.doors.slice(0, 64).map((d) => ({ ...d, w: Math.min(6, Math.max(.2, d.w)), h: Math.min(8, Math.max(.5, d.h)) })) } : {}),
  } as AssetDefinitionInput;
}

/** Where a client or server fetches an uploaded model's file (Infection map or Model Studio). */
export function uploadedModelUrl(asset: number, path: string): string | null {
  const infection = /^uploads\/infection-map-(\d+)\.glb$/.exec(path);
  if (infection) return `/api/infection-maps/models/${infection[1]}.glb`;
  const studio = /^uploads\/model-studio-(\d+)\.glb$/.exec(path);
  if (studio) return studioModelUrl(asset);
  return null;
}
