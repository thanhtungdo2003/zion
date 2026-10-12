import type { AssetDefinitionInput } from './schema';

/** Stable IDs, separate from the camp kit. Deck origins are on the driving surface. */
export const BRIDGE_ASSET = {
  asphalt: 2100, moss: 2101, moss2: 2102, moss3: 2103,
  smallAsphalt: 2104, smallMoss: 2105, steelPier: 2106,
  woodenDeck: 2107, stoneDeck: 2108, stonePier: 2109, laneMark: 2110,
} as const;

const deck = (id: string, numericId: number, file: string, units: number): AssetDefinitionInput => {
  const half = 8 / units, thickness = 5 / units;
  return {
    id: `bridge.${id}`, numericId, name: id, category: 'structure',
    model: { kind: 'bbmodel', path: `materias/${file}.bbmodel`, unitsPerMeter: units, offset: [0, -thickness, 0] },
    // Moss is decorative: a single flat collider avoids snagging wheels and feet.
    colliders: [{ type: 'box', center: [0, -thickness / 2, 0], halfExtents: [half, thickness / 2, half] }],
    bounds: { radius: Math.SQRT2 * half, height: thickness + 7 / units },
    render: { maxDistance: 650 }, tags: ['bridge', 'bridge-deck'],
  };
};

const block = (id: string, numericId: number, width: number, height: number, depth: number, color: string, deckPart = false): AssetDefinitionInput => ({
  id: `bridge.${id}`, numericId, name: id, category: 'structure',
  model: { kind: 'procedural', generator: 'bridge_block', params: { width, height, depth, color, topOrigin: deckPart } },
  colliders: id === 'lane_mark' ? [] : [{ type: 'box', center: [0, (deckPart ? -1 : 1) * height / 2, 0], halfExtents: [width / 2, height / 2, depth / 2] }],
  collisionLayer: id === 'lane_mark' ? 'none' : 'static',
  bounds: { radius: Math.hypot(width, depth) / 2, height }, render: { maxDistance: 650 },
  tags: ['bridge', ...(deckPart ? ['bridge-deck'] : [])],
});

export const BRIDGE_ASSETS: readonly AssetDefinitionInput[] = [
  deck('asphalt', 2100, 'asphalt-concrete-slab', 4),
  deck('moss', 2101, 'asphalt-concrete-slab-moss', 4),
  deck('moss2', 2102, 'asphalt-concrete-slab-moss-2', 4),
  deck('moss3', 2103, 'asphalt-concrete-slab-moss-3', 4),
  deck('small_asphalt', 2104, 'asphalt-concrete-slab', 8),
  deck('small_moss', 2105, 'asphalt-concrete-slab-moss-3', 8),
  {
    id: 'bridge.steel_pier', numericId: 2106, name: 'Red primer steel pier', category: 'structure',
    model: { kind: 'bbmodel', path: 'materias/red-primer-steel-column.bbmodel', unitsPerMeter: 4 },
    colliders: [{ type: 'box', center: [0, 6, 0], halfExtents: [1, 6, 1] }],
    bounds: { radius: Math.SQRT2, height: 12 }, render: { maxDistance: 650 }, tags: ['bridge', 'bridge-pier'],
  },
  block('wooden_deck', 2107, 2, .24, 2, '#756047', true),
  block('stone_deck', 2108, 2, .6, 2, '#77766b', true),
  block('stone_pier', 2109, 2, 3, 2, '#77766b'),
  block('lane_mark', 2110, .14, .012, 2, '#b9ab71'),
];
