-- Survival base building: structures players placed from blueprints (health per piece).
ALTER TABLE worlds ADD COLUMN IF NOT EXISTS structures jsonb NOT NULL DEFAULT '[]'::jsonb;
