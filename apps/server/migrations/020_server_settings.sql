-- Operator switches changed from the Studio that must survive a restart (e.g. vehicle physics).
CREATE TABLE IF NOT EXISTS server_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
