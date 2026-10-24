-- Gear fitting from the Studio: hand adjustments of worn / carried models and their painted soft
-- regions. One row (id = 1) for the whole game.
CREATE TABLE IF NOT EXISTS gear_fit (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  data jsonb NOT NULL,
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
