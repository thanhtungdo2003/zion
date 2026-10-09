ALTER TABLE player_states ADD COLUMN IF NOT EXISTS quest_journal jsonb NOT NULL DEFAULT '{}';
CREATE TABLE IF NOT EXISTS game_content (
  world_id text PRIMARY KEY REFERENCES worlds(id) ON DELETE CASCADE,
  content jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS world_base_life (
  world_id text PRIMARY KEY REFERENCES worlds(id) ON DELETE CASCADE,
  state jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE player_states ADD COLUMN IF NOT EXISTS life_state jsonb NOT NULL DEFAULT '{}';
