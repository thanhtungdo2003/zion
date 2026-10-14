import type { AssetDefinitionInput } from './schema';

export const BATTLE_ASSET = { houseOne: 2200, houseTwo: 2201, door: 2202, plane: 2203, doorJamb: 2204, doorLintel: 2205, towerPost: 2206, waterTank: 2207, farmBed: 2208, crop: 2209, street: 2210, balconyPost: 2211, chimney: 2212, containerRed: 2213, containerGreen: 2214 } as const;
// Authored bounds: 30 × 28/41 × 25 units. Normalize to 10 × 4.8/7.2 × 8.33 metres.
// These closed models are solid scenery; loot belongs in the enterable modular buildings.
export const BATTLE_ASSETS: readonly AssetDefinitionInput[] = [
  ['house_one', 2200, 'nha-cu-1-tang', 28, 4.8],
  ['house_two', 2201, 'nha-cu-hai-tang', 41, 7.2],
].map<AssetDefinitionInput>(([id, numericId, file, authoredHeight, height]) => ({
  id: `battle.${id}`, numericId: numericId as number, name: String(id), category: 'structure',
  model: { kind: 'bbmodel', path: `materias/${file}.bbmodel`, unitsPerMeter: 3, axisScale: [1, Number(height) * 3 / Number(authoredHeight), 1], offset: [0, 0, 1 / 6] },
  colliders: [{ type: 'box', center: [0, Number(height) / 2, 0], halfExtents: [5, Number(height) / 2, 25 / 6] }],
  bounds: { radius: Math.hypot(5, 25 / 6), height: Number(height) }, render: { maxDistance: 800 }, tags: ['battle', 'closed-house'],
})).concat([
  {
    id: 'battle.balcony_post', numericId: 2211, name: 'Balcony support column', category: 'structure',
    model: { kind: 'procedural', generator: 'bridge_block', params: { width: .3, height: 3.2, depth: .3, color: '#77746c' } },
    colliders: [{ type: 'box', center: [0, 1.6, 0], halfExtents: [.15, 1.6, .15] }], bounds: { radius: .22, height: 3.2 }, render: { maxDistance: 650 },
  },
  {
    id: 'battle.wooden_door', numericId: 2202, name: 'Wooden door', category: 'structure',
    model: { kind: 'bbmodel', path: 'dists/wooden-door.bbmodel', unitsPerMeter: 16, axisScale: [1.6, 1, 1] },
    // Door movement is server-authoritative; the open leaf itself has no static collider.
    colliders: [], collisionLayer: 'none', bounds: { radius: 1.2, height: 2.2 }, render: { maxDistance: 300 }, tags: ['battle', 'door'],
  },
  {
    id: 'battle.transport_plane', numericId: 2203, name: 'Heavy transport plane', category: 'decor',
    model: { kind: 'bbmodel', path: 'dists/heavy-transport-plane.bbmodel', unitsPerMeter: 1.5, offset: [0, -19 / 1.5, 0] },
    colliders: [], collisionLayer: 'none', bounds: { radius: 48, height: 30 }, render: { maxDistance: 1800 }, tags: ['battle', 'plane'],
  },
  {
    id: 'battle.door_jamb', numericId: 2204, name: 'Door surround', category: 'structure',
    model: { kind: 'procedural', generator: 'bridge_block', params: { width: 1.1, height: 3.2, depth: .4, color: '#77746c' } },
    colliders: [{ type: 'box', center: [0, 1.6, 0], halfExtents: [.55, 1.6, .2] }], bounds: { radius: 1, height: 3.2 }, render: { maxDistance: 650 },
  },
  {
    id: 'battle.door_lintel', numericId: 2205, name: 'Door lintel', category: 'structure',
    model: { kind: 'procedural', generator: 'bridge_block', params: { width: 1.8, height: 1.075, depth: .4, color: '#77746c' } },
    colliders: [{ type: 'box', center: [0, .5375, 0], halfExtents: [.9, .5375, .2] }], bounds: { radius: 1, height: 1.075 }, render: { maxDistance: 650 },
  },
  {
    id: 'battle.tower_post', numericId: 2206, name: 'Steel tower support', category: 'structure',
    model: { kind: 'procedural', generator: 'bridge_block', params: { width: .25, height: 8, depth: .25, color: '#63594d' } },
    colliders: [{ type: 'box', center: [0, 4, 0], halfExtents: [.125, 4, .125] }], bounds: { radius: .2, height: 8 }, render: { maxDistance: 800 },
  },
  {
    id: 'battle.water_tank', numericId: 2207, name: 'Raised water reservoir', category: 'structure',
    model: { kind: 'procedural', generator: 'water_tank', params: {} },
    colliders: [{ type: 'box', center: [0, 1.6, 0], halfExtents: [1.9, 1.6, 1.9] }], bounds: { radius: 2.1, height: 3.6 }, render: { maxDistance: 1000 },
  },
  {
    id: 'battle.farm_bed', numericId: 2208, name: 'Cultivated soil row', category: 'decor',
    model: { kind: 'procedural', generator: 'bridge_block', params: { width: 3, height: .08, depth: 16, color: '#59442c' } },
    colliders: [], collisionLayer: 'none', bounds: { radius: 8.2, height: .08 }, render: { maxDistance: 650 },
  },
  {
    id: 'battle.crop', numericId: 2209, name: 'Farm crop', category: 'decor',
    model: { kind: 'procedural', generator: 'reeds', params: { height: 1.1 } },
    colliders: [], collisionLayer: 'none', bounds: { radius: .6, height: 1.3 }, render: { maxDistance: 250 },
  },
  {
    id: 'battle.street', numericId: 2210, name: 'Settlement street', category: 'decor',
    model: { kind: 'procedural', generator: 'bridge_block', params: { width: 8, height: .03, depth: 8, color: '#595955', topOrigin: true } },
    colliders: [], collisionLayer: 'none', bounds: { radius: 5.7, height: .03 }, render: { maxDistance: 800 },
  },
]);

/** Island kit additions: power station chimney and shipping containers. */
const ISLAND_EXTRAS: AssetDefinitionInput[] = [
  {
    id: 'battle.chimney', numericId: 2212, name: 'Power station chimney', category: 'structure',
    model: { kind: 'procedural', generator: 'bridge_block', params: { width: 7, height: 62, depth: 7, color: '#6d6862' } },
    colliders: [{ type: 'box', center: [0, 31, 0], halfExtents: [3.5, 31, 3.5] }], bounds: { radius: 5, height: 62 }, render: { maxDistance: 2400 }, tags: ['battle', 'power-plant'],
  },
  ...(['red', 'green'] as const).map((color, i): AssetDefinitionInput => ({
    // 43 × 22 × 19 authored units → a 6.1 × 2.6 × 2.45 m shipping container.
    id: `battle.container_${color}`, numericId: 2213 + i, name: `Shipping container (${color})`, category: 'structure',
    model: { kind: 'bbmodel', path: `buildings/old-${color}-zion-container.bbmodel`, unitsPerMeter: 7, axisScale: [1, .83, .89], offset: [-.21, 0, .08] },
    colliders: [{ type: 'box', center: [0, 1.3, 0], halfExtents: [3.07, 1.3, 1.22] }], bounds: { radius: 3.3, height: 2.6 }, render: { maxDistance: 700 }, tags: ['battle', 'port'],
  })),
];
(BATTLE_ASSETS as AssetDefinitionInput[]).push(...ISLAND_EXTRAS);
