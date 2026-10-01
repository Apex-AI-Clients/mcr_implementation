-- Migration: keep the company's ABN and the trust's ABN apart.
--
-- A company acting as trustee of a trust has two identities. The company has
-- an ACN and may or may not have its own ABN; the trust has its own ABN and
-- never an ACN. Until now both went into abn_number, so a trust picked in ABN
-- Lookup overwrote the company's ABN, and the other way round.
--
-- From here:
--   abn_number        the COMPANY's own ABN only (2 check digits + its ACN)
--   trust_abn_number  the TRUST's ABN, when the company is a trustee
--   entity_type       'company'  a company trading in its own right
--                     'trust'    a company acting as trustee of a trust
--
-- entity_type lives here as well as on leads, on purpose. The lead keeps what
-- the enquiry said; this is what staff established at conversion or intake,
-- and it decides whether the trust fields are shown and which ABN is required.
-- Nothing writes it back to the lead.
--
-- Depends on 0014 (leads.converted_client_id, leads.entity_type).

ALTER TABLE public.company_details
  ADD COLUMN IF NOT EXISTS trust_abn_number text,
  ADD COLUMN IF NOT EXISTS entity_type text;

-- Backfill: the linked lead's answer if it gave one (the most recently updated
-- lead, should more than one point at this client); otherwise 'trust' when a
-- trust name was recorded; otherwise 'company'.
UPDATE public.company_details AS cd
SET entity_type = COALESCE(
  (
    SELECT l.entity_type
    FROM public.leads AS l
    WHERE l.converted_client_id = cd.client_id
      AND l.entity_type IS NOT NULL
    ORDER BY l.updated_at DESC
    LIMIT 1
  ),
  CASE WHEN btrim(COALESCE(cd.trust_name, '')) <> '' THEN 'trust' ELSE 'company' END
)
WHERE cd.entity_type IS NULL;

-- Every row now has one, and every new row gets the commoner of the two unless
-- the form says otherwise.
ALTER TABLE public.company_details
  ALTER COLUMN entity_type SET DEFAULT 'company',
  ALTER COLUMN entity_type SET NOT NULL;

ALTER TABLE public.company_details
  DROP CONSTRAINT IF EXISTS company_details_entity_type_check,
  ADD CONSTRAINT company_details_entity_type_check
    CHECK (entity_type IN ('company', 'trust'));

-- No data move from abn_number to trust_abn_number here. Rows holding a trust's
-- ABN in abn_number are classified by classifyAbnForBackfill
-- (src/lib/clients/identityBackfill.ts); at the time of writing there were none.
