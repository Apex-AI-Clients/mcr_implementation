-- Migration: ASIC company extracts, and what conversion fills in from them.
--
-- An ASIC Current Company Extract costs money (about $10 each), so every one
-- bought is kept here permanently and offered again free the next time the
-- same ACN comes up. The row is written *before* the provider is called, as
-- 'pending', which is what makes the money rules enforceable in the database
-- rather than hoped for in the browser:
--
--   - one purchase in flight per ACN and mode (partial unique index below), so
--     two staff clicking at once cannot both be charged
--   - one row per click (idempotency_key UNIQUE); a retry after a timeout
--     finds its own row and calls the provider again with the same
--     Idempotency-Key, which the provider de-duplicates
--   - the per-user purchase limit is a count over this table, so it holds
--     across serverless instances and survives a deploy
--
-- mode separates demo, sandbox (test) and live extracts. The cache is always
-- read for the current mode only, so a demo or sandbox extract can never be
-- served as a live one.
--
-- What is NOT stored: shareholders/members (names and residential addresses)
-- and officeholder addresses. The app strips them from `raw` before insert.
-- summary holds only what the forms use.
--
-- RLS on, no policies, privileges revoked: only the service role (API routes)
-- touches this table. See 0020 for why that is spelled out.

-- ============================================================
-- TABLE: asic_extracts
-- ============================================================

CREATE TABLE IF NOT EXISTS public.asic_extracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 9 digits, unspaced — the same shape as company_details.acn_number.
  acn text NOT NULL CHECK (acn ~ '^[0-9]{9}$'),
  provider text NOT NULL CHECK (provider IN ('demo', 'asicapi')),
  mode text NOT NULL CHECK (mode IN ('demo', 'test', 'live')),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'complete', 'failed')),
  -- One per click, generated in the browser and reused on retry.
  idempotency_key uuid NOT NULL UNIQUE,
  provider_extract_id text,
  -- What this extract cost, or would have: 0 for demo and sandbox.
  fee_cents integer NOT NULL CHECK (fee_cents >= 0),
  -- When ASIC's data was current, as the provider reports it.
  as_of timestamptz,
  purchased_at timestamptz,
  -- Normalised: name, ACN, ABN, status, the two addresses, current directors.
  summary jsonb,
  -- Provider response, members and officeholder addresses removed.
  raw jsonb,
  ordered_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- A short tag ('timeout', 'provider_4xx', …). Never provider text or a key.
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Also marks when a pending purchase was last attempted, so a stuck one can
  -- be taken over after a few minutes.
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- The demo provider only ever produces demo extracts, and asicapi never does.
  CONSTRAINT asic_extracts_provider_mode CHECK ((provider = 'demo') = (mode = 'demo')),
  -- A complete extract always has something to serve.
  CONSTRAINT asic_extracts_complete_has_summary
    CHECK (status <> 'complete' OR (summary IS NOT NULL AND purchased_at IS NOT NULL))
);

ALTER TABLE public.asic_extracts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.asic_extracts FROM anon, authenticated;

CREATE TRIGGER set_asic_extracts_updated_at
  BEFORE UPDATE ON public.asic_extracts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- The concurrency guard: at most one purchase in flight per ACN and mode.
CREATE UNIQUE INDEX IF NOT EXISTS asic_extracts_one_pending_idx
  ON public.asic_extracts (acn, mode)
  WHERE status = 'pending';

-- The cache read: newest complete extract for this ACN in this mode.
CREATE INDEX IF NOT EXISTS asic_extracts_cache_idx
  ON public.asic_extracts (acn, mode, purchased_at DESC)
  WHERE status = 'complete';

-- The purchase rate limit: this user's attempts in the last hour.
CREATE INDEX IF NOT EXISTS asic_extracts_ordered_by_idx
  ON public.asic_extracts (ordered_by, created_at DESC);

-- ============================================================
-- company_details: what an extract fills in
-- ============================================================
--
-- All optional and all editable. Absent vs empty (src/lib/clients/
-- companyDetails.ts) applies here too: directors NULL means never set, '[]'
-- means somebody removed them all.
--
-- directors is an array of { "name": text, "dateOfBirth": text | null }, with
-- dateOfBirth ISO at whatever precision is known: 'YYYY-MM-DD', 'YYYY-MM' or
-- 'YYYY'. No addresses and no appointment dates.

ALTER TABLE public.company_details
  ADD COLUMN IF NOT EXISTS registered_office_address text,
  ADD COLUMN IF NOT EXISTS principal_place_of_business text,
  ADD COLUMN IF NOT EXISTS directors jsonb
    CONSTRAINT company_details_directors_is_array
    CHECK (directors IS NULL OR jsonb_typeof(directors) = 'array'),
  ADD COLUMN IF NOT EXISTS asic_extract_id uuid
    REFERENCES public.asic_extracts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS company_details_asic_extract_id_idx
  ON public.company_details (asic_extract_id)
  WHERE asic_extract_id IS NOT NULL;

-- ============================================================
-- A file is never recorded as sourced from another company's extract
-- ============================================================
--
-- If the ACN on the record stops matching the linked extract — somebody edits
-- the ACN at conversion or on intake, by any code path — the link is dropped.
-- The values the extract filled in stay (they are the user's to edit or keep);
-- only the claim that they came from ASIC for this company goes.
--
-- Also refuses, by unlinking, a link to an extract that is not complete. Done
-- here rather than in each API route so no writer can forget it.

CREATE OR REPLACE FUNCTION public.company_details_check_asic_link()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.asic_extract_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.asic_extracts e
    WHERE e.id = NEW.asic_extract_id
      AND e.status = 'complete'
      AND e.acn = regexp_replace(coalesce(NEW.acn_number, ''), '[^0-9]', '', 'g')
  ) THEN
    NEW.asic_extract_id := NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER company_details_check_asic_link
  BEFORE INSERT OR UPDATE OF acn_number, asic_extract_id ON public.company_details
  FOR EACH ROW EXECUTE FUNCTION public.company_details_check_asic_link();
