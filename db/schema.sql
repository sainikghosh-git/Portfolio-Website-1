-- Run this once in the Neon console (or via psql) to create the inbox table.

CREATE TABLE IF NOT EXISTS messages (
  id         BIGSERIAL PRIMARY KEY,
  name       TEXT        NOT NULL,
  email      TEXT        NOT NULL,
  subject    TEXT        NOT NULL DEFAULT '',
  message    TEXT        NOT NULL,
  is_read    BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Supports the inbox query (newest first, paginated).
CREATE INDEX IF NOT EXISTS messages_created_at_idx ON messages (created_at DESC);