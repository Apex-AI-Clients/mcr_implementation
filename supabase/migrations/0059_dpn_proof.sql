-- ============================================================
-- 0059 — Director penalty notices: proven, or held back
-- ============================================================
--
-- A notice is used only when it is proven (src/lib/dpn/proof.ts): on every
-- row Column 3 = Column 4 + Column 5 to the cent, its totals are its rows'
-- sums, its type, issue date and ACN were read, and, when an ATO account
-- verified against the ATO's own balance is on file (0058), each period's
-- Column 2 equals what that account shows for the period and tax type. A
-- period outside the ATO export is listed, not a mismatch.
--
-- The pages work the proof out each time they are opened (so a later ATO
-- upload updates it); what is stored here is for alerting the developer once
-- when a notice becomes unverified, and for the client page's documents list.
--
--   proof_status      'verified' | 'unverified'; null = not checked yet
--   proof_check       what the proof found: rows that do not add up (periods), the
--                     cross-check (periods matched, outside the export, mismatched periods)
--   proof_checked_at  when
--
-- ica_alerts (0058) gains document_kind, so one alert log serves every document:
--   'ato_account' (the default, every existing row) | 'dpn' | 'statement'
--
-- Add-only, nullable or defaulted. Code that writes these must not be deployed
-- before this is applied.
--
-- ── Preflight ──────────────────────────────────────────────────────────────
--   SELECT column_name FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'director_penalty_notices' AND column_name LIKE 'proof_%';   -- 0 rows
--
-- ── Post-apply ─────────────────────────────────────────────────────────────
--   SELECT count(*) FROM public.director_penalty_notices WHERE proof_status IS NULL;   -- every row, until the next run
--   SELECT document_kind, count(*) FROM public.ica_alerts GROUP BY 1;                   -- ato_account only

ALTER TABLE public.director_penalty_notices
  ADD COLUMN IF NOT EXISTS proof_status text CHECK (proof_status IN ('verified', 'unverified')),
  ADD COLUMN IF NOT EXISTS proof_check jsonb,
  ADD COLUMN IF NOT EXISTS proof_checked_at timestamptz;

ALTER TABLE public.ica_alerts
  ADD COLUMN IF NOT EXISTS document_kind text NOT NULL DEFAULT 'ato_account'
    CHECK (document_kind IN ('ato_account', 'dpn', 'statement'));
