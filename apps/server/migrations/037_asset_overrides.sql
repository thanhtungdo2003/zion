-- Game models managed from the Model Studio's "Tài nguyên game" tab: an existing model replaced
-- by another file, a new model mixed in among an existing one's instances, or a model hidden.
CREATE TABLE IF NOT EXISTS asset_overrides (
  id          serial PRIMARY KEY,
  base        integer NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('replace', 'variant', 'hide')),
  name        text NOT NULL DEFAULT '',
  weight      real NOT NULL DEFAULT 1,
  glb         bytea,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS asset_overrides_base ON asset_overrides (base);
