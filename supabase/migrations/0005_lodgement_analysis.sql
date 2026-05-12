-- Migration: store computed late-lodgement analysis per ICA document

CREATE TABLE IF NOT EXISTS public.lodgement_analyses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  source_filename text NOT NULL,
  statement_label text,           -- e.g. "Activity statement 002"
  company_name_in_csv text,       -- e.g. "PARKCON PTY LTD"
  row_count int NOT NULL,
  number_of_late_lodgements int NOT NULL,
  cumulative_days_late int NOT NULL,
  rows jsonb NOT NULL,            -- full per-row results
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  analysed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id)            -- one analysis per source CSV; re-running upserts
);

CREATE INDEX IF NOT EXISTS lodgement_analyses_client_id_idx
  ON public.lodgement_analyses (client_id);

ALTER TABLE public.lodgement_analyses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON public.lodgement_analyses
  FOR ALL USING (true) WITH CHECK (true);
