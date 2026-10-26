-- Migration: ATO income tax and superannuation guarantee accounts.
--
-- Additive: code running before this migration keeps working after it. Nothing
-- here touches lodgement_analyses, which stays the one source of the SBR
-- prediction's lodgement factors (activity statement only, as the historical
-- cases are).
--
-- 1. documents.doc_category gains two upload slots beside the activity
--    statement ('integrated_client_account', unchanged):
--      'ato_income_tax_account'       — "ATO income tax account"
--      'ato_super_guarantee_account'  — "ATO superannuation guarantee account"
--
-- 2. documents gains what was read from an ATO account CSV's first two lines,
--    so a file is filed by its content, not its name or the slot it was
--    dropped in:
--      ato_account_kind   — 'activity_statement' | 'income_tax' |
--                           'super_guarantee' | 'unrecognised' (null: not an
--                           ATO account CSV, or uploaded before this)
--      ato_account_label  — line 1 as printed, e.g. "Income tax 001"
--      ato_entity_name    — line 2 as printed, the entity the ATO names
--      category_note      — why the file is in this slot, when it was moved:
--                           "This is an income tax account; moved to ATO
--                           income tax account"
--
-- 3. ato_account_analyses: one analysis per ATO account CSV, of any of the
--    three kinds, from the shared engine (src/lib/analysis/atoAccount*):
--    the newest printed balance and its date, the debt composition with the
--    rows behind each line, the unexplained difference, and the kind's own
--    summary (income tax assessments, super guarantee quarters). Activity
--    statement files are analysed here too, so the ATO accounts panel can
--    list 001 and 002 side by side; their lodgement analysis is untouched.

-- ============================================================
-- 1. Upload slots
-- ============================================================

ALTER TABLE public.documents
  DROP CONSTRAINT IF EXISTS documents_doc_category_check,
  ADD CONSTRAINT documents_doc_category_check
    CHECK (doc_category IN (
      'financial_statements',
      'current_financials',
      'historical_financials',
      'integrated_client_account',
      'ato_income_tax_account',
      'ato_super_guarantee_account',
      'director_penalty_notices',
      'trust_deed',
      'company_licences'
    ));

-- ============================================================
-- 2. What an ATO account CSV says it is
-- ============================================================

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS ato_account_kind text,
  ADD COLUMN IF NOT EXISTS ato_account_label text,
  ADD COLUMN IF NOT EXISTS ato_entity_name text,
  ADD COLUMN IF NOT EXISTS category_note text;

ALTER TABLE public.documents
  DROP CONSTRAINT IF EXISTS documents_ato_account_kind_check,
  ADD CONSTRAINT documents_ato_account_kind_check
    CHECK (ato_account_kind IS NULL OR ato_account_kind IN (
      'activity_statement', 'income_tax', 'super_guarantee', 'unrecognised'
    ));

COMMENT ON COLUMN public.documents.ato_account_kind IS
  'The ATO account type read from line 1 of the CSV; decides the slot. See src/lib/analysis/atoAccountKind.ts.';
COMMENT ON COLUMN public.documents.category_note IS
  'Why the file is in its slot when it was moved there automatically.';

-- ============================================================
-- 3. One analysis per ATO account CSV
-- ============================================================

CREATE TABLE IF NOT EXISTS public.ato_account_analyses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL UNIQUE REFERENCES public.documents(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  account_kind text NOT NULL
    CHECK (account_kind IN ('activity_statement', 'income_tax', 'super_guarantee')),
  -- Line 1 and line 2 as printed, and whether line 2 is the client's company or trust.
  account_label text NOT NULL,
  entity_name text,
  entity_matches boolean,
  -- The newest printed balance: positive is owed to the ATO (DR), negative a credit (CR).
  balance numeric(14,2),
  balance_date date,
  -- The ATO balance less what the itemised rows add up to; null without a printed balance.
  unexplained_difference numeric(14,2),
  -- Unexplained difference above $1,000: the page and its exports are locked until reviewed.
  needs_review boolean NOT NULL DEFAULT false,
  reviewed_by text,
  reviewed_at timestamptz,
  -- The composition lines with their rows, the kind's own summary (assessments
  -- or quarters), the classified rows and any warnings.
  composition jsonb NOT NULL DEFAULT '{}'::jsonb,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  rows jsonb NOT NULL DEFAULT '[]'::jsonb,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  ai_summary text,
  ai_summary_generated_at timestamptz,
  ai_summary_model text,
  analysed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ato_account_analyses_client ON public.ato_account_analyses(client_id);

-- Server-side only, through the service role, like every analysis table.
ALTER TABLE public.ato_account_analyses ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.ato_account_analyses IS
  'One analysis per ATO account CSV (activity statement, income tax, super guarantee). Not read by the SBR prediction.';
