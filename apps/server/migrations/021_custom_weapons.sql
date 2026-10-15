-- Weapons made in the Studio: definition (stats, hand points, view settings) and the model file.
CREATE TABLE IF NOT EXISTS custom_weapons (
  id text PRIMARY KEY,
  weapon_id smallint NOT NULL UNIQUE,
  def jsonb NOT NULL,
  model bytea NOT NULL,
  model_format text NOT NULL CHECK (model_format IN ('glb', 'bbmodel')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text
);
