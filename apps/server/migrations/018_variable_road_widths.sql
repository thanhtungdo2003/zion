-- Preserve seeds and player data while grading roads to their new variable widths.
UPDATE worlds SET generator_version = 5, updated_at = now() WHERE generator_version = 4;
