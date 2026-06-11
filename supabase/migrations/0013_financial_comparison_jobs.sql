-- Migration: background job tracking for the multi-year financials comparison.
--
-- The "Compare Financials" flow runs OCR + AI extraction over 4-5 PDFs and then
-- builds the comparison. End-to-end this takes 3-5 minutes, which does not fit
-- inside a single synchronous HTTP request on Vercel (function duration cap).
--
-- Instead, the /financials-comparison/start route creates a row here, returns
-- the job id immediately, and runs the work in the background (Next.js after()).
-- The frontend polls /financials-comparison/status/[jobId] until the row reaches
-- 'done' or 'failed'. The result payload (same shape the old synchronous route
-- returned) is stored on the row so the status endpoint is self-contained.

CREATE TABLE IF NOT EXISTS public.financial_comparison_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'done', 'failed')),
  -- 'full'    = extract all PDFs, then build the comparison
  -- 'compare' = skip extraction, rebuild the comparison from existing statements
  mode text NOT NULL DEFAULT 'full'
    CHECK (mode IN ('full', 'compare')),
  result jsonb,                                    -- ComparisonPayload when status='done'
  error text,                                      -- fatal error message when status='failed'
  extract_errors jsonb NOT NULL DEFAULT '[]'::jsonb, -- per-PDF non-fatal extraction errors
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz
);

CREATE INDEX IF NOT EXISTS financial_comparison_jobs_client_idx
  ON public.financial_comparison_jobs (client_id, created_at DESC);

-- Fast lookup for "is there already an active job for this client?" used by the
-- start route to avoid kicking off a duplicate 3-5 minute run on double-click.
CREATE INDEX IF NOT EXISTS financial_comparison_jobs_active_idx
  ON public.financial_comparison_jobs (client_id)
  WHERE status IN ('pending', 'processing');

ALTER TABLE public.financial_comparison_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON public.financial_comparison_jobs
  FOR ALL USING (true) WITH CHECK (true);
