-- Keep world seeds and player data; regenerate roads with loops and elevated bridge decks.
UPDATE worlds SET generator_version = 4, updated_at = now() WHERE generator_version = 3;
