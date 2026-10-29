-- Migration: the ASIC extract kept on the client file, and the two dates the
-- CVL forms need from it.
--
-- Additive. PENDING GABBY'S CONFIRMATION (CRM_CHANGES.md): until now the
-- extract PDF was parse-only and never stored.
--
-- 1. company_details.registration_date: the company's registration date, from
--    the extract's Organisation Details. Directors' appointment dates go in the
--    existing company_details.directors JSON as "appointedOn" (no new column).
--
-- 2. client_asic_extracts: each ASIC extract PDF uploaded for a client from now
--    on, kept privately in the documents bucket at {client_id}/asic/{uuid}.pdf,
--    so the CVL screens' ⓘ can open the file at its page. Not a documents row:
--    it is not an upload slot, is never classified or analysed, and is not
--    counted in the document checklist. Existing clients have none until the
--    extract is uploaded again ("Upload the ASIC extract again to fill").
--
--    Only the file is kept. The database still holds only what the forms use
--    (name, ACN, ABN, addresses, directors with dates of birth and appointment
--    dates, registration date): never the shareholder or residential sections,
--    which the parser does not read.

ALTER TABLE public.company_details
  ADD COLUMN IF NOT EXISTS registration_date date;

COMMENT ON COLUMN public.company_details.registration_date IS
  'Registration date from the ASIC extract (migration 0041). Directors'' appointment dates are directors[].appointedOn.';

CREATE TABLE IF NOT EXISTS public.client_asic_extracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  -- {client_id}/asic/{uuid}.pdf in the private documents bucket.
  file_path text NOT NULL UNIQUE,
  page_count integer NOT NULL CHECK (page_count > 0),
  -- The ACN the extract is for, and its own date and time (the cover's "as at").
  acn text NOT NULL CHECK (acn ~ '^[0-9]{9}$'),
  extracted_at timestamptz,
  -- Which page each part is printed on, for the ⓘ links: {"organisation": 1,
  -- "addresses": 1, "directors": 2}. Page numbers only.
  section_pages jsonb NOT NULL DEFAULT '{}'::jsonb,
  uploaded_by text NOT NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);

-- The newest extract per client is the one the CVL screens point to.
CREATE INDEX IF NOT EXISTS client_asic_extracts_client_idx
  ON public.client_asic_extracts (client_id, uploaded_at DESC);

-- Service role only: RLS on, no policies.
ALTER TABLE public.client_asic_extracts ENABLE ROW LEVEL SECURITY;
