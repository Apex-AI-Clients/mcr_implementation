-- Migration: ai_summaries — the AI-written comparison summary, kept with what
-- it was written from.
--
-- Additive only: one new table. Nothing existing is changed.
--
-- The comparison summary is written by Claude (via OpenRouter, Anthropic
-- only, no data retained) from the as-printed figures of the key figures
-- staff confirmed (src/lib/ai/financialsComparisonSummary.ts). It is kept
-- here with a fingerprint of exactly those figures: when a figure, a year or
-- the confirmed mapping changes, the fingerprint changes and a new summary is
-- written. The old financial_comparisons.ai_summary columns belonged to the
-- AI reader and are no longer written. The lodgement summary stays on
-- lodgement_analyses, as before.
--
-- Until this is applied the summary is simply not shown: nothing else depends
-- on it.
--
-- ── Preflight (run before applying) ───────────────────────────────────────
--
--   -- No table of this name yet: 0 rows.
--   SELECT table_name
--     FROM information_schema.tables
--    WHERE table_schema = 'public' AND table_name = 'ai_summaries';
--
-- ── Post-apply ─────────────────────────────────────────────────────────────
--
--   -- The table, RLS on: rls_enabled = true; no policy (server only).
--   SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled
--     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--    WHERE n.nspname = 'public' AND c.relname = 'ai_summaries';
--   SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ai_summaries';
--
--   -- Once AI_SUMMARIES_ENABLED is on and a comparison page has been opened:
--   SELECT s.client_id, s.kind, s.model, s.generated_at
--     FROM public.ai_summaries s
--    ORDER BY s.generated_at DESC;

CREATE TABLE IF NOT EXISTS public.ai_summaries (
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('financials')),
  -- What the summary was written from (a hash of its prompt): a new one is written when this changes.
  input_fingerprint text NOT NULL,
  summary text NOT NULL,
  -- The OpenRouter model, e.g. "anthropic/claude-sonnet-5.5"; "(figures withheld)" when the fallback was used.
  model text NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (client_id, kind)
);

-- Server-side only (service role). No policy: no anon or client access.
ALTER TABLE public.ai_summaries ENABLE ROW LEVEL SECURITY;
