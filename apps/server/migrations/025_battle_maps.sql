-- Battle royale maps published from the World Studio (each is offered in the mode menu).
CREATE TABLE IF NOT EXISTS battle_maps (
  id text PRIMARY KEY,
  name text NOT NULL,
  thumbnail text,
  sea_level real NOT NULL DEFAULT 20,
  map jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
