-- Warfare on a World Studio map: the battlefield area, capture zones, bases, vehicle spawns and
-- match rules. Set from the World Studio without republishing the map (null: no Warfare).
ALTER TABLE battle_maps ADD COLUMN IF NOT EXISTS warfare jsonb;
