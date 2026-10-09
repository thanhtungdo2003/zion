import { z } from 'zod';

/**
 * Validation schema for Blockbench `.bbmodel` files (format 4.x, "free" / "java_block").
 * Only the fields the runtime converter uses are typed; unknown keys are tolerated so newer
 * Blockbench versions keep loading. Hard limits protect clients from hostile or broken files.
 */
export const BBMODEL_LIMITS = {
  maxElements: 4000,
  maxTextures: 32,
  maxTextureDataUriLength: 6_000_000,
  maxCoordinate: 4096,
} as const;

const coord = z.number().finite().min(-BBMODEL_LIMITS.maxCoordinate).max(BBMODEL_LIMITS.maxCoordinate);
const vec3 = z.tuple([coord, coord, coord]);

const faceSchema = z
  .object({
    uv: z.tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()]).optional(),
    texture: z.union([z.number().int().min(0), z.null()]).optional(),
    rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).optional(),
  })
  .passthrough();

const legacyRotation = z
  .object({ angle: z.number().finite(), axis: z.enum(['x', 'y', 'z']), origin: vec3.optional() })
  .passthrough();

export const bbElementSchema = z
  .object({
    name: z.string().max(128).optional(),
    type: z.string().optional(),
    from: vec3,
    to: vec3,
    origin: vec3.optional(),
    rotation: z.union([vec3, legacyRotation]).optional(),
    inflate: z.number().finite().min(-64).max(64).optional(),
    visibility: z.boolean().optional(),
    box_uv: z.boolean().optional(),
    uv_offset: z.tuple([z.number().finite(), z.number().finite()]).optional(),
    mirror_uv: z.boolean().optional(),
    faces: z
      .object({
        north: faceSchema.optional(),
        east: faceSchema.optional(),
        south: faceSchema.optional(),
        west: faceSchema.optional(),
        up: faceSchema.optional(),
        down: faceSchema.optional(),
      })
      .passthrough().optional(),
  })
  .passthrough();

export const bbTextureSchema = z
  .object({
    name: z.string().max(256).optional(),
    source: z
      .string()
      .max(BBMODEL_LIMITS.maxTextureDataUriLength)
      .regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/, 'texture must be an embedded PNG data URI'),
    width: z.number().int().positive().max(4096).optional(),
    height: z.number().int().positive().max(4096).optional(),
    uv_width: z.number().int().positive().max(4096).optional(),
    uv_height: z.number().int().positive().max(4096).optional(),
  })
  .passthrough();

export const bbModelSchema = z
  .object({
    meta: z.object({ format_version: z.string().max(16), model_format: z.string().max(64).optional() }).passthrough(),
    name: z.string().max(256).optional(),
    resolution: z.object({ width: z.number().int().positive().max(4096), height: z.number().int().positive().max(4096) }),
    elements: z
      .array(z.union([bbElementSchema, z.object({ type: z.string().refine(t => t !== 'cube') }).passthrough()]))
      .max(BBMODEL_LIMITS.maxElements),
    textures: z.array(bbTextureSchema).max(BBMODEL_LIMITS.maxTextures).default([]),
  })
  .passthrough();

export type BBModel = z.infer<typeof bbModelSchema>;
export type BBElement = z.infer<typeof bbElementSchema>;
export type BBFace = z.infer<typeof faceSchema>;

/** Expand Blockbench box UVs without modifying the source model. */
export function bbCubeFaces(e: BBElement): NonNullable<BBElement['faces']> {
  if (e.faces) return e.faces;
  const [u, v] = e.uv_offset ?? [0, 0];
  const w = Math.abs(e.to[0] - e.from[0]);
  const h = Math.abs(e.to[1] - e.from[1]);
  const d = Math.abs(e.to[2] - e.from[2]);
  const face = (x: number, y: number, sx: number, sy: number): BBFace => ({ texture: 0, uv: [u + x, v + y, u + x + sx, v + y + sy] });
  const faces = {
    east: face(0, d, d, h), north: face(d, d, w, h), west: face(d + w, d, d, h),
    south: face(d * 2 + w, d, w, h), up: face(d + w, d, -w, -d), down: face(d + w * 2, 0, -w, d),
  };
  if (e.mirror_uv) {
    for (const f of Object.values(faces)) { const uv = f.uv!; f.uv = [uv[2], uv[1], uv[0], uv[3]]; }
    [faces.east, faces.west] = [faces.west, faces.east];
  }
  return faces;
}

/** True for elements the converter renders (cubes with from/to). Meshes/locators are skipped. */
export function isCubeElement(e: BBModel['elements'][number]): e is BBElement {
  return 'from' in e && 'to' in e && (e.type === undefined || e.type === 'cube');
}

export function parseBBModel(json: unknown): BBModel {
  const res = bbModelSchema.safeParse(json);
  if (!res.success) {
    throw new Error(`invalid bbmodel: ${res.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  }
  return res.data;
}
