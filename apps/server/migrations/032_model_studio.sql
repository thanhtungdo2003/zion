-- Model Studio: editable model projects (the document is parameters, not triangles), their saved
-- versions (restore any of them), files imported into them (GLB/GLTF models, texture images),
-- and the models published into the game (GLB built from a project version, its asset
-- definition, registered at runtime under an id in 3000-3999).
CREATE TABLE IF NOT EXISTS model_projects (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  doc jsonb NOT NULL,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS model_project_versions (
  project_id uuid NOT NULL REFERENCES model_projects(id) ON DELETE CASCADE,
  version integer NOT NULL,
  doc jsonb NOT NULL,
  note text NOT NULL DEFAULT '',
  author text NOT NULL DEFAULT 'admin',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, version)
);

CREATE TABLE IF NOT EXISTS model_files (
  id uuid PRIMARY KEY,
  project_id uuid REFERENCES model_projects(id) ON DELETE SET NULL,
  name text NOT NULL,
  mime text NOT NULL,
  bytes bytea NOT NULL,
  size integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS model_assets (
  asset integer PRIMARY KEY CHECK (asset BETWEEN 3000 AND 3999),
  project_id uuid REFERENCES model_projects(id) ON DELETE SET NULL,
  project_version integer NOT NULL,
  name text NOT NULL,
  glb bytea NOT NULL,
  def jsonb NOT NULL,
  report jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS model_files_project ON model_files (project_id);
