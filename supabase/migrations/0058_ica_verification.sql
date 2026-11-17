-- ============================================================
-- 0058 — ATO account files: verified against the ATO's own balance, or held back
-- ============================================================
--
-- Every ATO account file (activity statement, income tax, superannuation
-- guarantee; CSV or RBA ICA spreadsheet) is checked on upload by the ICA
-- engine (src/lib/ica): every window between printed balances must match the
-- change in the ATO's running balance to the cent, and the whole file must end
-- on the ATO's balance. Only a VERIFIED file's calculated figures are shown,
-- exported, or used by the prediction and CVL. Otherwise its rows are shown
-- exactly as printed, with "Totals being prepared", and the developer is
-- alerted (ica_alerts).
--
-- On lodgement_analyses and ato_account_analyses (same columns):
--   ica_status        'verified' | 'unverified' | 'empty' (no rows in the export); null = not checked yet
--   ica_balance       the ATO's balance the check proved (closing of its newest balance day)
--   ica_balance_date  that day
--   ica_check         what the check found: windows matched by each method, the windows that
--                     do not match (days, row positions, reason), why it is held, the RBA ICA
--                     spreadsheet comparison, Claude's proposals (status, generation id; no content)
--   ica_forced        accepted Claude readings: row position → counted, so a re-read is the same
--   ica_checked_at    when
--
-- ica_alerts: one row per unverified file, for the developer. Client id,
-- document id and the windows' dates and row counts only: no file name,
-- client name or row content (the email carries the same).
--
-- Add-only, nullable. Code that writes these must not be deployed before this
-- is applied. Re-run existing files afterwards: `npm run ica:rerun` (dry run),
-- then `ICA_RERUN_APPLY=yes npm run ica:rerun`.
--
-- ── Preflight ──────────────────────────────────────────────────────────────
--   SELECT column_name FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name IN ('lodgement_analyses', 'ato_account_analyses')
--      AND column_name LIKE 'ica_%';                                   -- 0 rows
--   SELECT to_regclass('public.ica_alerts');                           -- null
--
-- ── Post-apply ─────────────────────────────────────────────────────────────
--   SELECT count(*) FILTER (WHERE ica_status IS NULL) FROM public.lodgement_analyses;   -- every row, until the re-run

ALTER TABLE public.lodgement_analyses
  ADD COLUMN IF NOT EXISTS ica_status text CHECK (ica_status IN ('verified', 'unverified', 'empty')),
  ADD COLUMN IF NOT EXISTS ica_balance numeric(14, 2),
  ADD COLUMN IF NOT EXISTS ica_balance_date date,
  ADD COLUMN IF NOT EXISTS ica_check jsonb,
  ADD COLUMN IF NOT EXISTS ica_forced jsonb,
  ADD COLUMN IF NOT EXISTS ica_checked_at timestamptz;

ALTER TABLE public.ato_account_analyses
  ADD COLUMN IF NOT EXISTS ica_status text CHECK (ica_status IN ('verified', 'unverified', 'empty')),
  ADD COLUMN IF NOT EXISTS ica_balance numeric(14, 2),
  ADD COLUMN IF NOT EXISTS ica_balance_date date,
  ADD COLUMN IF NOT EXISTS ica_check jsonb,
  ADD COLUMN IF NOT EXISTS ica_forced jsonb,
  ADD COLUMN IF NOT EXISTS ica_checked_at timestamptz;

CREATE TABLE IF NOT EXISTS public.ica_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  document_id uuid REFERENCES public.documents(id) ON DELETE SET NULL,
  account_kind text,
  -- [{ "from": "2024-05-14", "to": "2024-05-24", "rows": 7, "reason": "no_reading_matches" }]
  windows jsonb NOT NULL DEFAULT '[]'::jsonb,
  hold_reasons text[] NOT NULL DEFAULT '{}',
  emailed_at timestamptz,
  email_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE INDEX IF NOT EXISTS ica_alerts_open_idx ON public.ica_alerts (client_id) WHERE resolved_at IS NULL;

ALTER TABLE public.ica_alerts ENABLE ROW LEVEL SECURITY;
