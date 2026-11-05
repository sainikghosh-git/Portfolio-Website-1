-- ============================================================
-- Supabase: Contact Messages Table
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- ============================================================

-- Enable the UUID extension (already on by default in Supabase)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ──────────────────────────────────────────────────────────────
-- Table: messages
-- Stores every contact form submission from the portfolio site.
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.messages (
  id          UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  -- Form fields
  name        TEXT          NOT NULL CHECK (char_length(name)    BETWEEN 2 AND 80),
  email       TEXT          NOT NULL CHECK (char_length(email)   BETWEEN 5 AND 254),
  subject     TEXT                   CHECK (char_length(subject) <= 120),
  message     TEXT          NOT NULL CHECK (char_length(message) BETWEEN 10 AND 2000),

  -- Server-added metadata (may be NULL if behind certain proxies)
  ip          INET,
  user_agent  TEXT          CHECK (char_length(user_agent) <= 512),

  -- Admin workflow
  read        BOOLEAN       NOT NULL DEFAULT FALSE,
  archived    BOOLEAN       NOT NULL DEFAULT FALSE,
  replied_at  TIMESTAMPTZ,
  notes       TEXT          -- private admin notes, never shown to sender
);

-- ──────────────────────────────────────────────────────────────
-- Indexes
-- ──────────────────────────────────────────────────────────────

-- Admin inbox: show newest unread first
CREATE INDEX IF NOT EXISTS messages_created_at_idx ON public.messages (created_at DESC);

-- Quick filter: unread messages only
CREATE INDEX IF NOT EXISTS messages_read_idx       ON public.messages (read)       WHERE read = FALSE;

-- Quick filter: non-archived only
CREATE INDEX IF NOT EXISTS messages_archived_idx   ON public.messages (archived)   WHERE archived = FALSE;

-- ──────────────────────────────────────────────────────────────
-- Row Level Security (RLS)
-- ──────────────────────────────────────────────────────────────

-- Enable RLS — no one can read/write unless a policy allows it.
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- PUBLIC: allow anonymous INSERT only (the contact form).
-- No SELECT/UPDATE/DELETE is allowed from the browser.
CREATE POLICY "public_can_insert_messages"
  ON public.messages
  FOR INSERT
  TO anon
  WITH CHECK (true);

-- SERVICE ROLE: the Vercel /api/contact function runs with the service-role
-- key, which bypasses RLS entirely — no extra policy needed for that.

-- AUTHENTICATED (admin): only a signed-in user can read or update messages.
-- Connect your Supabase Auth user to the admin panel to use this.
CREATE POLICY "admin_can_select_messages"
  ON public.messages
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "admin_can_update_messages"
  ON public.messages
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ──────────────────────────────────────────────────────────────
-- Verify
-- ──────────────────────────────────────────────────────────────
-- SELECT * FROM public.messages ORDER BY created_at DESC LIMIT 10;
