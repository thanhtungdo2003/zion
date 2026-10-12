import type { AssetDefinitionInput } from './schema';

export const VEHICLE_ASSET = { car: 2111, motorcycle: 2112, bus: 2113 } as const;

export const VEHICLE_ASSETS: readonly AssetDefinitionInput[] = [
  {
    id: 'vehicle.wrecked_car', numericId: VEHICLE_ASSET.car, name: 'Rusty wrecked car', category: 'decor',
    // 4.5 m long, 1.8 m body (2.4 m including open doors), 1.75 m including bent panels.
    model: { kind: 'bbmodel', path: 'materias/rusty-wrecked-car.bbmodel', unitsPerMeter: 16, axisScale: [1.6, 28 / 23, 2], offset: [0, 0, -.125] },
    colliders: [{ type: 'box', center: [0, .875, 0], halfExtents: [1.2, .875, 2.25] }],
    bounds: { radius: 2.55, height: 1.75 }, render: { maxDistance: 450 }, tags: ['vehicle', 'wreck'],
  },
  {
    id: 'vehicle.motorcycle', numericId: VEHICLE_ASSET.motorcycle, name: 'Rusty old motorcycle', category: 'decor',
    model: { kind: 'bbmodel', path: 'materias/rusty-old-motorcycle.bbmodel', unitsPerMeter: 16, axisScale: [.85 * 16 / 24, 1.25 * 16 / 27, 2.15 * 16 / 45], offset: [0, 0, 2.15 / 30] },
    colliders: [{ type: 'box', center: [0, .625, 0], halfExtents: [.425, .625, 1.075] }],
    bounds: { radius: 1.16, height: 1.25 }, render: { maxDistance: 400 }, tags: ['vehicle', 'wreck'],
  },
  {
    id: 'vehicle.school_bus', numericId: VEHICLE_ASSET.bus, name: 'Rusty school bus', category: 'decor',
    // This model's longitudinal axis is X; placement turns it to follow the road.
    model: { kind: 'bbmodel', path: 'materias/rusty-school-bus.bbmodel', unitsPerMeter: 16, axisScale: [10.5 * 16 / 51, 3.2 * 16 / 19, 2.5 * 16 / 19], offset: [-10.5 / 34, 0, 2.5 / 38] },
    colliders: [{ type: 'box', center: [0, 1.6, 0], halfExtents: [5.25, 1.6, 1.25] }],
    bounds: { radius: 5.4, height: 3.2 }, render: { maxDistance: 550 }, tags: ['vehicle', 'wreck'],
  },
];
