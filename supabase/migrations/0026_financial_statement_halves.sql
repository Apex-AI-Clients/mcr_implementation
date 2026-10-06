-- Migration: financial statements stored per half.
--
-- A financials slot (client, financial_year, source_column) has two halves —
-- the income statement and the balance sheet — and they can now come from
-- different files: one P&L PDF and one Balance Sheet PDF per year, as well as
-- the combined PDF that carries both. Until now a slot was written whole, so
-- separate files overwrote each other in processing order.
--
-- From here each half records the document it came from. A file writes only
-- the halves it contains, and deleting a document clears only its halves.
--
-- SHARED DATABASE. There is one Supabase project and it is production; preview
-- deployments use it too. This migration is applied while the OLD code is
-- still live, so everything here must leave the old code working:
--
--   - No half's data is changed. Stub halves (all-null values left behind by
--     the old overwrite) keep their jsonb; they just get no owner. Nulling them
--     waits for the follow-up migration, after the new code is live — the old
--     comparison code dereferences both halves and would fail on a NULL.
--   - The legacy columns (document_id, source_filename, extraction_warnings)
--     are kept and still written by the old code.
--   - A row the old code writes after this runs has no per-half owners, and the
--     new read path treats such a row as legacy. If the old code rewrites a row
--     that was already backfilled, the guard trigger below drops its per-half
--     owners so it becomes legacy too, rather than claiming a document it no
--     longer came from.
--
-- Safe to re-run: every step is IF [NOT] EXISTS, CREATE OR REPLACE, or a
-- backfill that only touches rows with no per-half owner yet. One transaction:
-- a failure leaves nothing half-done.
--
-- "Real data" in a half, used by the backfill and mirrored exactly by
-- hasRealIncomeStatement / hasRealBalanceSheet in src/lib/financials/halves.ts:
--   income statement: income.sales, totals.totalIncome, totals.profitBeforeTax
--                     or totals.netProfitAfterTax is non-null
--   balance sheet:    totals.totalAssets, totals.totalLiabilities,
--                     totals.netAssets or totals.totalEquity is non-null

BEGIN;

-- ============================================================
-- 1. Per-half columns
-- ============================================================

ALTER TABLE public.financial_statements
  ALTER COLUMN income_statement DROP NOT NULL,
  ALTER COLUMN balance_sheet DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS is_document_id uuid,
  ADD COLUMN IF NOT EXISTS is_source_filename text,
  ADD COLUMN IF NOT EXISTS is_extracted_at timestamptz,
  ADD COLUMN IF NOT EXISTS is_warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS bs_document_id uuid,
  ADD COLUMN IF NOT EXISTS bs_source_filename text,
  ADD COLUMN IF NOT EXISTS bs_extracted_at timestamptz,
  ADD COLUMN IF NOT EXISTS bs_warnings jsonb NOT NULL DEFAULT '[]'::jsonb;

-- SET NULL is only the safety net: the delete trigger below clears a half
-- before its document goes.
ALTER TABLE public.financial_statements
  DROP CONSTRAINT IF EXISTS financial_statements_is_document_id_fkey,
  ADD CONSTRAINT financial_statements_is_document_id_fkey
    FOREIGN KEY (is_document_id) REFERENCES public.documents(id) ON DELETE SET NULL,
  DROP CONSTRAINT IF EXISTS financial_statements_bs_document_id_fkey,
  ADD CONSTRAINT financial_statements_bs_document_id_fkey
    FOREIGN KEY (bs_document_id) REFERENCES public.documents(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS financial_statements_is_document_id_idx
  ON public.financial_statements (is_document_id);
CREATE INDEX IF NOT EXISTS financial_statements_bs_document_id_idx
  ON public.financial_statements (bs_document_id);

-- The legacy whole-row document no longer cascades: that is what wiped the
-- other file's half. Nullable because new rows do not set it. Dropped in a
-- later migration, once nothing reads it.
ALTER TABLE public.financial_statements
  ALTER COLUMN document_id DROP NOT NULL,
  ALTER COLUMN source_filename DROP NOT NULL,
  DROP CONSTRAINT IF EXISTS financial_statements_document_id_fkey,
  ADD CONSTRAINT financial_statements_document_id_fkey
    FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE SET NULL;

-- ============================================================
-- 2. Per-document extraction record
-- ============================================================

-- What a financials document is, and what the model said about it. Holds the
-- document-level result even when the document stores no statement at all
-- (a trust deed or a bare tax return in a financials slot), so that warning
-- has somewhere to live.
CREATE TABLE IF NOT EXISTS public.financial_document_extractions (
  document_id uuid PRIMARY KEY REFERENCES public.documents(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  kind text NOT NULL
    CHECK (kind IN ('combined', 'pnl_only', 'bs_only', 'tax_return_only', 'not_financial', 'unknown')),
  -- [{ page, class }] from the text pre-pass, 1-based physical page numbers.
  page_map jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Financial years named in the statement headings.
  heading_years int[] NOT NULL DEFAULT '{}',
  -- { name, abn } as printed in the heading, for the entity check.
  heading_entity jsonb,
  encrypted boolean NOT NULL DEFAULT false,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  raw_response jsonb,
  model text,
  extracted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS financial_document_extractions_client_id_idx
  ON public.financial_document_extractions (client_id);

-- Service role only, as every table 0021 closed: RLS on, no policies.
ALTER TABLE public.financial_document_extractions ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 3. Stale comparison marker
-- ============================================================

-- Set when a financials document is deleted after the comparison was built,
-- so the page can say "re-run" instead of showing figures from a file that is
-- gone. Cleared when the comparison is rebuilt.
ALTER TABLE public.financial_comparisons
  ADD COLUMN IF NOT EXISTS stale_since timestamptz;

-- ============================================================
-- 4. Backfill
-- ============================================================

-- Only rows with no per-half owner yet, so a re-run never touches a row the new
-- code (or an earlier run) already split. Each half takes the row's document
-- only when it carries real data; a stub half stays ownerless.
--
-- Warnings move to the half named by their section. Anything else stays in
-- extraction_warnings only, which the read path shows against the whole row.
WITH legacy AS (
  SELECT
    fs.id,
    (fs.income_statement -> 'income' ->> 'sales') IS NOT NULL
      OR (fs.income_statement -> 'totals' ->> 'totalIncome') IS NOT NULL
      OR (fs.income_statement -> 'totals' ->> 'profitBeforeTax') IS NOT NULL
      OR (fs.income_statement -> 'totals' ->> 'netProfitAfterTax') IS NOT NULL
      AS is_real,
    (fs.balance_sheet -> 'totals' ->> 'totalAssets') IS NOT NULL
      OR (fs.balance_sheet -> 'totals' ->> 'totalLiabilities') IS NOT NULL
      OR (fs.balance_sheet -> 'totals' ->> 'netAssets') IS NOT NULL
      OR (fs.balance_sheet -> 'totals' ->> 'totalEquity') IS NOT NULL
      AS bs_real,
    CASE WHEN jsonb_typeof(fs.extraction_warnings) = 'array'
      THEN fs.extraction_warnings ELSE '[]'::jsonb END AS warnings
  FROM public.financial_statements fs
  WHERE fs.is_document_id IS NULL
    AND fs.bs_document_id IS NULL
    AND fs.document_id IS NOT NULL
),
-- A warning's half comes from its section: the part before any ">", letters
-- only, lowercased ("Income > Other Revenue" -> "income"). Mirrored by
-- warningHalf() in src/lib/financials/halves.ts.
keyed AS (
  SELECT
    l.id,
    w.value AS warning,
    lower(regexp_replace(split_part(COALESCE(w.value ->> 'section', ''), '>', 1), '[^a-zA-Z]', '', 'g'))
      AS section_key
  FROM legacy l
  CROSS JOIN LATERAL jsonb_array_elements(l.warnings) AS w(value)
),
split AS (
  SELECT
    l.id,
    l.is_real,
    l.bs_real,
    COALESCE(
      (SELECT jsonb_agg(k.warning) FROM keyed k
        WHERE k.id = l.id
          AND k.section_key IN ('incomestatement', 'profitandloss', 'income', 'otherincome',
                                'revenue', 'otherrevenue', 'cogs', 'costofsales',
                                'costofgoodssold', 'expenses', 'operatingexpenses')),
      '[]'::jsonb) AS is_warnings,
    COALESCE(
      (SELECT jsonb_agg(k.warning) FROM keyed k
        WHERE k.id = l.id
          AND k.section_key IN ('balancesheet', 'assets', 'currentassets', 'noncurrentassets',
                                'liabilities', 'currentliabilities', 'noncurrentliabilities',
                                'equity')),
      '[]'::jsonb) AS bs_warnings
  FROM legacy l
)
UPDATE public.financial_statements fs
   SET is_document_id     = CASE WHEN s.is_real THEN fs.document_id END,
       is_source_filename = CASE WHEN s.is_real THEN fs.source_filename END,
       is_extracted_at    = CASE WHEN s.is_real THEN fs.extracted_at END,
       is_warnings        = CASE WHEN s.is_real THEN s.is_warnings ELSE '[]'::jsonb END,
       bs_document_id     = CASE WHEN s.bs_real THEN fs.document_id END,
       bs_source_filename = CASE WHEN s.bs_real THEN fs.source_filename END,
       bs_extracted_at    = CASE WHEN s.bs_real THEN fs.extracted_at END,
       bs_warnings        = CASE WHEN s.bs_real THEN s.bs_warnings ELSE '[]'::jsonb END
  FROM split s
 WHERE fs.id = s.id
   AND (s.is_real OR s.bs_real);

-- A row with no real data in either half is already invisible (the old read
-- path filters it out too). Run the preflight queries first to see how many.
DELETE FROM public.financial_statements fs
 WHERE fs.is_document_id IS NULL
   AND fs.bs_document_id IS NULL
   AND (fs.income_statement -> 'income' ->> 'sales') IS NULL
   AND (fs.income_statement -> 'totals' ->> 'totalIncome') IS NULL
   AND (fs.income_statement -> 'totals' ->> 'profitBeforeTax') IS NULL
   AND (fs.income_statement -> 'totals' ->> 'netProfitAfterTax') IS NULL
   AND (fs.balance_sheet -> 'totals' ->> 'totalAssets') IS NULL
   AND (fs.balance_sheet -> 'totals' ->> 'totalLiabilities') IS NULL
   AND (fs.balance_sheet -> 'totals' ->> 'netAssets') IS NULL
   AND (fs.balance_sheet -> 'totals' ->> 'totalEquity') IS NULL;

-- ============================================================
-- 5. Triggers
-- ============================================================

-- Deleting a document clears only the halves it owns, then removes any row
-- left with no owner at all. A legacy row (no per-half owners) whose document
-- this is goes whole, exactly as the old CASCADE did.
CREATE OR REPLACE FUNCTION public.financial_statements_release_document()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  -- Part of a whole-client delete: the client row is already gone and its
  -- statements go with it. Updating them first would re-check the client
  -- foreign key and fail, so just remove them.
  IF NOT EXISTS (SELECT 1 FROM public.clients WHERE id = OLD.client_id) THEN
    DELETE FROM public.financial_statements WHERE client_id = OLD.client_id;
    RETURN OLD;
  END IF;

  -- One UPDATE, so a row whose two halves both came from this document is
  -- written once.
  UPDATE public.financial_statements
     SET income_statement   = CASE WHEN is_document_id = OLD.id THEN NULL ELSE income_statement END,
         is_document_id     = CASE WHEN is_document_id = OLD.id THEN NULL ELSE is_document_id END,
         is_source_filename = CASE WHEN is_document_id = OLD.id THEN NULL ELSE is_source_filename END,
         is_extracted_at    = CASE WHEN is_document_id = OLD.id THEN NULL ELSE is_extracted_at END,
         is_warnings        = CASE WHEN is_document_id = OLD.id THEN '[]'::jsonb ELSE is_warnings END,
         balance_sheet      = CASE WHEN bs_document_id = OLD.id THEN NULL ELSE balance_sheet END,
         bs_document_id     = CASE WHEN bs_document_id = OLD.id THEN NULL ELSE bs_document_id END,
         bs_source_filename = CASE WHEN bs_document_id = OLD.id THEN NULL ELSE bs_source_filename END,
         bs_extracted_at    = CASE WHEN bs_document_id = OLD.id THEN NULL ELSE bs_extracted_at END,
         bs_warnings        = CASE WHEN bs_document_id = OLD.id THEN '[]'::jsonb ELSE bs_warnings END
   WHERE is_document_id = OLD.id OR bs_document_id = OLD.id;

  DELETE FROM public.financial_statements
   WHERE client_id = OLD.client_id
     AND is_document_id IS NULL
     AND bs_document_id IS NULL
     AND (document_id = OLD.id OR document_id IS NULL);

  IF OLD.doc_category IN ('historical_financials', 'current_financials') THEN
    UPDATE public.financial_comparisons
       SET stale_since = COALESCE(stale_since, now())
     WHERE client_id = OLD.client_id;
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS release_financial_statement_halves ON public.documents;
CREATE TRIGGER release_financial_statement_halves
  BEFORE DELETE ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.financial_statements_release_document();

-- Release window only (dropped by the follow-up migration). The old code
-- rewrites whole rows and never sets the per-half columns. The new code always
-- stamps a half's extracted_at when it writes that half. So a change to either
-- half's data with neither extracted_at moving is an old-code write: the row's
-- per-half owners no longer describe it, and it goes back to legacy.
CREATE OR REPLACE FUNCTION public.financial_statements_legacy_write_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF (NEW.income_statement IS DISTINCT FROM OLD.income_statement
      OR NEW.balance_sheet IS DISTINCT FROM OLD.balance_sheet)
     AND NEW.is_extracted_at IS NOT DISTINCT FROM OLD.is_extracted_at
     AND NEW.bs_extracted_at IS NOT DISTINCT FROM OLD.bs_extracted_at
  THEN
    NEW.is_document_id := NULL;
    NEW.is_source_filename := NULL;
    NEW.is_extracted_at := NULL;
    NEW.is_warnings := '[]'::jsonb;
    NEW.bs_document_id := NULL;
    NEW.bs_source_filename := NULL;
    NEW.bs_extracted_at := NULL;
    NEW.bs_warnings := '[]'::jsonb;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS financial_statements_legacy_write_guard ON public.financial_statements;
CREATE TRIGGER financial_statements_legacy_write_guard
  BEFORE UPDATE ON public.financial_statements
  FOR EACH ROW EXECUTE FUNCTION public.financial_statements_legacy_write_guard();

-- Trigger functions only: nobody calls these directly.
REVOKE EXECUTE ON FUNCTION public.financial_statements_release_document()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.financial_statements_legacy_write_guard()
  FROM PUBLIC, anon, authenticated;

COMMIT;
