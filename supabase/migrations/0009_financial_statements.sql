-- Migration: store extracted annual financial statements and the multi-year comparison output.
-- Backs the "Compare Financials" admin feature on the client detail page.
--
-- A single PDF can carry 1 OR 2 financial years (Xero shows current + comparative;
-- some templates strip the comparative). The same FY can also appear in multiple
-- PDFs — e.g. FY22 as the primary in PARKCON_FY22.pdf AND as the comparative
-- column in PARKCON_FY23.pdf. The UNIQUE constraint is therefore (client_id,
-- financial_year), not (document_id). Conflict resolution ("primary wins over
-- comparative") is enforced in the upsert logic of the extract-financials API
-- route — see source_column.

CREATE TABLE IF NOT EXISTS public.financial_statements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  source_filename text NOT NULL,
  financial_year int NOT NULL,            -- e.g. 2025 for "year ended 30 June 2025"
  period_end_date date NOT NULL,          -- e.g. 2025-06-30
  source_column text NOT NULL             -- which column of the source PDF this came from
    CHECK (source_column IN ('primary', 'comparative')),
  income_statement jsonb NOT NULL,        -- canonicalised line items + totals
  balance_sheet jsonb NOT NULL,           -- canonicalised line items + totals
  raw_extraction jsonb,                   -- full raw response from the AI parser, for audit
  extraction_warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  extracted_at timestamptz NOT NULL DEFAULT now(),
  extraction_model text,
  UNIQUE (client_id, financial_year)      -- one row per (client, FY); primary-wins on upsert
);

CREATE INDEX IF NOT EXISTS financial_statements_client_id_idx
  ON public.financial_statements (client_id);
CREATE INDEX IF NOT EXISTS financial_statements_fy_idx
  ON public.financial_statements (client_id, financial_year DESC);
CREATE INDEX IF NOT EXISTS financial_statements_document_id_idx
  ON public.financial_statements (document_id);

CREATE TABLE IF NOT EXISTS public.financial_comparisons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  financial_years int[] NOT NULL,          -- FYs that were compared (e.g. {2022,2023,2024,2025})
  computed jsonb NOT NULL,                 -- full comparison output: headlines, ratios, diff tables
  ai_summary text,
  ai_summary_generated_at timestamptz,
  ai_summary_model text,
  generated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id)                       -- one comparison row per client, always latest
);

ALTER TABLE public.financial_statements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_comparisons ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON public.financial_statements
  FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON public.financial_comparisons
  FOR ALL USING (true) WITH CHECK (true);
