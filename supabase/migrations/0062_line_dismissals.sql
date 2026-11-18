-- ============================================================
-- 0062 — "Not a loan account": a possible line staff turned down
-- ============================================================
--
-- On the latest balance sheet, a line that may be the director loan account
-- (Debit) — a loan, director or related-party line, or drawings ("Owner A
-- Drawings", money taken out by the owner) — is offered as "Possible line —
-- use it?" and the SBR prediction waits (Gabby, 18 Nov 2026). Staff answer
-- "Use it" (it joins the confirmed lines) or "Not a loan account" (kept here,
-- never offered again for that meaning). Only then, with no other such line,
-- does the director loan account count as $0 ("Not printed on the FY2026
-- balance sheet; printed in FY2025 as $100").
--
-- One row per client, meaning and printed line (its comparison row key).
-- Service role only: RLS on, no policies. New table; nothing existing changes.
--
-- ── Preflight ──────────────────────────────────────────────────────────────
--   SELECT to_regclass('public.client_line_dismissals');   -- null

CREATE TABLE IF NOT EXISTS public.client_line_dismissals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  meaning text NOT NULL,
  row_key text NOT NULL CHECK (length(row_key) BETWEEN 1 AND 1000),
  label text,
  dismissed_by text NOT NULL,
  dismissed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, meaning, row_key)
);

ALTER TABLE public.client_line_dismissals ENABLE ROW LEVEL SECURITY;
