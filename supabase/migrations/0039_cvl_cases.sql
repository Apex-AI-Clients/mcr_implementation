-- Migration: CVL (creditors' voluntary liquidation) client files.
--
-- Additive: code running before this migration keeps working after it. Every
-- existing client is an SBR client (the default below), and nothing here
-- touches the SBR tables.
--
-- 1. clients.workflow: which workspace a client file belongs to.
--      'sbr'  the SBR workspace (every client before this migration)
--      'cvl'  the CVL workspace
--    A client file is in one workspace at a time. Its documents, company and
--    accountant details, analyses and DPNs stay keyed on client_id, so a file
--    moved to CVL takes all of them with it and nothing is copied.
--
-- 2. cvl_cases: one per CVL client file.
--      origin 'sbr_client'  converted from an SBR client; its SBR record is
--                           kept read-only (sbr_archived_at / _by) and listed
--                           under "Moved to CVL" in the SBR Archive
--      origin 'lead'        converted straight from a lead; never in SBR
--    status: draft → forms_prepared → printed, each step with its date.
--    The four case dates have no default: they are blank until staff enter
--    them (pending Gabby's confirmation).
--
-- 3. cvl_form_answers: the entry-screen drafts (Stage 3), one per form and
--    subject ('company', or 'director:<n>' for a Part B per director), with
--    the form version they were written against. Anything written by hand on
--    the printout is refused here as well as stripped by the API: the B6
--    user name and password, the B1 address, and every date beside a
--    signature (src/lib/forms/registry.ts handwrittenKeys()).
--
-- 4. cvl_generated_documents: each PDF generated (Stage 4), kept privately in
--    the documents bucket at {client_id}/{uuid}.pdf. Not a documents row, so
--    it never shows as an upload.
--
-- 5. cvl_settings: the CVL settings page. A value is NULL until set: no
--    defaults (pending Gabby's confirmation). confirmed = false shows "To be
--    confirmed by Gabby".
--
-- 6. cvl_convert_client(): moves an SBR client to CVL in one transaction.
--
-- Service role only, as every table 0021 closed: RLS on, no policies.

-- ============================================================
-- 1. clients.workflow
-- ============================================================

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS workflow text NOT NULL DEFAULT 'sbr';

ALTER TABLE public.clients
  DROP CONSTRAINT IF EXISTS clients_workflow_check,
  ADD CONSTRAINT clients_workflow_check CHECK (workflow IN ('sbr', 'cvl'));

-- The CVL list reads the few CVL files; the SBR list filters them out.
CREATE INDEX IF NOT EXISTS idx_clients_workflow_cvl
  ON public.clients (created_at DESC)
  WHERE workflow = 'cvl';

COMMENT ON COLUMN public.clients.workflow IS
  'The workspace the client file is in: sbr or cvl (migration 0039).';

-- ============================================================
-- 2. cvl_cases
-- ============================================================

CREATE TABLE IF NOT EXISTS public.cvl_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL UNIQUE REFERENCES public.clients(id) ON DELETE CASCADE,
  origin text NOT NULL CHECK (origin IN ('lead', 'sbr_client')),

  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'forms_prepared', 'printed')),
  forms_prepared_at timestamptz,
  printed_at timestamptz,

  -- Converted from an SBR client: when its SBR record became read-only, and who.
  sbr_archived_at timestamptz,
  sbr_archived_by text,

  -- No defaults: blank until entered.
  appointment_date date,
  summary_date date,
  report_date date,
  report_return_date date,

  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- Only a file that was an SBR client has an archived SBR record.
  CONSTRAINT cvl_cases_sbr_archive_matches_origin
    CHECK ((origin = 'sbr_client') = (sbr_archived_at IS NOT NULL)),
  CONSTRAINT cvl_cases_sbr_archive_pair
    CHECK ((sbr_archived_at IS NULL) = (sbr_archived_by IS NULL)),
  -- Each status carries its own dates and no later ones.
  CONSTRAINT cvl_cases_status_dates
    CHECK (
      (status = 'draft' AND forms_prepared_at IS NULL AND printed_at IS NULL)
      OR (status = 'forms_prepared' AND forms_prepared_at IS NOT NULL AND printed_at IS NULL)
      OR (status = 'printed' AND forms_prepared_at IS NOT NULL AND printed_at IS NOT NULL)
    )
);

-- "Moved to CVL" in the SBR Archive, newest first.
CREATE INDEX IF NOT EXISTS cvl_cases_sbr_archived_at_idx
  ON public.cvl_cases (sbr_archived_at DESC)
  WHERE sbr_archived_at IS NOT NULL;

CREATE TRIGGER set_cvl_cases_updated_at
  BEFORE UPDATE ON public.cvl_cases
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE public.cvl_cases ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 3. cvl_form_answers
-- ============================================================

CREATE TABLE IF NOT EXISTS public.cvl_form_answers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.cvl_cases(id) ON DELETE CASCADE,
  form_code text NOT NULL CHECK (form_code IN ('509', '507a', '507b')),
  -- ASIC's version of the form the answers were written against, e.g. '20220801'.
  form_version text NOT NULL,
  subject text NOT NULL CHECK (subject = 'company' OR subject ~ '^director:[0-9]+$'),
  answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Keys staff changed from the pre-filled value.
  edited_keys text[] NOT NULL DEFAULT '{}',
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (case_id, form_code, subject),

  -- Written by hand on the printout, never stored (the API strips them too).
  CONSTRAINT cvl_form_answers_no_handwritten
    CHECK (
      jsonb_typeof(answers) = 'object'
      AND NOT (answers ?| ARRAY[
        'b6_username', 'b6_password',
        'b1_address', 'b1_street', 'b1_suburb', 'b1_state', 'b1_postcode',
        'date_signed', 'a9_date', 'a10_date', 'f507a_date_signed', 'b31_date',
        'signedDate'
      ])
      AND NOT (COALESCE(answers -> 'fields', '{}'::jsonb) ?| ARRAY[
        'b6_username', 'b6_password',
        'b1_address', 'b1_street', 'b1_suburb', 'b1_state', 'b1_postcode',
        'date_signed', 'a9_date', 'a10_date', 'f507a_date_signed', 'b31_date'
      ])
    )
);

ALTER TABLE public.cvl_form_answers ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 4. cvl_generated_documents
-- ============================================================

CREATE TABLE IF NOT EXISTS public.cvl_generated_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.cvl_cases(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  -- One form, or 'all' (every form in one PDF).
  form_code text NOT NULL CHECK (form_code IN ('509', '507a', '507b', 'all')),
  -- Each form's version in the file, e.g. {"509": "2011", "507a": "20220801"}.
  form_versions jsonb NOT NULL,
  subject text NOT NULL CHECK (subject IN ('company', 'all') OR subject ~ '^director:[0-9]+$'),
  -- {client_id}/{uuid}.pdf in the private documents bucket.
  file_path text NOT NULL UNIQUE,
  answers_snapshot jsonb NOT NULL,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  generated_by text NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cvl_generated_documents_case_idx
  ON public.cvl_generated_documents (case_id, generated_at DESC);

ALTER TABLE public.cvl_generated_documents ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 5. cvl_settings
-- ============================================================

CREATE TABLE IF NOT EXISTS public.cvl_settings (
  key text PRIMARY KEY,
  -- NULL until set. There are no defaults.
  value jsonb,
  -- false: "To be confirmed by Gabby".
  confirmed boolean NOT NULL DEFAULT false,
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.cvl_settings ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 6. cvl_convert_client: an SBR client → CVL, all or nothing
-- ============================================================
--
-- Moves the file to the CVL workspace and opens its case in one transaction,
-- so a file is never in CVL without a case or left in SBR with one. Nothing
-- is deleted or copied: documents and analyses stay on client_id.
--
-- Raises (the route maps these):
--   P0002  no such client
--   55000  the client is archived, or already in CVL

CREATE OR REPLACE FUNCTION public.cvl_convert_client(p_client_id uuid, p_by text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_client record;
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

  UPDATE public.clients SET workflow = 'cvl', updated_at = now() WHERE id = p_client_id;

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
--   -- Every existing client is still SBR.
--   SELECT workflow, count(*) FROM public.clients GROUP BY workflow;
--
--   -- RLS on, no policies.
--   SELECT relname, relrowsecurity FROM pg_class
--    WHERE relname IN ('cvl_cases', 'cvl_form_answers', 'cvl_generated_documents', 'cvl_settings');
--   SELECT tablename, policyname FROM pg_policies WHERE tablename LIKE 'cvl_%';
