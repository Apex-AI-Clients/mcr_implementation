-- Migration: inbound lead ingestion support.
--
-- Two changes, both forced by the live website form (CRM_ADDENDUM.md §4).

-- ============================================================
-- 1. State becomes nullable
-- ============================================================
--
-- The form's state select defaults to value="state", not empty, so an
-- unselected state posts the literal string "state". That must not be stored —
-- it would put the word "state" in the State column — and the lead must not be
-- dropped either, because everything else about it is valid. Null is the only
-- honest answer, so the column has to allow it.
ALTER TABLE public.leads ALTER COLUMN state DROP NOT NULL;

-- ============================================================
-- 2. TABLE: lead_intake_log
-- ============================================================
--
-- A payload we cannot parse is never dropped silently: the raw body and the
-- reason land here, the endpoint still answers 200 so Meta stops retrying, and
-- the failure can be surfaced later. Without this, a form change stops the lead
-- flow and nobody notices for a fortnight.
--
-- Contains raw submissions, so it holds names, phone numbers and financial
-- position. RLS restricts it to the service role, and nothing outside this
-- table ever logs a full payload.
CREATE TABLE IF NOT EXISTS public.lead_intake_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL
    CHECK (source IN ('facebook', 'website', 'google_form', 'manual')),
  -- Null when the payload was too malformed to find one.
  external_id text,
  outcome text NOT NULL
    CHECK (outcome IN ('created', 'duplicate', 'appended', 'rejected', 'error')),
  -- Null on success; the validation or mapping failure otherwise.
  error text,
  raw_body jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.lead_intake_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lead_intake_log_service_role" ON public.lead_intake_log
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "lead_intake_log_no_anon_read" ON public.lead_intake_log
  FOR SELECT USING (false);

-- Newest failures first, per source — what a settings screen would show.
CREATE INDEX IF NOT EXISTS idx_lead_intake_log_source_created
  ON public.lead_intake_log(source, created_at DESC);
