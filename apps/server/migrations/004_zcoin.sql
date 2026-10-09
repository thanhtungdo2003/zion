-- ZCoin wallet (gold coins), kept per world with the rest of the player state.
ALTER TABLE player_states ADD COLUMN IF NOT EXISTS coins integer NOT NULL DEFAULT 500 CHECK (coins >= 0);
