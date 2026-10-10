CREATE TABLE world_chests (
  world_id text NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  chest_id text NOT NULL,
  state jsonb NOT NULL DEFAULT '{"items":[],"searched":false,"revision":0}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (world_id, chest_id)
);
