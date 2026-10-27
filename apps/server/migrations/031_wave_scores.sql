-- Zombie Wave Survival results: one row per finished match, ranked per map and board
-- (eight boards: four bot team sizes, four real-player party sizes). Boards are a column, not tables,
-- so a new map needs nothing here.
CREATE TABLE wave_scores (
  match_id text PRIMARY KEY,
  map_id text NOT NULL,
  play_mode text NOT NULL CHECK (play_mode IN ('bots', 'friends')),
  board text NOT NULL CHECK (board IN ('solo', 'duo_bot', 'trio_bot', 'squad_bot', 'solo_player', 'duo_players', 'trio_players', 'full_squad')),
  cleared integer NOT NULL CHECK (cleared >= 0),
  clear_ms bigint NOT NULL CHECK (clear_ms >= 0),
  survived_ms bigint NOT NULL CHECK (survived_ms >= 0),
  -- The same team (sorted account ids, bots by name) keeps only its best row on a board.
  team_key text NOT NULL,
  members jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX wave_scores_board ON wave_scores (map_id, board, cleared DESC, clear_ms ASC);
