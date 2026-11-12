-- Migration: an enquiry, not a lead, becomes a client file.
--
-- Until now a lead (one per email, 0020) converted once: leads.converted_client_id
-- held its one client file, and clients.email was unique, so a second file for
-- the same person was refused.
--
-- From here each enquiry (a lead_submissions row) can become one client file,
-- SBR or CVL. A lead with two enquiries can have two files: 2 SBR, 2 CVL, or
-- one of each. One enquiry still makes at most one file.
--
--   - lead_submissions.converted_client_id: the file this enquiry became.
--     Unique, so an enquiry cannot be converted twice. ON DELETE SET NULL, so
--     deleting the file frees the enquiry again.
--   - clients.email is no longer unique: two files for the same person carry
--     the same email. Clients do not sign in, so nothing keys on it. An
--     ordinary index on lower(email) keeps the lookup by email fast.
--   - leads.converted_client_id stays, meaning "the newest file from this
--     lead", so the lead list, its filters and the "Converted from a lead"
--     link keep working. The app keeps it in step.
--
-- Existing data: no client file or email is changed. Each lead already
-- converted has its file linked to one of its enquiries (section 3), so that
-- enquiry shows its file and only the others offer "Convert to client".
--
-- Write-only for the user to apply; regenerate src/types/database.ts
-- afterwards (converted_client_id on lead_submissions).

-- ============================================================
-- 1. lead_submissions.converted_client_id
-- ============================================================

ALTER TABLE public.lead_submissions
  ADD COLUMN IF NOT EXISTS converted_client_id uuid
    REFERENCES public.clients(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.lead_submissions.converted_client_id IS
  'The client file this enquiry became. NULL: not converted. One enquiry makes at most one file.';

-- One file per enquiry, and one enquiry per file.
CREATE UNIQUE INDEX IF NOT EXISTS lead_submissions_converted_client_id_key
  ON public.lead_submissions(converted_client_id)
  WHERE converted_client_id IS NOT NULL;

-- ============================================================
-- 2. clients.email: no longer unique
-- ============================================================

ALTER TABLE public.clients DROP CONSTRAINT IF EXISTS clients_email_key;

CREATE INDEX IF NOT EXISTS idx_clients_email_lower
  ON public.clients(lower(email));

-- ============================================================
-- 3. Existing conversions: link each file to one enquiry
-- ============================================================
--
-- The enquiry is the newest one received on or before the conversion: the
-- latest "Converted to a client file" timeline entry, else the file's
-- created_at. A lead whose every enquiry is later than that (a lead linked to
-- a file made before it enquired) takes its oldest enquiry. A file already
-- linked to an enquiry is left alone, so running this twice changes nothing.

WITH converted AS (
  SELECT l.id AS lead_id,
         l.converted_client_id AS client_id,
         COALESCE(
           (SELECT max(a.created_at)
              FROM public.lead_activities a
             WHERE a.lead_id = l.id
               AND a.type = 'stage_change'
               AND a.body LIKE 'Converted to a client file%'),
           c.created_at
         ) AS converted_at
    FROM public.leads l
    JOIN public.clients c ON c.id = l.converted_client_id
   WHERE NOT EXISTS (
     SELECT 1 FROM public.lead_submissions s
      WHERE s.converted_client_id = l.converted_client_id
   )
),
-- Two leads can point at one file (the old "link to the existing file" path).
-- A file goes on one enquiry only: the lead converted first takes it.
first_per_file AS (
  SELECT DISTINCT ON (client_id) lead_id, client_id, converted_at
    FROM converted
   ORDER BY client_id, converted_at, lead_id
),
chosen AS (
  SELECT cv.client_id,
         COALESCE(
           (SELECT s.id FROM public.lead_submissions s
             WHERE s.lead_id = cv.lead_id AND s.received_at <= cv.converted_at
             ORDER BY s.received_at DESC LIMIT 1),
           (SELECT s.id FROM public.lead_submissions s
             WHERE s.lead_id = cv.lead_id
             ORDER BY s.received_at ASC LIMIT 1)
         ) AS submission_id
    FROM first_per_file cv
)
UPDATE public.lead_submissions s
   SET converted_client_id = ch.client_id
  FROM chosen ch
 WHERE s.id = ch.submission_id;

-- Check after applying (counts only):
--
--   -- Leads sharing a file with another lead. Expect 0; each one found keeps
--   -- its leads.converted_client_id, but its enquiries carry no file.
--   SELECT count(*) - count(DISTINCT converted_client_id) FROM public.leads
--    WHERE converted_client_id IS NOT NULL;
--
--   -- Converted leads whose file is not on any enquiry. Expect 0; anything
--   -- else is a converted lead with no enquiry rows at all.
--   SELECT count(*) FROM public.leads l
--    WHERE l.converted_client_id IS NOT NULL
--      AND NOT EXISTS (SELECT 1 FROM public.lead_submissions s
--                       WHERE s.converted_client_id = l.converted_client_id);
--
--   -- Enquiries linked to a file, and distinct files on converted leads. Expect equal.
--   SELECT (SELECT count(*) FROM public.lead_submissions WHERE converted_client_id IS NOT NULL) AS enquiries,
--          (SELECT count(DISTINCT converted_client_id) FROM public.leads) AS files;
--
--   -- The unique email rule is gone. Expect 0.
--   SELECT count(*) FROM pg_constraint WHERE conname = 'clients_email_key';
