-- Account career is global: deliberately no world or mode key.
CREATE TABLE account_careers (
  account_id uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  score integer NOT NULL DEFAULT 0 CHECK (score >= 0),
  awarded_step smallint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE career_events (
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  event_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, event_id)
);
CREATE TABLE requisitions (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  reward jsonb NOT NULL,
  source text NOT NULL,
  quantity integer NOT NULL CHECK (quantity >= 0),
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX requisitions_account ON requisitions(account_id);
CREATE TABLE survival_requisitions (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  world_id text NOT NULL,
  reward jsonb NOT NULL,
  delivered boolean NOT NULL DEFAULT false
);
CREATE INDEX survival_requisitions_pending ON survival_requisitions(account_id, world_id) WHERE NOT delivered;
CREATE TABLE global_rank_config (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  config jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE player_states ADD COLUMN suspended_zombies jsonb NOT NULL DEFAULT '[]'::jsonb;
