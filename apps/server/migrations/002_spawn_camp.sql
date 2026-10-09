-- Generation v2 adds the spawn compound and grades only its reserved footprint.
-- Saved player positions continue to be validated against collision when they join.
UPDATE worlds SET generator_version = 2, updated_at = now() WHERE generator_version = 1;
