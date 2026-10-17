import type { AssetDefinitionInput } from './schema';

/**
 * Street kit (Infection's "The Street"): plain boxes at true human scale. Houses are built from
 * 1 m wall pieces on 3.2 m storeys, so doors (1.0 × 2.4 m) and French windows (1.85 m clear above a
 * 0.6 m sill) are real openings a player walks or climbs through, and colliders match the boxes.
 */
export const STREET_ASSET = {
  wallA: 2500, sillA: 2501, headA: 2502, parapetA: 2503,
  wallB: 2504, sillB: 2505, headB: 2506, parapetB: 2507,
  wallC: 2508, sillC: 2509, headC: 2510, parapetC: 2511,
  slab: 2512, roof: 2513, step: 2514, balcony: 2515,
  sidewalk: 2516, curb: 2517, laneDash: 2518, zebra: 2519,
  trafficPole: 2520, trafficArm: 2521, trafficHead: 2522, lampRed: 2523, lampAmber: 2524, lampGreen: 2525,
  wreckCar: 2526, awning: 2527, plank: 2528, crate: 2529,
} as const;

/** Storey height, slab thickness and the wall heights that make the openings. */
export const STREET_KIT = { storey: 3.2, slab: .2, wall: 3, sill: .6, head: .35, door: 2.4 } as const;

type Box = [id: string, numericId: number, name: string, w: number, h: number, d: number, color: string, solid?: boolean];
const PALETTES: Array<[string, string]> = [['a', '#b7a58a'], ['b', '#8d969b'], ['c', '#9a5b4a']];
const boxes: Box[] = [
  ...PALETTES.flatMap(([p, color], i): Box[] => [
    [`street.wall_${p}`, 2500 + i * 4, `Wall ${p}`, 1, STREET_KIT.wall, .2, color],
    [`street.sill_${p}`, 2501 + i * 4, `Window sill ${p}`, 1, STREET_KIT.sill, .2, color],
    [`street.head_${p}`, 2502 + i * 4, `Lintel ${p}`, 1, STREET_KIT.head, .2, color],
    [`street.parapet_${p}`, 2503 + i * 4, `Parapet ${p}`, 1, 1, .2, color],
  ]),
  ['street.slab', 2512, 'Floor slab', 2, STREET_KIT.slab, 2, '#6e6a63'],
  ['street.roof', 2513, 'Roof slab', 2, STREET_KIT.slab, 2, '#4f4c48'],
  ['street.step', 2514, 'Stair step', 1.2, .2, .32, '#76716a'],
  ['street.balcony', 2515, 'Balcony slab', 1, .18, 1.2, '#7c776f'],
  ['street.sidewalk', 2516, 'Sidewalk', 2, .15, 2, '#8b8780'],
  ['street.curb', 2517, 'Curb', 2, .18, .25, '#b0aca3'],
  ['street.lane_dash', 2518, 'Lane marking', .15, .02, 2, '#d9d4c3', false],
  ['street.zebra', 2519, 'Zebra stripe', .5, .02, 3, '#e3dfd0', false],
  ['street.traffic_pole', 2520, 'Traffic light pole', .18, 4.4, .18, '#2b2f31'],
  ['street.traffic_arm', 2521, 'Traffic light arm', 3.2, .14, .14, '#2b2f31'],
  ['street.traffic_head', 2522, 'Traffic light', .42, 1.15, .32, '#1c1f20'],
  ['street.lamp_red', 2523, 'Red light', .26, .26, .06, '#ff2b22', false],
  ['street.lamp_amber', 2524, 'Amber light', .26, .26, .06, '#ffb000', false],
  ['street.lamp_green', 2525, 'Green light', .26, .26, .06, '#2bd46a', false],
  ['street.awning', 2527, 'Shop awning', 1, .08, 1.4, '#7a2e26'],
  ['street.plank', 2528, 'Plank bridge', 1, .12, 1, '#756047'],
  ['street.crate', 2529, 'Crate stack', 1.2, 1.2, 1.2, '#6a5434'],
];

export const STREET_ASSETS: readonly AssetDefinitionInput[] = [
  ...boxes.map(([id, numericId, name, w, h, d, color, solid = true]): AssetDefinitionInput => ({
    id, numericId, name, category: 'structure',
    model: { kind: 'procedural', generator: 'bridge_block', params: { width: w, height: h, depth: d, color } },
    colliders: solid ? [{ type: 'box', center: [0, h / 2, 0], halfExtents: [w / 2, h / 2, d / 2] }] : [],
    ...(solid ? {} : { collisionLayer: 'none' as const }),
    bounds: { radius: Math.hypot(w, d) / 2, height: h }, render: { maxDistance: 500 }, tags: ['street'],
  })),
  {
    // An abandoned Lada on the road: the drivable car's model, solid, bonnet and roof to climb on.
    id: 'street.wreck_car', numericId: 2526, name: 'Wrecked car', category: 'structure',
    model: { kind: 'glb', path: 'prepared/drive_car.glb' },
    colliders: [
      { type: 'box', center: [0, .45, 0], halfExtents: [.8, .38, 2.15] },
      { type: 'box', center: [0, 1.05, .25], halfExtents: [.72, .25, 1.05] },
    ],
    bounds: { radius: 2.3, height: 1.5 }, render: { maxDistance: 350 }, tags: ['street'],
  },
];
