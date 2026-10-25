-- Migration: client_deletions — a record of every client file deleted for good.
--
-- Additive only: one new table. Nothing existing is changed.
--
-- A permanent delete (DELETE /api/admin/clients/[id], from the Archive)
-- removes the client row and everything under it, including the archive
-- stamp. This keeps who deleted which client and when, and why it was
-- archived. Written before the client row is deleted: if it cannot be
-- written, nothing is deleted. client_id has no foreign key: the client it
-- names no longer exists.
--
-- ── Preflight (run before applying) ───────────────────────────────────────
--
--   -- No table of this name yet: 0 rows.
--   SELECT table_name
--     FROM information_schema.tables
--    WHERE table_schema = 'public' AND table_name = 'client_deletions';
--
--   -- The archive columns the route copies from (all three present).
--   SELECT column_name
--     FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'clients'
--      AND column_name IN ('archived_at', 'archived_by', 'archived_reason');
--
-- ── Post-apply ─────────────────────────────────────────────────────────────
--
--   -- The table, RLS on: rls_enabled = true.
--   SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled
--     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--    WHERE n.nspname = 'public' AND c.relname = 'client_deletions';
--
--   -- No policy: only the service role (server code) reads or writes it.
--   SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'client_deletions';
--
--   -- After a delete: who deleted which client, when.
--   SELECT cd.client_name, cd.deleted_by, cd.deleted_at, cd.archived_reason, cd.archived_by, cd.archived_at
--     FROM public.client_deletions cd
--    ORDER BY cd.deleted_at DESC;

CREATE TABLE IF NOT EXISTS public.client_deletions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The deleted client's id: no foreign key, the row is gone.
  client_id uuid NOT NULL,
  client_name text NOT NULL,
  deleted_by text NOT NULL,
  deleted_at timestamptz NOT NULL DEFAULT now(),
  -- The archive stamp as it was (a client is archived before it is deleted).
  archived_reason text,
  archived_by text,
  archived_at timestamptz
);

CREATE INDEX IF NOT EXISTS client_deletions_deleted_at_idx
  ON public.client_deletions (deleted_at DESC);

-- Server-side only (service role). No policy: no anon or client access.
ALTER TABLE public.client_deletions ENABLE ROW LEVEL SECURITY;
