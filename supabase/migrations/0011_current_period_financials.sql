-- Migration: support partial-period (current_period) financial statements.
--
-- The existing schema assumed every financial statement was an annual
-- accountant-prepared one. Current-period software exports add a third
-- source_column value and require a partial period_start_date field.
--
-- Two structural changes:
-- 1. Add period_start_date column (current-period rows need it; annual
--    rows leave it null). Also add a period_label column for the verbatim
--    human-readable date range shown on the source PDF.
-- 2. Replace UNIQUE(client_id, financial_year) with
--    UNIQUE(client_id, financial_year, source_column) so a client can
--    have both an annual FY2026 row AND a current-period FY2026 row.
--
-- source_column already exists with values ('primary', 'comparative');
-- we only need to widen the CHECK constraint to admit 'current_period'.
-- Existing primary/comparative rows remain valid without re-extraction.

ALTER TABLE public.financial_statements
  ADD COLUMN IF NOT EXISTS period_start_date date;

ALTER TABLE public.financial_statements
  ADD COLUMN IF NOT EXISTS period_label text;

ALTER TABLE public.financial_statements
  DROP CONSTRAINT IF EXISTS financial_statements_source_column_check;

ALTER TABLE public.financial_statements
  ADD CONSTRAINT financial_statements_source_column_check
  CHECK (source_column IN ('primary', 'comparative', 'current_period'));

ALTER TABLE public.financial_statements
  DROP CONSTRAINT IF EXISTS financial_statements_client_id_financial_year_key;

ALTER TABLE public.financial_statements
  ADD CONSTRAINT financial_statements_client_year_source_key
  UNIQUE (client_id, financial_year, source_column);
