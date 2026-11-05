-- Migration: a client can be in SBR and CVL at the same time.
--
-- Until now (0039) a client file was in one workspace at a time: moving an SBR
-- client to CVL set clients.workflow = 'cvl', which took it off the SBR list
-- and left its SBR record read-only in the Archive ("Moved to CVL").
--
-- From here each workspace has its own membership:
--
--   In SBR  clients.workflow = 'sbr' and clients.archived_at IS NULL
--           (workflow 'sbr' now means "an SBR client"; 'cvl' means a file
--           that only ever was CVL, e.g. converted straight from a lead)
--   In CVL  a cvl_cases row with removed_at IS NULL
--
-- So:
--   - Moving an SBR client to CVL opens (or reopens) its case and leaves it
--     on the SBR list.
--   - Moving a CVL client to SBR sets workflow = 'sbr' (or, for an SBR client
--     archived from SBR, restores it); it stays in CVL. Done by the app.
--   - "Delete" in CVL sets cvl_cases.removed_at: the file leaves CVL only. A
--     CVL-only file (workflow 'cvl') is also archived, as before.
--   - "Archive" in SBR sets clients.archived_at: the file leaves SBR only;
--     its CVL case carries on.
--
-- Nothing is deleted. Write-only for the user to apply; regenerate
-- src/types/database.ts afterwards (removed_at / removed_by on cvl_cases).

-- ============================================================
-- 1. cvl_cases.removed_at / removed_by: taken off the CVL list
-- ============================================================

ALTER TABLE public.cvl_cases
  ADD COLUMN IF NOT EXISTS removed_at timestamptz,
  ADD COLUMN IF NOT EXISTS removed_by text;

ALTER TABLE public.cvl_cases
  DROP CONSTRAINT IF EXISTS cvl_cases_removed_pair,
  ADD CONSTRAINT cvl_cases_removed_pair CHECK ((removed_at IS NULL) = (removed_by IS NULL));

COMMENT ON COLUMN public.cvl_cases.removed_at IS
  'When the file was taken off the CVL list ("Delete" in CVL). NULL: in CVL. Its forms are kept; moving it to CVL again reopens the case.';

-- The CVL list: cases still in CVL, newest first.
CREATE INDEX IF NOT EXISTS cvl_cases_open_created_idx
  ON public.cvl_cases (created_at DESC)
  WHERE removed_at IS NULL;

-- ============================================================
-- 2. Existing files
-- ============================================================

-- A file archived while in CVL left the CVL list then: it stays off it.
UPDATE public.cvl_cases c
   SET removed_at = cl.archived_at,
       removed_by = COALESCE(cl.archived_by, 'archived')
  FROM public.clients cl
 WHERE cl.id = c.client_id
   AND cl.archived_at IS NOT NULL
   AND c.removed_at IS NULL;

-- SBR clients moved to CVL go back on the SBR list (they stay in CVL).
UPDATE public.clients cl
   SET workflow = 'sbr', updated_at = now()
  FROM public.cvl_cases c
 WHERE c.client_id = cl.id
   AND c.origin = 'sbr_client'
   AND cl.workflow = 'cvl';

-- ============================================================
-- 3. cvl_convert_client: an SBR client → also in CVL
-- ============================================================
--
-- Opens the client's case, or reopens it when it was taken off the CVL list
-- (its forms are kept). The client stays an SBR client. sbr_archived_at /
-- _by keep their 0039 meaning of "when, and by whom, it was moved to CVL".
--
-- Raises (the route maps these):
--   P0002  no such client
--   55000  not an SBR client on the list, or already in CVL

CREATE OR REPLACE FUNCTION public.cvl_convert_client(p_client_id uuid, p_by text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_client record;
  v_case record;
  v_case_id uuid;
BEGIN
  SELECT id, workflow, archived_at INTO v_client
    FROM public.clients WHERE id = p_client_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'client not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_client.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'client is archived' USING ERRCODE = '55000';
  END IF;
  IF v_client.workflow <> 'sbr' THEN
    RAISE EXCEPTION 'client is already in CVL' USING ERRCODE = '55000';
  END IF;

  SELECT id, removed_at INTO v_case
    FROM public.cvl_cases WHERE client_id = p_client_id FOR UPDATE;
  IF FOUND THEN
    IF v_case.removed_at IS NULL THEN
      RAISE EXCEPTION 'client is already in CVL' USING ERRCODE = '55000';
    END IF;
    UPDATE public.cvl_cases SET removed_at = NULL, removed_by = NULL WHERE id = v_case.id;
    RETURN v_case.id;
  END IF;

  INSERT INTO public.cvl_cases (client_id, origin, sbr_archived_at, sbr_archived_by, created_by)
  VALUES (p_client_id, 'sbr_client', now(), p_by, p_by)
  RETURNING id INTO v_case_id;

  RETURN v_case_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cvl_convert_client(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cvl_convert_client(uuid, text) TO service_role;

-- Check after applying:
--
--   -- No moved SBR client is still marked CVL-only.
--   SELECT count(*) FROM public.clients cl JOIN public.cvl_cases c ON c.client_id = cl.id
--    WHERE c.origin = 'sbr_client' AND cl.workflow = 'cvl';          -- 0
--
--   -- No archived file is still on the CVL list.
--   SELECT count(*) FROM public.cvl_cases c JOIN public.clients cl ON cl.id = c.client_id
--    WHERE cl.archived_at IS NOT NULL AND cl.workflow = 'cvl' AND c.removed_at IS NULL;  -- 0
