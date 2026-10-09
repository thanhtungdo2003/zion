-- Server-authoritative inventory: each player's items (grid placement, counts, magazines).
ALTER TABLE player_states ADD COLUMN IF NOT EXISTS inventory jsonb;
