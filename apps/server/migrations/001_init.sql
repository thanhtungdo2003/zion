-- Accounts ---------------------------------------------------------------------------------------
CREATE TABLE accounts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username        text NOT NULL CHECK (char_length(username) BETWEEN 3 AND 24),
  username_lower  text GENERATED ALWAYS AS (lower(username)) STORED,
  password_hash   text,
  is_guest        boolean NOT NULL DEFAULT false,
  role            text NOT NULL DEFAULT 'player' CHECK (role IN ('player', 'moderator', 'admin')),
  failed_logins   integer NOT NULL DEFAULT 0,
  locked_until    timestamptz,
  banned_until    timestamptz,
  ban_reason      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_login_at   timestamptz,
  CONSTRAINT accounts_password_required CHECK (is_guest OR password_hash IS NOT NULL)
);
CREATE UNIQUE INDEX accounts_username_lower_key ON accounts (username_lower);

-- Refresh tokens (rotating, family-based reuse detection) -----------------------------------------
CREATE TABLE refresh_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  family_id   uuid NOT NULL,
  token_hash  bytea NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  replaced_by uuid,
  user_agent  text,
  ip          inet
);
CREATE INDEX refresh_tokens_account_idx ON refresh_tokens (account_id);
CREATE INDEX refresh_tokens_family_idx ON refresh_tokens (family_id);
CREATE INDEX refresh_tokens_expires_idx ON refresh_tokens (expires_at);

-- Worlds -----------------------------------------------------------------------------------------
CREATE TABLE worlds (
  id                text PRIMARY KEY,
  seed              bigint NOT NULL CHECK (seed BETWEEN 0 AND 4294967295),
  config            jsonb NOT NULL,
  generator_version integer NOT NULL,
  world_time_ms     bigint NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- Per-world character state ----------------------------------------------------------------------
CREATE TABLE player_states (
  account_id  uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  world_id    text NOT NULL REFERENCES worlds (id) ON DELETE CASCADE,
  pos_x       double precision NOT NULL,
  pos_y       double precision NOT NULL,
  pos_z       double precision NOT NULL,
  yaw         real NOT NULL DEFAULT 0,
  health      smallint NOT NULL DEFAULT 100 CHECK (health BETWEEN 0 AND 100),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, world_id)
);

-- Audit log (security-relevant events; append-only) ----------------------------------------------
CREATE TABLE audit_log (
  id          bigserial PRIMARY KEY,
  created_at  timestamptz NOT NULL DEFAULT now(),
  account_id  uuid REFERENCES accounts (id) ON DELETE SET NULL,
  event       text NOT NULL,
  severity    text NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warn', 'critical')),
  ip          inet,
  details     jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX audit_log_account_idx ON audit_log (account_id, created_at DESC);
CREATE INDEX audit_log_event_idx ON audit_log (event, created_at DESC);
