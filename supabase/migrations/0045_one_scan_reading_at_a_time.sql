-- ============================================================
-- 0045: one reading of a scanned PDF at a time
--
-- Two "start reading" requests arriving together (two tabs, or React running
-- the page's effect twice in development) each found no running job and each
-- started one: the same PDF was read twice, and Claude paid twice. At most one
-- running job per document and reader version from now on: a second start is
-- refused by the database and the reading that lost simply stops
-- (src/lib/scan/job.ts).
--
-- Jobs still marked running and older than the 14-minute limit are dead (the
-- function was stopped): they are closed first, so the index can be built and
-- a dead job never blocks a new reading. Of two live duplicates, the later one
-- is closed too.
-- ============================================================

UPDATE public.scan_read_jobs
   SET status = 'failed', message = 'Stopped before it finished.', finished_at = now(), updated_at = now()
 WHERE status = 'running' AND created_at < now() - interval '14 minutes';

UPDATE public.scan_read_jobs j
   SET status = 'failed', message = 'A second reading of the same file, started by mistake.', finished_at = now(), updated_at = now()
 WHERE j.status = 'running'
   AND EXISTS (
     SELECT 1 FROM public.scan_read_jobs k
      WHERE k.document_id = j.document_id AND k.reader_version = j.reader_version
        AND k.status = 'running' AND (k.created_at, k.id) < (j.created_at, j.id)
   );

CREATE UNIQUE INDEX IF NOT EXISTS scan_read_jobs_one_running
  ON public.scan_read_jobs (document_id, reader_version)
  WHERE status = 'running';
