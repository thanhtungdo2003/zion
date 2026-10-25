-- Map models uploaded in the Studio for Infection maps: the GLB and its asset definition
-- (centring offset, voxel colliders, bounds), registered at runtime under its asset id.
CREATE TABLE IF NOT EXISTS infection_map_models (
  asset integer PRIMARY KEY CHECK (asset BETWEEN 2900 AND 2999),
  name text NOT NULL,
  glb bytea NOT NULL,
  def jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
