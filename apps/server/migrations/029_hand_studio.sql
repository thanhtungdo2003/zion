-- Hand Studio: hand poses and hand / weapon animations. One row (id = 1) for the whole game.
CREATE TABLE IF NOT EXISTS hand_studio (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  data jsonb NOT NULL,
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
