-- Migration: one upload area for all financial statements, and a per-file
-- override of the year and of annual vs current period.
--
-- Additive: code running before this migration keeps working after it.
--
-- 1. documents.doc_category gains 'financial_statements', the single upload
--    area. The two older values ('historical_financials', 'current_financials')
--    stay allowed: files already uploaded keep them, and the code treats all
--    three alike — the statement headings, not the category, decide each
--    file's year and whether it is annual or a current period. A later
--    migration moves the old rows over and drops the two old values, once
--    production runs the new code.
--
--    (The value 'financial_statements' was an earlier category name too,
--    renamed to 'current_financials' by 0002. No row has it today.)
--
-- 2. documents.fs_override_* — staff correcting what the headings said about
--    one file: annual for FY X, or a current period within FY X. Applied the
--    next time the file is extracted. All four set together, or none.
--
-- 3. financial_statements_release_document() — the delete trigger from 0026
--    marks the comparison stale when a financials file is deleted. It listed
--    the two old categories only; it now includes the new one.

-- ============================================================
-- 1. The category
-- ============================================================

ALTER TABLE public.documents
  DROP CONSTRAINT IF EXISTS documents_doc_category_check,
  ADD CONSTRAINT documents_doc_category_check
    CHECK (doc_category IN (
      'financial_statements',
      'current_financials',
      'historical_financials',
      'integrated_client_account',
      'director_penalty_notices',
      'trust_deed',
      'company_licences'
    ));

-- ============================================================
-- 2. Per-file override
-- ============================================================

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS fs_override_kind text
    CHECK (fs_override_kind IS NULL OR fs_override_kind IN ('annual', 'current_period')),
  ADD COLUMN IF NOT EXISTS fs_override_fy int
    CHECK (fs_override_fy IS NULL OR fs_override_fy BETWEEN 2000 AND 2100),
  ADD COLUMN IF NOT EXISTS fs_override_by text,
  ADD COLUMN IF NOT EXISTS fs_override_at timestamptz;

ALTER TABLE public.documents
  DROP CONSTRAINT IF EXISTS documents_fs_override_complete,
  ADD CONSTRAINT documents_fs_override_complete
    CHECK (
      (fs_override_kind IS NULL AND fs_override_fy IS NULL AND fs_override_by IS NULL AND fs_override_at IS NULL)
      OR
      (fs_override_kind IS NOT NULL AND fs_override_fy IS NOT NULL AND fs_override_by IS NOT NULL AND fs_override_at IS NOT NULL)
    );

-- ============================================================
-- 3. The delete trigger, with the new category
-- ============================================================
-- Identical to 0026 apart from the category list.

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

  IF OLD.doc_category IN ('financial_statements', 'historical_financials', 'current_financials') THEN
    UPDATE public.financial_comparisons
       SET stale_since = COALESCE(stale_since, now())
     WHERE client_id = OLD.client_id;
  END IF;

  RETURN OLD;
END;
$$;
