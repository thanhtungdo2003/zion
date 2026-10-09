/**
 * Collision layers (what a collider *is*) and masks (what a query *hits*). A query hits a collider
 * when (collider.layer & query.mask) !== 0.
 */
export const Layer = {
  Terrain: 1 << 0,
  Static: 1 << 1,
  Vegetation: 1 << 2,
  Water: 1 << 3,
  Player: 1 << 4,
  Zombie: 1 << 5,
  Projectile: 1 << 6,
  Trigger: 1 << 7,
  Hitbox: 1 << 8,
} as const;

export type LayerName = keyof typeof Layer;

export const Mask = {
  /** Solid geometry a walking character cannot pass through. */
  CharacterMovement: Layer.Terrain | Layer.Static,
  /** Geometry that blocks line of sight / melee reach. */
  LineOfSight: Layer.Terrain | Layer.Static,
  /** What a bullet or melee swing can hit. */
  Weapon: Layer.Terrain | Layer.Static | Layer.Hitbox,
  /** Third-person camera obstruction (tree canopies and bushes pull the camera in too). */
  Camera: Layer.Terrain | Layer.Static | Layer.Vegetation,
  /** Everything that occupies space for placement / spawn validation. */
  Placement: Layer.Terrain | Layer.Static | Layer.Vegetation,
  All: 0xffffffff,
} as const;

export function layerFromName(name: LayerName): number {
  return Layer[name];
}
