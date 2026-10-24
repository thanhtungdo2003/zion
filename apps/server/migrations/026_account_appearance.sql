-- The survivor's look chosen in the character creator (hair, outfit, face and body). NULL until
-- the player has made their character: the client then opens the creator before the first match.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS appearance jsonb;
