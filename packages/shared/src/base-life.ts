import { z } from 'zod';
import { isStash, type PlacedItem } from './inventory';
const id = z.string().regex(/^[a-z0-9_]{1,40}$/);
const positive = z.number().finite().positive();
const quantity = z.number().int().min(1).max(999);
const spot = { x: z.number().finite().min(-70).max(70), z: z.number().finite().min(-70).max(70) };
const model = z.string().regex(/^\/models\/[a-z0-9_/-]+\.bbmodel$/);
export const baseLifeSchema = z.object({
  itemModels: z.record(model).optional(),
  locations: z.array(z.object({ id, x: z.number().finite(), z: z.number().finite(), radius: positive.max(1000) }).strict()).max(200).optional(),
  /** Camp warehouse (camp-local): personal storage opens within `radius`. */
  storage: z.object({ x: z.number().finite(), z: z.number().finite(), radius: positive.max(20) }).strict().optional(),
  plantingMs: z.number().int().min(100).max(60_000),
  /** Standing still this long digs up a ripe crop (default 3 s). */
  harvestMs: z.number().int().min(100).max(60_000).optional(),
  interactionRange: positive.max(10),
  growthTickMs: z.number().int().min(100).max(3_600_000),
  crops: z.array(z.object({ id, item: id, stages: z.array(model).min(2).max(10), probability: z.number().min(0).max(1), yieldItem: id, yield: quantity }).strict()).max(20),
  plots: z.array(z.object({ id, ...spot, model }).strict()).max(100),
  decorations: z.array(z.object({ id, ...spot, model }).strict()).max(100).optional(),
  stations: z.array(z.object({ id, ...spot, model }).strict()).max(20),
  recipes: z.array(z.object({ id, input: id, output: id, durationMs: z.number().int().min(100).max(60_000) }).strict()).max(30),
  trades: z.array(z.object({ id, npc: id, item: id, buy: z.number().int().min(0).max(100_000), sell: z.number().int().min(0).max(100_000), quota: quantity, windowMs: positive, cooldownMs: positive }).strict()).max(100),
  animals: z.array(z.object({ id, ...spot, model, health: quantity.max(100), speed: positive.max(10), runSpeed: positive.max(15), range: positive.max(100), wanderRadius: positive.max(20), retaliation: z.number().min(0).max(1), damage: z.number().int().min(0).max(100), attackRange: positive.max(5), attackMs: positive, lootItem: id, lootMin: quantity, lootMax: quantity, attackAnimation: z.string().max(60),
    /** How many of this animal live in the pen, its camp-local bounds, and the respawn delay. */
    count: z.number().int().min(1).max(10).optional(), pen: z.object({ minX: z.number().finite(), maxX: z.number().finite(), minZ: z.number().finite(), maxZ: z.number().finite() }).strict().optional(), respawnMs: z.number().int().min(1000).max(3_600_000).optional() }).strict()).max(50).optional(),
  /** `saturationMs`: how long after eating stamina capacity stops draining (raw food: short). */
  foods: z.array(z.object({ item: id, recovery: positive, saturationMs: z.number().int().min(0).max(3_600_000).optional() }).strict()).max(50).optional(),
  stamina: z.object({ maximum: positive, minimumCapacity: positive, sprintPerSecond: positive, attack: positive, roll: positive, regeneration: positive, capacityDecay: z.number().min(0).max(1), foodRecovery: positive, rollCooldown: positive.max(30) }).strict(),
}).strict();
export type BaseLifeConfig = z.infer<typeof baseLifeSchema>;
export interface CookingBatch {
  entries: Array<{ recipe: string; input: string; output: string; uids: number[] }>;
  quantity: number;
  durationMs: number;
}

/** One batch contains every cookable item currently carried; each ingredient is used once. */
export function planCooking(config: BaseLifeConfig, items: readonly PlacedItem[]): CookingBatch | null {
  const entries: CookingBatch['entries'] = [];
  const usedInputs = new Set<string>();
  let quantity = 0;
  let durationMs = 0;
  for (const recipe of config.recipes) {
    if (usedInputs.has(recipe.input)) continue;
    usedInputs.add(recipe.input);
    const uids = items.filter((i) => i.itemId === recipe.input && !i.issued && !isStash(i.container)).map((i) => i.uid);
    if (!uids.length) continue;
    entries.push({ recipe: recipe.id, input: recipe.input, output: recipe.output, uids });
    quantity += uids.length;
    durationMs += recipe.durationMs * uids.length;
  }
  return quantity ? { entries, quantity, durationMs } : null;
}
/** Livestock pen (camp-local, inside its wooden fence at x −44…−36, z −9…3). */
const PEN = { minX: -43.2, maxX: -36.8, minZ: -8.2, maxZ: 2.2 };
export const DEFAULT_BASE_LIFE: BaseLifeConfig = {
  itemModels: { potato: '/models/materias/potato.bbmodel', potato_cooked: '/models/materias/potato-cooked.bbmodel', raw_mutton: '/models/materias/raw-mutton.bbmodel', raw_porkchop: '/models/materias/raw-porkchop.bbmodel', cooked_mutton: '/models/materias/cooked-mutton.bbmodel', cooked_porkchop: '/models/materias/cooked-porkchop.bbmodel', nuclear_cell: '/models/materias/nuclear-power-cell.bbmodel', coal_carton: '/models/materias/coal-in-old-carton.bbmodel' },
  locations: [],
  storage: { x: 27, z: -9, radius: 5.5 },
  plantingMs: 4000, harvestMs: 3000, interactionRange: 2.5, growthTickMs: 10_000,
  crops: [{ id: 'potato', item: 'potato', stages: ['/models/plains/potato-field-plants-0.bbmodel', '/models/plains/potato-field-plants-1.bbmodel', '/models/plains/potato-field-plants-done.bbmodel'], probability: 0.35, yieldItem: 'potato', yield: 4 }],
  // 5 × 5 touching 1.5 m plots filling the fenced garden (x −41…−33, z −21…−13).
  plots: Array.from({ length: 25 }, (_, i) => ({ id: `plot_${i}`, x: -40 + (i % 5) * 1.5, z: -20 + Math.floor(i / 5) * 1.5, model: (i + Math.floor(i / 5)) % 2 ? '/models/dists/wet-farmland-plot-unpipe.bbmodel' : '/models/dists/wet-farmland-plot.bbmodel' })),
  // The kitchen counter is a camp object now (placed in the layout, with collision).
  decorations: [],
  stations: [{ id: 'campfire', x: -24, z: 33, model: '/models/materias/campfire-embers.bbmodel' }],
  recipes: [{ id: 'mutton', input: 'raw_mutton', output: 'cooked_mutton', durationMs: 4000 }, { id: 'pork', input: 'raw_porkchop', output: 'cooked_porkchop', durationMs: 4000 }, { id: 'potato', input: 'potato', output: 'potato_cooked', durationMs: 4000 }],
  trades: [
    ...['potato', 'raw_mutton', 'raw_porkchop'].map((item) => ({ id: `farmer_${item}`, npc: 'farmer', item, buy: 20, sell: 8, quota: 16, windowMs: 86_400_000, cooldownMs: 3_600_000 })),
    // The chef sells hot food (and buys it back cheaply).
    ...['potato_cooked', 'cooked_mutton', 'cooked_porkchop'].map((item) => ({ id: `chef_${item}`, npc: 'chef', item, buy: item === 'potato_cooked' ? 30 : 45, sell: 12, quota: 12, windowMs: 86_400_000, cooldownMs: 3_600_000 })),
  ],
  animals: [{ id: 'sheep', x: -41, z: -5, model: '/models/mobs/suffolk-sheep.bbmodel', health: 45, speed: 1, runSpeed: 4, range: 14, wanderRadius: 3, retaliation: 0, damage: 0, attackRange: 1.8, attackMs: 1500, lootItem: 'raw_mutton', lootMin: 3, lootMax: 5, attackAnimation: '', count: 3, pen: PEN, respawnMs: 10_000 }, { id: 'boar', x: -39, z: -1, model: '/models/mobs/tamed-wild-boar.bbmodel', health: 65, speed: 1.4, runSpeed: 5, range: 18, wanderRadius: 3, retaliation: 0.8, damage: 1, attackRange: 1.8, attackMs: 1200, lootItem: 'raw_porkchop', lootMin: 3, lootMax: 5, attackAnimation: 'snout_nudge', count: 3, pen: PEN, respawnMs: 10_000 }],
  foods: [
    ...['potato_cooked', 'cooked_mutton', 'cooked_porkchop'].map((item) => ({ item, recovery: 20, saturationMs: 120_000 })),
    // Raw food fills a little and wears off fast.
    ...['potato', 'raw_mutton', 'raw_porkchop'].map((item) => ({ item, recovery: 6, saturationMs: 15_000 })),
  ],
  stamina: { maximum: 100, minimumCapacity: 30, sprintPerSecond: 10, attack: 5, roll: 20, regeneration: 25, capacityDecay: 0.015, foodRecovery: 20, rollCooldown: 3 },
};
