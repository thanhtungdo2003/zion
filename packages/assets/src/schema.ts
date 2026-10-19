import { z } from 'zod';
import { BIOME_COUNT } from '@zion/shared';

const vec3 = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
const positive = z.number().finite().positive();
/** Per-collider layer override; defaults to the asset's collisionLayer. */
const colliderLayer = z.enum(['static', 'vegetation']).optional();

export const colliderDefinitionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('sphere'), center: vec3, radius: positive, layer: colliderLayer }).strict(),
  z.object({ type: z.literal('capsule'), a: vec3, b: vec3, radius: positive, layer: colliderLayer }).strict(),
  z
    .object({
      type: z.literal('box'),
      center: vec3,
      halfExtents: z.tuple([positive, positive, positive]),
      yaw: z.number().finite().default(0),
      layer: colliderLayer,
    })
    .strict(),
]);

/** Generators implemented by the client's procedural mesh library. */
export const PROCEDURAL_GENERATORS = [
  'spruce',
  'broadleaf',
  'birch',
  'jungle',
  'palm',
  'dead',
  'willow',
  'cactus',
  'bush',
  'fern',
  'reeds',
  'rock',
  'slab',
  'bridge_block',
  'water_tank',
  'ivy',
  'light_source',
] as const;

export const modelSourceSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('procedural'),
      generator: z.enum(PROCEDURAL_GENERATORS),
      params: z.record(z.union([z.number(), z.string(), z.boolean()])).default({}),
    })
    .strict(),
  z
    .object({
      kind: z.literal('glb'),
      /** Path relative to assets/source, resolved to a hashed URL through the asset manifest. */
      path: z.string().regex(/^[a-z0-9_\-/]+\.glb$/),
      scale: positive.default(1),
      offset: vec3.default([0, 0, 0]),
    })
    .strict(),
  z
    .object({
      kind: z.literal('bbmodel'),
      path: z.string().regex(/^[a-z0-9_\-/]+\.bbmodel$/),
      /** Blockbench units per metre (16 = one Minecraft block per metre). */
      unitsPerMeter: positive.default(16),
      /** Correct authored vehicle proportions before the final metre-space offset. */
      axisScale: z.tuple([positive, positive, positive]).default([1, 1, 1]),
      offset: vec3.default([0, 0, 0]),
      /** Euler XYZ (radians) turning the model about its origin, before `offset`. */
      rotation: vec3.optional(),
    })
    .strict(),
]);

export const ASSET_CATEGORIES = ['tree', 'vegetation', 'rock', 'decor', 'structure', 'block'] as const;
export const PLACEMENT_LAYERS = ['trees', 'shrubs', 'rocks', 'decor'] as const;
export const COLLISION_LAYERS = ['static', 'vegetation', 'none'] as const;

export const placementRuleSchema = z
  .object({
    layer: z.enum(PLACEMENT_LAYERS),
    /** Probability per placement-grid cell, per biome id (0..1). */
    biomes: z.record(z.coerce.number().int().min(0).max(BIOME_COUNT - 1), z.number().min(0).max(1)),
    /** Max terrain slope (rise/run). */
    maxSlope: z.number().min(0).max(10).default(0.8),
    /** Altitude window relative to sea level. */
    minAltitude: z.number().default(0.5),
    maxAltitude: z.number().default(1000),
    /** Allowed local temperature window (0 = coldest … 1 = hottest). */
    temperature: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]).default([0, 1]),
    /** Minimum horizontal distance from any water surface, metres. */
    waterClearance: z.number().min(0).default(1.5),
    /** If true, *requires* water within `waterClearance` (shore plants). */
    nearWater: z.boolean().default(false),
    /** Metres the base is sunk into the ground (scaled with the instance). */
    sink: z.number().min(0).default(0.2),
    scale: z.tuple([z.number().min(0.5).max(2), z.number().min(0.5).max(2)]).default([0.85, 1.2]),
    /** How strongly forest-patch noise modulates density (0 = uniform). */
    clustering: z.number().min(0).max(1).default(0.6),
  })
  .strict()
  .refine((r) => r.minAltitude <= r.maxAltitude, 'minAltitude must be <= maxAltitude')
  .refine((r) => r.scale[0] <= r.scale[1], 'scale range must be ascending');

export const assetDefinitionSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9]+(\.[a-z0-9_]+)+$/),
    numericId: z.number().int().min(1).max(65535),
    name: z.string().min(1).max(64),
    category: z.enum(ASSET_CATEGORIES),
    model: modelSourceSchema,
    colliders: z.array(colliderDefinitionSchema).max(16384).default([]),
    collisionLayer: z.enum(COLLISION_LAYERS).default('static'),
    /** Unscaled bounds used for culling, spacing and placement checks. */
    bounds: z.object({ radius: positive, height: positive }).strict(),
    render: z
      .object({
        castShadow: z.boolean().default(true),
        /** Wind sway amount for vegetation shaders (0 = rigid). */
        sway: z.number().min(0).max(1).default(0),
        /** Max render distance in metres. */
        maxDistance: z.number().positive().default(260),
      })
      .strict()
      .default({}),
    placement: placementRuleSchema.optional(),
    tags: z.array(z.string().max(32)).max(16).default([]),
  })
  .strict();

/** A prefab groups assets into a multi-part structure (buildings, wrecks, fences…). */
export const prefabDefinitionSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9]+(\.[a-z0-9_]+)+$/),
    name: z.string().min(1).max(64),
    parts: z
      .array(
        z
          .object({
            asset: z.string(),
            offset: vec3,
            yaw: z.number().finite().default(0),
            scale: z.number().min(0.5).max(2).default(1),
          })
          .strict(),
      )
      .min(1)
      .max(512),
    /** Footprint half-extents in XZ; settlement placement reserves this area. */
    footprint: z.tuple([positive, positive]),
    /** Max terrain height variance under the footprint before the prefab is rejected. */
    maxTerrainVariance: z.number().min(0).default(1.5),
    tags: z.array(z.string().max(32)).max(16).default([]),
  })
  .strict();

export type ColliderDefinition = z.infer<typeof colliderDefinitionSchema>;
export type ModelSource = z.infer<typeof modelSourceSchema>;
export type PlacementRule = z.infer<typeof placementRuleSchema>;
export type PlacementLayer = (typeof PLACEMENT_LAYERS)[number];
export type AssetDefinition = z.infer<typeof assetDefinitionSchema>;
export type AssetDefinitionInput = z.input<typeof assetDefinitionSchema>;
export type PrefabDefinition = z.infer<typeof prefabDefinitionSchema>;
export type PrefabDefinitionInput = z.input<typeof prefabDefinitionSchema>;
export type ProceduralGenerator = (typeof PROCEDURAL_GENERATORS)[number];
