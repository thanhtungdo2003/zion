-- Explicitly upgrade existing v2 worlds to lower mountains and graded dirt roads.
-- Keep seeds, inventories and account data; join-time placement validates saved positions.
UPDATE worlds SET generator_version = 3, updated_at = now() WHERE generator_version = 2;
