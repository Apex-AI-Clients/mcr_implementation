-- ============================================================
-- 0066 — developer_alerts: technical problems go to the developer, not to staff screens
-- ============================================================
--
-- Gabby, 24 Nov 2026: no technical warning or error may appear on staff
-- screens (unrecognised Facebook form fields, reading failures, API errors,
-- health checks). Each goes to the developer alert email (ALERT_EMAIL) and is
-- kept here, once per problem while it is open (`key`), with ids and counts
-- only: never a name, an answer, a figure or a file name.
--
-- ica_alerts (0058) stays for client documents' proofs; this log takes what
-- has no client (a lead form) and the app's technical failures.
--
-- Service role only: RLS on, no policies. New table; nothing existing changes.
--
-- ── Preflight ──────────────────────────────────────────────────────────────
--   SELECT to_regclass('public.developer_alerts');   -- null

CREATE TABLE IF NOT EXISTS public.developer_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 'lead_form', 'statement_read', 'scan_read', 'portal_save', …
  kind text NOT NULL CHECK (length(kind) BETWEEN 1 AND 60),
  -- One open alert per key: "lead_form:1517286326904322:unmapped_key:which_state".
  key text NOT NULL CHECK (length(key) BETWEEN 1 AND 500),
  -- Ids and counts only.
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  emailed_at timestamptz,
  email_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS developer_alerts_open_key
  ON public.developer_alerts (key) WHERE resolved_at IS NULL;

ALTER TABLE public.developer_alerts ENABLE ROW LEVEL SECURITY;

-- ── Verify ─────────────────────────────────────────────────────────────────
--   SELECT relrowsecurity FROM pg_class WHERE oid = 'public.developer_alerts'::regclass;   -- true
