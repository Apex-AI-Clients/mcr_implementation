-- ============================================================
-- 0057 — ATO account (ICA) analysis: patterns learned from verified Claude proposals
-- ============================================================
--
-- The ICA engine (src/lib/ica) reads every ATO account file against the ATO's
-- own running balance. Where no known rule matches a window of rows, Claude
-- (via the OpenRouter client, Anthropic only, anonymised rows) may propose
-- which rows count. A proposal is used only if the ATO's balance then matches
-- to the cent; its decisions are kept here as patterns, so the next file with
-- the same structure is read the same way. A pattern is never applied
-- blindly: the engine tries it only in a window the known rules could not
-- match, and keeps it only if the balance then matches.
--
-- A pattern holds WORDING only: lower case, dates and numbers masked
-- ("amended general interest charge calculated from <date> to <date>").
-- No amount, date, client or file is stored.
--
--   wording        the masked description (src/lib/ica/learned.ts wordingKey)
--   printed        whether the rows print a balance ('with_balance' / 'without_balance')
--   counts         true: these rows count; false: they do not
--   explanation    Claude's explanation of the structure, for staff
--   model, generation_id   which answer it came from (no content)
--   disabled_at/by staff can switch a pattern off; it is then ignored
--
-- Add-only. Service role only (RLS on, no policies), like the scan tables (0044).
--
-- ── Preflight ──────────────────────────────────────────────────────────────
--   SELECT to_regclass('public.ica_learned_patterns');   -- null
--
-- ── Post-apply ─────────────────────────────────────────────────────────────
--   SELECT count(*) FROM public.ica_learned_patterns;    -- 0

CREATE TABLE IF NOT EXISTS public.ica_learned_patterns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wording text NOT NULL CHECK (length(wording) BETWEEN 1 AND 500),
  printed text NOT NULL CHECK (printed IN ('with_balance', 'without_balance')),
  counts boolean NOT NULL,
  explanation text NOT NULL DEFAULT '' CHECK (length(explanation) <= 2000),
  model text,
  generation_id text,
  learned_at timestamptz NOT NULL DEFAULT now(),
  disabled_at timestamptz,
  disabled_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE (wording, printed)
);

ALTER TABLE public.ica_learned_patterns ENABLE ROW LEVEL SECURITY;
