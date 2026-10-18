import type { AssetDefinitionInput } from './schema';

/**
 * Building materials for masonry houses and concrete blocks (worldgen/masonry.ts): a red brick
 * course 2 m × 1 m (walls are stacked from it), and 3 m concrete panels in three finishes with
 * their window sill (0.9 m) and lintel (0.5 m) cut from the same panel.
 */
export const MATERIAL_ASSET = {
  brick: 2050,
  panel: { ivory: 2051, gray: 2052, darkred: 2053 },
  sill: { ivory: 2054, gray: 2055, darkred: 2056 },
  lintel: { ivory: 2057, gray: 2058, darkred: 2059 },
  /** Floor band: a slim moulding running round the house where one storey meets the next. */
  band: { concrete: 2060, brick: 2061 },
} as const;
export type ConcreteFinish = keyof typeof MATERIAL_ASSET.panel;

const FILE: Record<ConcreteFinish, string> = { ivory: 'ivory-concrete-slab', gray: 'ivory-concrete-slab-gray', darkred: 'ivory-concrete-slab-darkred' };

/** A 3 m wide concrete piece `h` metres tall (the authored panel is 3 × 3 m between y = 1 and 4). */
function concrete(id: string, numericId: number, name: string, finish: ConcreteFinish, h: number): AssetDefinitionInput {
  const k = h / 3;
  return {
    id, numericId, name, category: 'structure',
    model: { kind: 'bbmodel', path: `materias/${FILE[finish]}.bbmodel`, unitsPerMeter: 4, axisScale: [1, k, .25], offset: [0, -k, 0] },
    colliders: [{ type: 'box', center: [0, h / 2, 0], halfExtents: [1.5, h / 2, .125] }],
    bounds: { radius: 1.52, height: h }, render: { maxDistance: 700 }, tags: ['masonry', 'concrete'],
  };
}

export const MATERIAL_ASSETS: readonly AssetDefinitionInput[] = [
  {
    id: 'material.red_brick_wall', numericId: MATERIAL_ASSET.brick, name: 'Red brick wall course', category: 'structure',
    model: { kind: 'bbmodel', path: 'materias/red-brick-wall.bbmodel', unitsPerMeter: 16, axisScale: [1, 1, 1.5] },
    colliders: [{ type: 'box', center: [0, .5, 0], halfExtents: [1, .5, .19] }],
    bounds: { radius: 1.02, height: 1 }, render: { maxDistance: 600 }, tags: ['masonry', 'brick'],
  },
  ...([['concrete', 2060, 3, '#c8c2b6'], ['brick', 2061, 2, '#b8a88e']] as const).map(([kind, numericId, w, color]): AssetDefinitionInput => ({
    id: `material.floor_band_${kind}`, numericId, name: `Floor band (${kind})`, category: 'structure',
    model: { kind: 'procedural', generator: 'bridge_block', params: { width: w, height: .32, depth: .56, color } },
    colliders: [{ type: 'box', center: [0, .16, 0], halfExtents: [w / 2, .16, .28] }],
    bounds: { radius: w / 2 + .05, height: .32 }, render: { maxDistance: 600 }, tags: ['masonry'],
  })),
  ...(['ivory', 'gray', 'darkred'] as const).flatMap((f) => [
    concrete(`material.concrete_panel_${f}`, MATERIAL_ASSET.panel[f], `Concrete panel (${f})`, f, 3),
    concrete(`material.concrete_sill_${f}`, MATERIAL_ASSET.sill[f], `Concrete window sill (${f})`, f, .9),
    concrete(`material.concrete_lintel_${f}`, MATERIAL_ASSET.lintel[f], `Concrete lintel (${f})`, f, .5),
  ]),
];
