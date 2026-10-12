-- Social sign-in retains the original account UUID and all character/progression data.
ALTER TABLE accounts DROP CONSTRAINT accounts_password_required;
CREATE TABLE account_identities (
  provider text NOT NULL CHECK (provider IN ('google', 'facebook')),
  subject text NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 255),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, subject),
  UNIQUE (account_id, provider)
);
