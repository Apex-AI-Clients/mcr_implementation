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
-- Additive only: one nullable column. Nothing existing changes.
--
-- ── Preflight ──────────────────────────────────────────────────────────────
--   SELECT column_name FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'printed_reads' AND column_name = 'report';  -- no row

ALTER TABLE public.printed_reads ADD COLUMN IF NOT EXISTS report jsonb;

COMMENT ON COLUMN public.printed_reads.report IS
  'Annual financial statements or a software export, read from the PDF''s content (reportKind.ts). Null: read before 0063.';

-- ── Verify ─────────────────────────────────────────────────────────────────
--   SELECT column_name, data_type FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'printed_reads' AND column_name = 'report';  -- report | jsonb
