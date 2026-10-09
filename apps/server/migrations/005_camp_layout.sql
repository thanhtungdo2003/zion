-- Camp Studio: an edited camp layout (camp-local parts) replacing the generated default.
CREATE TABLE IF NOT EXISTS camp_layouts (
  world_id    text PRIMARY KEY,
  layout      jsonb NOT NULL,
  updated_by  uuid,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
