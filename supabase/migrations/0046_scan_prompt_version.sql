-- ============================================================
-- 0046: reuse Claude's transcription of a scanned page
--
-- Re-reading a scan (a reader fix, a refresh) used to send every statement
-- page to Claude again and pay again. A transcription is now kept with the
-- prompt it answered (prompt_version, a hash of SCAN_PAGE_PROMPT) and reused
-- for the same file, page, model and prompt (src/lib/scan/job.ts). Tesseract
-- (free, on our server) is always run again, so a reader fix still applies.
-- Existing rows have no prompt_version and are not reused.
-- ============================================================

ALTER TABLE public.scan_page_readings
  ADD COLUMN IF NOT EXISTS prompt_version text;

CREATE INDEX IF NOT EXISTS scan_page_readings_reuse_idx
  ON public.scan_page_readings (document_id, reader, prompt_version, created_at DESC);

-- The transcriptions kept so far all answered the one prompt there has been
-- (SCAN_PAGE_PROMPT, unchanged since it was added in 54f21d1): mark them, so
-- the next reading of those files reuses them instead of paying again.
UPDATE public.scan_page_readings
   SET prompt_version = 'dede9920ab2c'
 WHERE reader = 'claude' AND prompt_version IS NULL AND error IS NULL AND output IS NOT NULL;
