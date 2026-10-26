-- Keep each world's seed and saved player data; enable seeded heightfield bedrock on v7 worlds.
-- The matching web/server build shares v8 collision heights and terrain geometry.
UPDATE worlds SET generator_version = 8, updated_at = now() WHERE generator_version = 7;
