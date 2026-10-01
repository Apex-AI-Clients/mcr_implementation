-- Migration: archive client files instead of destroying them.
--
-- A client file now leaves the SBR client list in one of two ways, and both put
-- it in the Archive rather than deleting it:
--
--   'client_deleted'  "Archive client" on the client page
--   'lead_deleted'    the lead it was converted from was deleted
--
-- From the Archive staff can make it a client again (clear the three columns)
-- or delete it permanently (the existing hard delete, now allowed only for an
-- archived file). Nothing else changes about an archived file: its documents,
-- company and accountant details stay exactly as they were, so a restore puts
-- back everything.
--
-- No backfill: every existing client is active.

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  -- Who archived it, as staffAuthorName() gives it. Display only.
  ADD COLUMN IF NOT EXISTS archived_by text,
  ADD COLUMN IF NOT EXISTS archived_reason text;

ALTER TABLE public.clients
  DROP CONSTRAINT IF EXISTS clients_archived_reason_check,
  ADD CONSTRAINT clients_archived_reason_check
    CHECK (archived_reason IN ('client_deleted', 'lead_deleted'));

-- Archived and its reason go together: both set, or both clear.
ALTER TABLE public.clients
  DROP CONSTRAINT IF EXISTS clients_archived_consistent,
  ADD CONSTRAINT clients_archived_consistent
    CHECK ((archived_at IS NULL) = (archived_reason IS NULL));

-- The Archive lists archived files newest first; the client list wants the rest.
CREATE INDEX IF NOT EXISTS idx_clients_archived_at
  ON public.clients(archived_at DESC)
  WHERE archived_at IS NOT NULL;
