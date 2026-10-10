CREATE TABLE world_teams (
  world_id text NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  team_id uuid NOT NULL,
  state jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (world_id, team_id)
);
