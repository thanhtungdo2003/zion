-- Drafts are isolated from published snapshots; editing never leaks unfinished copy.
CREATE TABLE news_posts (
  id uuid PRIMARY KEY,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  draft jsonb NOT NULL,
  published jsonb,
  published_revision integer,
  published_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES accounts(id) ON DELETE SET NULL,
  CHECK ((published IS NULL AND published_revision IS NULL AND published_at IS NULL)
    OR (published IS NOT NULL AND published_revision IS NOT NULL AND published_at IS NOT NULL))
);
CREATE INDEX news_posts_published ON news_posts(published_at DESC) WHERE published IS NOT NULL;
