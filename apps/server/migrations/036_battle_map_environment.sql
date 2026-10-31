-- The environment of a World Studio map: weather, sky, grade and local climate zones. Set from
-- the World Studio without republishing the map (null: the default environment).
ALTER TABLE battle_maps ADD COLUMN IF NOT EXISTS environment jsonb;
