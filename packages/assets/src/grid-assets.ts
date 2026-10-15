import type { AssetDefinitionInput } from './schema';

/**
 * The roadside power grid of the survival map: the camp utility pole knocked askew or lying in
 * the verge, and the ivy and moss that climb the poles. Permanent numeric ids.
 */
export const GRID_ASSET = { poleLeaning: 2480, poleFallen: 2481, ivy: 2482, ivyFallen: 2483 } as const;

/** How far a leaning pole is tipped over (radians); it leans along its local +X. */
export const POLE_LEAN = .38;
/** Height of the pole's top above its foot, unscaled (camp utility pole). */
const POLE_HEIGHT = 6;

const pole = { kind: 'bbmodel', path: 'materias/utility-pole.bbmodel', unitsPerMeter: 8 } as const;

export const GRID_ASSETS: readonly AssetDefinitionInput[] = [
  {
    id: 'grid.pole_leaning',
    numericId: GRID_ASSET.poleLeaning,
    name: 'leaning utility pole',
    category: 'block',
    model: { ...pole, rotation: [0, 0, -POLE_LEAN] },
    colliders: [
      { type: 'box', center: [0, .12, 0], halfExtents: [.5, .12, .5] },
      { type: 'capsule', a: [0, 0, 0], b: [Math.sin(POLE_LEAN) * POLE_HEIGHT, Math.cos(POLE_LEAN) * POLE_HEIGHT, 0], radius: .25 },
    ],
    bounds: { radius: 2.4, height: 6 },
    render: { maxDistance: 360 },
    tags: ['grid'],
  },
  {
    id: 'grid.pole_fallen',
    numericId: GRID_ASSET.poleFallen,
    name: 'fallen utility pole',
    category: 'block',
    // Lies along its local +X, half sunk into the verge; the cross-arm digs into the ground.
    model: { ...pole, rotation: [0, 0, -Math.PI / 2 + .06], offset: [0, .22, 0] },
    colliders: [{ type: 'capsule', a: [0, .25, 0], b: [5.6, .2, 0], radius: .25 }],
    bounds: { radius: 6, height: 1.6 },
    render: { maxDistance: 300 },
    tags: ['grid'],
  },
  {
    id: 'grid.ivy',
    numericId: GRID_ASSET.ivy,
    name: 'pole ivy',
    category: 'vegetation',
    model: { kind: 'procedural', generator: 'ivy', params: { height: 4.6 } },
    collisionLayer: 'none',
    bounds: { radius: .8, height: 5 },
    render: { sway: .08, castShadow: false, maxDistance: 140 },
    tags: ['grid', 'natural'],
  },
  {
    id: 'grid.ivy_fallen',
    numericId: GRID_ASSET.ivyFallen,
    name: 'fallen pole moss',
    category: 'vegetation',
    model: { kind: 'procedural', generator: 'ivy', params: { height: 5.4, lying: true } },
    collisionLayer: 'none',
    bounds: { radius: 3, height: .9 },
    render: { sway: .05, castShadow: false, maxDistance: 120 },
    tags: ['grid', 'natural'],
  },
];
