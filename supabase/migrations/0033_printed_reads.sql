-- Migration: printed_reads — the as-printed read of each financial statements PDF.
--
-- Additive only: one new table. Nothing existing is changed. Until it is
-- applied the app still works: the comparison page reads the PDFs on the fly
-- and simply cannot keep the result (src/lib/printed/store.ts).
--
-- One row per financial statements document: what the deterministic reader
-- (src/lib/printed) found on its profit and loss and balance sheet pages —
-- every printed row with its section, label, style and amounts exactly as
-- printed, the page and line it came from, and anything it could not read.
-- No AI reads these figures. reader_version says which reader wrote the row:
-- a newer reader re-reads the PDF, so a reader fix reaches every client.
--
-- ── Preflight (run before applying; all must return the rows shown) ───────
--
--   -- No table of this name yet: 0 rows.
--   SELECT table_schema, table_name
--     FROM information_schema.tables
--    WHERE table_schema = 'public' AND table_name = 'printed_reads';
--
--   -- What will be read: financial statements documents per client.
--   SELECT d.client_id, count(d.id) AS financial_documents
--     FROM public.documents d
--    WHERE d.doc_category IN ('financial_statements', 'historical_financials', 'current_financials')
--    GROUP BY d.client_id
--    ORDER BY d.client_id;
--
-- ── Post-apply ─────────────────────────────────────────────────────────────
--
--   -- The table, its columns and RLS on: rls_enabled = true.
--   SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled
--     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--    WHERE n.nspname = 'public' AND c.relname = 'printed_reads';
--   SELECT column_name, data_type, is_nullable
--     FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'printed_reads'
--    ORDER BY ordinal_position;
--
--   -- After the re-read (opening each comparison page, or "Read the PDFs
--   -- again"): one row per financial document, and how each read went.
--   SELECT pr.client_id, pr.status, pr.reader_version, count(pr.document_id) AS documents,
--          max(pr.read_at) AS last_read_at
--     FROM public.printed_reads pr
--    GROUP BY pr.client_id, pr.status, pr.reader_version
--    ORDER BY pr.client_id, pr.status;
--
--   -- Financial documents with no read yet: 0 rows once every page has been opened.
--   SELECT d.client_id, d.id AS document_id
--     FROM public.documents d
--     LEFT JOIN public.printed_reads pr ON pr.document_id = d.id
--    WHERE d.doc_category IN ('financial_statements', 'historical_financials', 'current_financials')
--      AND pr.document_id IS NULL;

CREATE TABLE IF NOT EXISTS public.printed_reads (
  -- The PDF. Deleting the document deletes its read.
  document_id uuid PRIMARY KEY REFERENCES public.documents(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  -- Which reader wrote this row (src/lib/printed/store.ts READER_VERSION).
  reader_version text NOT NULL,
  -- 'read': statements found. 'no_text_layer': a scan; nothing read, never
  -- guessed. 'no_statements': no profit and loss or balance sheet page.
  -- 'failed': the file could not be opened or downloaded.
  status text NOT NULL CHECK (status IN ('read', 'no_text_layer', 'no_statements', 'failed')),
  page_count int,
  -- [{ kind, title, pages, columns, rows, wholeDollars }] (src/lib/printed/types.ts).
  statements jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- [{ kind, page, text, message }]: exactly what could not be read, and where.
  issues jsonb NOT NULL DEFAULT '[]'::jsonb,
  read_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS printed_reads_client_id_idx
  ON public.printed_reads (client_id);

-- Server-side only (service role), like every other analysis table.
ALTER TABLE public.printed_reads ENABLE ROW LEVEL SECURITY;
