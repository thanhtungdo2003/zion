import { z } from 'zod';

/**
 * A Model Studio project: an editable scene of parts (procedural shapes, game assets, imported
 * GLB files) and the PBR materials they use. Everything is data — parameters, not baked
 * triangles — so the admin and the AI agent can change any part later; the meshes, textures and
 * GLB are produced from it (`evaluate`, `textures`, `exportGlb`). Units: metres, +y up, the
 * model stands on y = 0 and faces +z (its front, the street side for buildings).
 */
export const MODEL_DOC_VERSION = 1;

const finite = z.number().finite();
const vec3 = z.tuple([finite, finite, finite]);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const TEXTURE_PATTERNS = ['plain', 'noise', 'stone', 'rock', 'brick', 'plaster', 'concrete', 'wood', 'planks', 'metal', 'rust', 'corrugated', 'roof_tiles', 'shingles', 'fabric', 'tiles', 'glass', 'ground', 'grass', 'gravel', 'bark', 'leaves'] as const;
export type TexturePattern = (typeof TEXTURE_PATTERNS)[number];

export const textureSchema = z.object({
  pattern: z.enum(TEXTURE_PATTERNS),
  /** Metres one tile of the texture covers. */
  scale: finite.min(.05).max(50),
  seed: z.number().int().min(0).max(0xffffffff),
  /** 0..1 weathering layers on top of the pattern. */
  wear: finite.min(0).max(1),
  dirt: finite.min(0).max(1),
  moss: finite.min(0).max(1),
  cracks: finite.min(0).max(1),
  /** 0..1 how much colour and roughness vary across the surface. */
  variation: finite.min(0).max(1),
  /** A second colour some patterns use (mortar, grain, rust, grout). */
  accent: color.optional(),
}).strict();
export type TextureRecipe = z.infer<typeof textureSchema>;

export const materialSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(80),
  /** The preset it started from (knowledge of the real material; see materials.ts). */
  preset: z.string().max(40).optional(),
  color: color,
  roughness: finite.min(0).max(1),
  metalness: finite.min(0).max(1),
  normalStrength: finite.min(0).max(4),
  aoStrength: finite.min(0).max(1),
  /** 1 opaque; below 1 blended (glass, thin cloth). */
  opacity: finite.min(.02).max(1),
  emissive: color.optional(),
  emissiveIntensity: finite.min(0).max(20).optional(),
  doubleSided: z.boolean().optional(),
  texture: textureSchema,
  /** Texture size used when exporting (preview uses smaller). */
  resolution: z.union([z.literal(256), z.literal(512), z.literal(1024)]).optional(),
  /** An imported image file (Model Studio file id) used as the colour map instead of the pattern's. */
  albedoFile: z.string().max(64).optional(),
  /**
   * A real texture set (Model Studio file ids): colour, tangent-space normal (OpenGL / glTF),
   * and occlusion-roughness-metalness packed in R/G/B as glTF reads it. Downloaded from a PBR
   * library or painted by the AI; replaces the procedural pattern.
   */
  maps: z.object({ albedo: z.string().max(64), normal: z.string().max(64).optional(), orm: z.string().max(64).optional() }).strict().optional(),
  /** Where the texture set came from (shown to the admin, kept with exports). */
  source: z.object({ kind: z.enum(['polyhaven', 'ai', 'upload']), id: z.string().max(120), name: z.string().max(200), license: z.string().max(40).optional(), url: z.string().max(400).optional() }).strict().optional(),
}).strict();
export type ModelMaterial = z.infer<typeof materialSchema>;

export const transformSchema = z.object({ position: vec3, rotation: vec3, scale: vec3 }).strict();
export type Transform = z.infer<typeof transformSchema>;

export const PRIMITIVE_SHAPES = ['box', 'cylinder', 'cone', 'sphere', 'plane', 'wedge', 'torus', 'capsule'] as const;
export type PrimitiveShape = (typeof PRIMITIVE_SHAPES)[number];

export const STAIR_SHAPES = ['straight', 'l', 'u', 'spiral'] as const;
export const STAIR_STYLES = ['solid', 'stringer', 'open'] as const;

export const OPENING_KINDS = ['door', 'window', 'arch', 'hole'] as const;
export const openingSchema = z.object({
  kind: z.enum(OPENING_KINDS),
  /** Centre along the wall from its middle (m). */
  offset: finite,
  width: finite.min(.1).max(20),
  height: finite.min(.1).max(20),
  /** Bottom of the opening above the wall's base (0 for doors). */
  sill: finite.min(0).max(20),
}).strict();
export type Opening = z.infer<typeof openingSchema>;

const params = z.record(z.string().max(32), finite);

const nodeBase = {
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(80),
  parent: z.string().max(64).nullable(),
  transform: transformSchema,
  visible: z.boolean().optional(),
  locked: z.boolean().optional(),
  /** How the part collides in game: its own triangles (`mesh`), not at all (`none`), or `auto` (by kind). */
  collision: z.enum(['auto', 'mesh', 'none']).optional(),
  tags: z.array(z.string().max(32)).max(16).optional(),
};

export const nodeSchema = z.discriminatedUnion('kind', [
  z.object({ ...nodeBase, kind: z.literal('group') }).strict(),
  z.object({ ...nodeBase, kind: z.literal('primitive'), shape: z.enum(PRIMITIVE_SHAPES), params, material: z.string().max(64) }).strict(),
  z.object({ ...nodeBase, kind: z.literal('rock'), params, material: z.string().max(64) }).strict(),
  z.object({
    ...nodeBase, kind: z.literal('wall'),
    length: finite.min(.05).max(200), height: finite.min(.05).max(60), thickness: finite.min(.02).max(4),
    openings: z.array(openingSchema).max(32),
    material: z.string().max(64),
    /** The other face's material (interior plaster on an exterior brick wall). */
    innerMaterial: z.string().max(64).optional(),
  }).strict(),
  z.object({
    ...nodeBase, kind: z.literal('roof'),
    style: z.enum(['gable', 'hip', 'shed', 'flat']),
    width: finite.min(.5).max(200), depth: finite.min(.5).max(200), rise: finite.min(0).max(40),
    overhang: finite.min(0).max(4), thickness: finite.min(.02).max(2),
    /** 0..1 share of roof panels missing (collapsed, rotted). */
    damage: finite.min(0).max(1), seed: z.number().int().min(0).max(0xffffffff),
    material: z.string().max(64),
  }).strict(),
  z.object({
    ...nodeBase, kind: z.literal('stairs'),
    width: finite.min(.3).max(20), rise: finite.min(.05).max(40), run: finite.min(.1).max(80), steps: z.number().int().min(1).max(200),
    material: z.string().max(64),
    /** Plan of the flight: straight; L (quarter turn at a landing); U (half turn); spiral round a post. */
    shape: z.enum(STAIR_SHAPES).optional(),
    /** solid (filled under), stringer (treads between two side beams), open (floating treads on a central beam). */
    style: z.enum(STAIR_STYLES).optional(),
    /** Which way an L/U/spiral turns going up. */
    turn: z.enum(['left', 'right']).optional(),
    /** Landing depth at the turn (m). */
    landing: finite.min(.5).max(6).optional(),
    treadThickness: finite.min(.02).max(.4).optional(),
    railing: z.boolean().optional(),
    /** Railing posts, balusters and beams (else the stairs material). */
    railMaterial: z.string().max(64).optional(),
    /** Tread and landing finish (granite, terrazzo, tiles, boards; else the stairs material). */
    treadMaterial: z.string().max(64).optional(),
    /** The handrail itself (varnished wood, steel tube; else the rail material). */
    handrailMaterial: z.string().max(64).optional(),
  }).strict(),
  z.object({
    ...nodeBase, kind: z.literal('slab'),
    /** Outline rectangle minus holes (stairwells), all axis-aligned in the slab's own space. */
    width: finite.min(.05).max(400), depth: finite.min(.05).max(400), thickness: finite.min(.01).max(4),
    holes: z.array(z.object({ x: finite, z: finite, width: finite.min(.05), depth: finite.min(.05) }).strict()).max(16),
    material: z.string().max(64),
    /** The underside (the ceiling of the room below; else the slab material). */
    bottomMaterial: z.string().max(64).optional(),
  }).strict(),
  /** A model of the game (asset registry): reused as it is, never copied or changed. */
  z.object({ ...nodeBase, kind: z.literal('asset'), asset: z.number().int().min(1).max(65535) }).strict(),
  /** A GLB/GLTF file imported into the project. */
  z.object({ ...nodeBase, kind: z.literal('import'), file: z.string().min(1).max(64), fileName: z.string().max(200).optional() }).strict(),
]);
export type ModelNode = z.infer<typeof nodeSchema>;

const pt = z.tuple([finite, finite]);
/**
 * A floor plan: the layout of one storey drawn before it is built — rooms (rectangles in plan,
 * x/z metres, several per L-shaped room), walls as centre lines with their openings, stairs and
 * the voids left for stairwells. The plan is shown in the 3D view at its elevation, checked
 * (closed rooms, reachable doors, climbable stairs, wells over flights), then built into parts.
 */
export const planSchema = z.object({
  level: z.number().int().min(-5).max(80),
  name: z.string().min(1).max(80),
  /** Height of this storey's finished floor (m). */
  elevation: finite.min(-20).max(400),
  /** Floor to ceiling (m). */
  height: finite.min(1.8).max(20),
  slab: finite.min(.05).max(1),
  /** The underside of this storey's slabs: the ceiling of the storey below (plaster, boards, exposed concrete). */
  ceilingMaterial: z.string().max(64).optional(),
  /**
   * Finishes of the storey's parts, each its own material: exterior plinth (base band), skirting
   * along the rooms, window frames, glazing, sills, door frames, door leaves. Absent: the part is
   * not made (no plinth, no skirting) or takes a plain default (frames and leaves in timber,
   * clear glass).
   */
  finishes: z.object({
    plinth: z.string().max(64).optional(), plinthHeight: finite.min(.1).max(1.5).optional(),
    skirting: z.string().max(64).optional(),
    windowFrame: z.string().max(64).optional(), glass: z.string().max(64).optional(), sill: z.string().max(64).optional(),
    doorFrame: z.string().max(64).optional(), doorLeaf: z.string().max(64).optional(),
  }).strict().optional(),
  rooms: z.array(z.object({ id: z.string().min(1).max(40), name: z.string().min(1).max(60), type: z.string().max(30), x0: finite, z0: finite, x1: finite, z1: finite, floorMaterial: z.string().max(64).optional() }).strict()).max(60),
  walls: z.array(z.object({
    id: z.string().min(1).max(40), a: pt, b: pt, thickness: finite.min(.05).max(2), height: finite.min(.3).max(30).optional(),
    material: z.string().max(64), innerMaterial: z.string().max(64).optional(), exterior: z.boolean(),
    openings: z.array(z.object({
      kind: z.enum(OPENING_KINDS), at: finite, width: finite.min(.2).max(20), height: finite.min(.2).max(20), sill: finite.min(0).max(20),
      /** Per-opening finishes (else the plan's `finishes`). */
      frameMaterial: z.string().max(64).optional(), glassMaterial: z.string().max(64).optional(), leafMaterial: z.string().max(64).optional(), sillMaterial: z.string().max(64).optional(),
      /** Doors: a leaf in the opening (default true), open by this many degrees. */
      leaf: z.boolean().optional(), open: finite.min(0).max(120).optional(),
    }).strict()).max(24),
    /** The wall's own plinth (exterior base band) material, else the plan's. */
    plinthMaterial: z.string().max(64).optional(),
  }).strict()).max(200),
  stairs: z.array(z.object({
    id: z.string().min(1).max(40), x: finite, z: finite, width: finite.min(.6).max(6),
    /** Compass direction the flight climbs: +z (s), −z (n), +x (e), −x (w). */
    direction: z.enum(['n', 's', 'e', 'w']),
    shape: z.enum(STAIR_SHAPES), style: z.enum(STAIR_STYLES), turn: z.enum(['left', 'right']).optional(),
    material: z.string().max(64), railing: z.boolean().optional(),
    treadMaterial: z.string().max(64).optional(), railMaterial: z.string().max(64).optional(), handrailMaterial: z.string().max(64).optional(),
  }).strict()).max(8),
  /** Openings in this floor (stairwells over the flight below). */
  voids: z.array(z.object({ x0: finite, z0: finite, x1: finite, z1: finite }).strict()).max(12),
  notes: z.string().max(2000).optional(),
  /** The group the plan was built into (absent: drawn, not built yet). */
  built: z.string().max(64).optional(),
}).strict();
export type FloorPlan = z.infer<typeof planSchema>;
export type NodeKind = ModelNode['kind'];

export const ASSET_KINDS = ['building', 'prop', 'rock', 'vegetation', 'furniture', 'vehicle', 'weapon', 'other'] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

export const modelDocSchema = z.object({
  version: z.literal(MODEL_DOC_VERSION),
  name: z.string().min(1).max(80),
  kind: z.enum(ASSET_KINDS),
  nodes: z.array(nodeSchema).max(4000),
  materials: z.array(materialSchema).max(128),
  /** Settlement lot class a published building fills (World Studio, map generation). */
  lotClass: z.enum(['residential', 'commercial', 'industrial', 'military', 'abandoned']).optional(),
  /** Storeys the building is designed with (above ground): the agent is not done before all are built. */
  storeys: z.number().int().min(1).max(40).optional(),
  /** The request the model was designed from: a later "go on" run reads it instead of starting over. */
  brief: z.string().max(4000).optional(),
  /** Floor plans, one per storey (drawn first, then built). */
  plans: z.array(planSchema).max(80).optional(),
  /** The material schedule: every material the model uses and where (decided before building). */
  schedule: z.array(z.object({ material: z.string().max(64), uses: z.array(z.string().max(80)).max(30), note: z.string().max(300).optional() }).strict()).max(128).optional(),
  notes: z.string().max(4000).optional(),
}).strict().superRefine((doc, ctx) => {
  const ids = new Set<string>();
  for (const n of doc.nodes) {
    if (ids.has(n.id)) ctx.addIssue({ code: 'custom', message: `duplicate node id ${n.id}` });
    ids.add(n.id);
  }
  const mats = new Set(doc.materials.map((m) => m.id));
  for (const n of doc.nodes) {
    if (n.parent !== null && !ids.has(n.parent)) ctx.addIssue({ code: 'custom', message: `${n.id}: unknown parent ${n.parent}` });
    for (const m of materialRefs(n)) if (!mats.has(m)) ctx.addIssue({ code: 'custom', message: `${n.id}: unknown material ${m}` });
  }
  // No cycles in the hierarchy.
  const parent = new Map(doc.nodes.map((n) => [n.id, n.parent]));
  for (const n of doc.nodes) {
    let at: string | null | undefined = n.parent, steps = 0;
    while (at && steps++ < 4000) { if (at === n.id) { ctx.addIssue({ code: 'custom', message: `${n.id}: parent cycle` }); break; } at = parent.get(at); }
  }
});
export type ModelDoc = z.infer<typeof modelDocSchema>;

export const identityTransform = (): Transform => ({ position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] });

export function emptyDoc(name = 'Model mới', kind: AssetKind = 'prop'): ModelDoc {
  return { version: MODEL_DOC_VERSION, name, kind, nodes: [], materials: [] };
}

/** A fresh id unique in the document (`prefix-N`). */
export function freshId(doc: { nodes: { id: string }[]; materials?: { id: string }[] }, prefix: string): string {
  const taken = new Set([...doc.nodes.map((n) => n.id), ...(doc.materials ?? []).map((m) => m.id)]);
  const base = prefix.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'node';
  for (let i = 1; ; i++) { const id = `${base}-${i}`; if (!taken.has(id)) return id; }
}

/** Every material a part uses (its main one and its other slots: inner face, underside, treads, rails…). */
export function materialRefs(n: ModelNode): string[] {
  const out: string[] = [];
  const r = n as Partial<Record<'material' | 'innerMaterial' | 'bottomMaterial' | 'treadMaterial' | 'railMaterial' | 'handrailMaterial', string>>;
  for (const k of ['material', 'innerMaterial', 'bottomMaterial', 'treadMaterial', 'railMaterial', 'handrailMaterial'] as const) if (r[k]) out.push(r[k]!);
  return out;
}

/** Children of a node (or the roots for `null`), in document order. */
export function childrenOf(doc: ModelDoc, id: string | null): ModelNode[] { return doc.nodes.filter((n) => n.parent === id); }

/** The node and everything under it. */
export function subtree(doc: ModelDoc, id: string): ModelNode[] {
  const out: ModelNode[] = [], stack = [id];
  while (stack.length) {
    const at = stack.pop()!, n = doc.nodes.find((x) => x.id === at);
    if (!n) continue;
    out.push(n);
    for (const c of doc.nodes) if (c.parent === at) stack.push(c.id);
  }
  return out;
}

/** Parses a document from storage or the network: throws with a readable list of problems. */
export function parseDoc(input: unknown): ModelDoc {
  const r = modelDocSchema.safeParse(input);
  if (!r.success) throw new Error(r.error.issues.slice(0, 8).map((i) => `${i.path.join('.') || 'doc'}: ${i.message}`).join('; '));
  return r.data;
}
