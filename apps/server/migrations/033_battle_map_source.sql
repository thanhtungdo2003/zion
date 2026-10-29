-- The World Studio document a battle map was published from (regions, water, gameplay, flora —
-- the terrain itself is in `map`), so a published map can be opened again on any machine.
ALTER TABLE battle_maps ADD COLUMN IF NOT EXISTS source jsonb;
