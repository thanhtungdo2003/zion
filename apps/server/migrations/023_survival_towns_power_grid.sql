-- Keep seeds and player data; rebuild survival towns along a main street, island flora and the roadside power grid.
UPDATE worlds SET generator_version = 7, updated_at = now() WHERE generator_version = 6;
