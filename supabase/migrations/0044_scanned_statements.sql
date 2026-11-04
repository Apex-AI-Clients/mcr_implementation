-- ============================================================
-- 0044: scanned financial statements, read twice (4 Nov 2026)
--
-- A PDF page with no text layer and a full-page image is a scan
-- (src/lib/scan). Its statement pages are read by Tesseract on our server and,
-- independently, by Claude from the page image (Gabby-approved; Anthropic
-- only, no logging, zero retention: CLAUDE.md rule 12). The two readings are
-- compared figure by figure; staff settle every difference.
--
--  1. scan_read_jobs        one background reading per document and reader
--                           version, with progress.
--  2. scan_page_readings    each reader's output per statement page (lines or
--                           the transcription), tokens and cost. No image.
--  3. scan_figure_choices   a staff choice where the readings differ: which
--                           reading, or a typed value; who and when.
--  4. printed_reads.status  takes 'scan_pending' while a job runs;
--     printed_reads.scan    which pages are scans, which were read as
--                           statements or skipped (and why), single reading.
--  5. reader_releases       when each READER_VERSION first ran here: a staff
--                           "Not printed" given before it, where the reader
--                           now matches lines, is switched to them
--                           (src/lib/printed/autoMapping.ts).
--  6. client_line_mappings.updated_note   "Updated after a reading fix (was: …)".
--
-- Server-side only (service role); RLS on, no policies.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.scan_read_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  reader_version text NOT NULL,
  status text NOT NULL CHECK (status IN ('running', 'done', 'failed')),
  stage text,
  done integer NOT NULL DEFAULT 0,
  total integer NOT NULL DEFAULT 0,
  message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS scan_read_jobs_document_idx ON public.scan_read_jobs (document_id, created_at DESC);
CREATE INDEX IF NOT EXISTS scan_read_jobs_client_idx ON public.scan_read_jobs (client_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.scan_page_readings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.scan_read_jobs(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  page integer NOT NULL CHECK (page > 0),
  reader text NOT NULL CHECK (reader IN ('tesseract', 'claude')),
  model text,
  generation_id text,
  tokens_in integer,
  tokens_out integer,
  cost_usd numeric(10, 4),
  -- Tesseract: its lines with positions; Claude: its transcription (scan/claudeReader.ts).
  output jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- The per-client daily cap counts Claude pages by day.
CREATE INDEX IF NOT EXISTS scan_page_readings_cap_idx ON public.scan_page_readings (client_id, reader, created_at);
CREATE INDEX IF NOT EXISTS scan_page_readings_job_idx ON public.scan_page_readings (job_id);

CREATE TABLE IF NOT EXISTS public.scan_figure_choices (
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  -- The line (kind|page|path|label|n, src/lib/scan/reconcile.ts) and the column.
  row_key text NOT NULL,
  column_index integer NOT NULL CHECK (column_index >= 0),
  source text NOT NULL CHECK (source IN ('tesseract', 'claude', 'typed')),
  -- NULL: the figure is nil ("-").
  value numeric,
  chosen_by text NOT NULL,
  chosen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (document_id, row_key, column_index)
);
CREATE INDEX IF NOT EXISTS scan_figure_choices_client_idx ON public.scan_figure_choices (client_id);

ALTER TABLE public.printed_reads
  ADD COLUMN IF NOT EXISTS scan jsonb;

ALTER TABLE public.printed_reads
  DROP CONSTRAINT IF EXISTS printed_reads_status_check,
  ADD CONSTRAINT printed_reads_status_check CHECK (status IN ('read', 'no_text_layer', 'no_statements', 'failed', 'scan_pending'));

CREATE TABLE IF NOT EXISTS public.reader_releases (
  version text PRIMARY KEY,
  first_seen_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.client_line_mappings
  ADD COLUMN IF NOT EXISTS updated_note text;

ALTER TABLE public.scan_read_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scan_page_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scan_figure_choices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reader_releases ENABLE ROW LEVEL SECURITY;
