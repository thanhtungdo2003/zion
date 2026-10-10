-- New survivors start with 100 ZCoin. Existing balances are preserved.
ALTER TABLE player_states ALTER COLUMN coins SET DEFAULT 100;
