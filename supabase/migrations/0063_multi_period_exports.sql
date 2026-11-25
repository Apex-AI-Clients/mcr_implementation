-- ============================================================
-- 0063 — Multi-year and current-period exports in the SBR comparison
-- ============================================================
--
-- Gabby uploads Xero / MYOB exports (a profit and loss or balance sheet with
-- one column per year, or for the period to date) beside the accountant's
-- annual financial statements (25 Nov 2026). Which one a PDF is, is read from
-- its content: contents page, notes to the financial statements, compilation
-- report, directors' / trustees' declaration, a Notes column or an
-- "Income Statement" / "Statement of Financial Position" title make it annual
-- statements; a plain statement is an export (src/lib/printed/reportKind.ts).
--
-- printed_reads.report  { kind: 'annual_statements' | 'export', markers: [...] }
--                       Null on reads stored before (read as annual statements
--                       until read again). The app keeps working before this is
--                       applied: it saves the read without the column.
--
-- comparison_source_choices
--                       "Use this source instead": staff choosing which file a
--                       period's profit and loss or balance sheet is taken from,
--                       when several print it. Append-only: the latest row per
--                       client, period and statement counts; earlier rows are the
--                       log of who chose what, when. document_id null: back to
--                       the rules. A deleted file's choices go with it.
--                       Service role only: RLS on, no policies.
--
-- Additive only: one nullable column and one new table. Nothing existing changes.
--
-- ── Preflight ──────────────────────────────────────────────────────────────
--   SELECT column_name FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'printed_reads' AND column_name = 'report';  -- no row
--   SELECT to_regclass('public.comparison_source_choices');                                     -- null

ALTER TABLE public.printed_reads ADD COLUMN IF NOT EXISTS report jsonb;

COMMENT ON COLUMN public.printed_reads.report IS
  'Annual financial statements or a software export, read from the PDF''s content (reportKind.ts). Null: read before 0063.';

CREATE TABLE IF NOT EXISTS public.comparison_source_choices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  -- The comparison column: 'FY2024' or 'current'.
  period_key text NOT NULL CHECK (period_key ~ '^(FY[0-9]{4}|current)$'),
  statement_kind text NOT NULL CHECK (statement_kind IN ('profit_and_loss', 'balance_sheet')),
  document_id uuid REFERENCES public.documents(id) ON DELETE CASCADE,
  chosen_by text NOT NULL,
  chosen_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS comparison_source_choices_client_idx
  ON public.comparison_source_choices (client_id, chosen_at);

ALTER TABLE public.comparison_source_choices ENABLE ROW LEVEL SECURITY;

-- ── Verify ─────────────────────────────────────────────────────────────────
--   SELECT column_name, data_type FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'printed_reads' AND column_name = 'report';  -- report | jsonb
--   SELECT relrowsecurity FROM pg_class WHERE oid = 'public.comparison_source_choices'::regclass;  -- true
--   SELECT count(*) FROM pg_policies WHERE tablename = 'comparison_source_choices';                -- 0
