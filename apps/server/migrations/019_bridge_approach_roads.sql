-- Keep seeds and player data; rebuild widened, graded bridge approaches and road surfaces.
UPDATE worlds SET generator_version = 6, updated_at = now() WHERE generator_version = 5;
