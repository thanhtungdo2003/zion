-- The game modes a World Studio map is published for (a battlefield need not be a battle royale
-- map). Maps published before stay battle royale maps.
ALTER TABLE battle_maps ADD COLUMN IF NOT EXISTS modes text[] NOT NULL DEFAULT '{battle-royale}';
