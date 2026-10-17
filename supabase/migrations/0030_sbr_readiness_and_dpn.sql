-- Migration: director penalty notices, the "none issued" tick, and readiness
-- reviews.
--
-- Additive only: two new tables and five new nullable columns on clients.
-- Nothing existing is changed, so code running before this migration keeps
-- working after it.
--
-- 1. director_penalty_notices — one row per uploaded DPN PDF: what the
--    deterministic parser (src/lib/dpn) read, or what staff entered by hand
--    when it could not. The director's NAME only: the home address printed on
--    the notice is never read into the database. The PDF itself stays in the
--    client's private document storage, as every upload does.
-- 2. clients.no_dpn_* — staff ticking "No director penalty notice has been
--    issued": who and when, and the note left when an upload clears it.
-- 3. sbr_readiness_reviews — staff marking a "Needs review" readiness item
--    as reviewed, tied to a fingerprint of what they reviewed, so new data
--    needs a new review. Written by a later stage; created here so the SBR
--    readiness work needs no further migration for it.

-- ============================================================
-- 1. director_penalty_notices
-- ============================================================

CREATE TABLE IF NOT EXISTS public.director_penalty_notices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  -- The uploaded PDF. One notice per file; deleting the file deletes this.
  document_id uuid NOT NULL UNIQUE REFERENCES public.documents(id) ON DELETE CASCADE,

  -- 'parsed': read from the PDF. 'manual': entered (or corrected) by staff.
  source text NOT NULL CHECK (source IN ('parsed', 'manual')),
  -- 'read': complete. 'needs_review': complete, but something must be looked
  -- at (review_reasons). 'needs_manual': the parser could not read it;
  -- whatever it did read is kept below to prefill the manual form.
  status text NOT NULL CHECK (status IN ('read', 'needs_review', 'needs_manual')),
  manual_reason text CHECK (
    manual_reason IS NULL OR manual_reason IN
      ('sgc', 'table_unreadable', 'missing_fields', 'pdf_unreadable', 'not_a_dpn')
  ),
  -- [{ code, rowIndexes? }], e.g. negative amounts, whose format is unconfirmed.
  review_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,

  reference text,
  issued_on date,
  notice_type text CHECK (notice_type IS NULL OR notice_type IN ('paygw', 'gst', 'sgc')),
  company_name text,
  acn text CHECK (acn IS NULL OR acn ~ '^[0-9]{9}$'),
  -- The name on the notice's "TO:" line. Never the address.
  director_name text,

  -- [{ periodFrom, periodTo, column2, column3, column4, column5 }], cents.
  rows jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Sums of rows, in cents. The notice prints no total row.
  total_column2 bigint,
  total_column3 bigint,
  total_column4 bigint,
  total_column5 bigint,

  parser_version int,
  -- Who entered or corrected it by hand, and when. Null for 'parsed'.
  entered_by text,
  entered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- A manual entry says who made it.
  CONSTRAINT director_penalty_notices_manual_has_author
    CHECK (source <> 'manual' OR (entered_by IS NOT NULL AND entered_at IS NOT NULL)),
  -- Only a notice waiting for manual entry has a manual reason.
  CONSTRAINT director_penalty_notices_reason_matches_status
    CHECK ((status = 'needs_manual') = (manual_reason IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS director_penalty_notices_client_id_idx
  ON public.director_penalty_notices (client_id);

CREATE TRIGGER set_director_penalty_notices_updated_at
  BEFORE UPDATE ON public.director_penalty_notices
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Service role only, as every table 0021 closed: RLS on, no policies.
ALTER TABLE public.director_penalty_notices ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 2. "No director penalty notice has been issued"
-- ============================================================

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS no_dpn_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS no_dpn_confirmed_by text,
  -- Set when uploading a notice clears the tick, with a note saying so.
  ADD COLUMN IF NOT EXISTS no_dpn_cleared_at timestamptz,
  ADD COLUMN IF NOT EXISTS no_dpn_cleared_note text;

ALTER TABLE public.clients
  DROP CONSTRAINT IF EXISTS clients_no_dpn_confirmed_pair,
  ADD CONSTRAINT clients_no_dpn_confirmed_pair
    CHECK ((no_dpn_confirmed_at IS NULL) = (no_dpn_confirmed_by IS NULL));

-- ============================================================
-- 3. sbr_readiness_reviews
-- ============================================================

CREATE TABLE IF NOT EXISTS public.sbr_readiness_reviews (
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  item text NOT NULL CHECK (item IN ('financials', 'lodgement', 'dpn')),
  -- What was reviewed. A review counts only while this still matches.
  fingerprint text NOT NULL,
  reviewed_by text NOT NULL,
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (client_id, item)
);

ALTER TABLE public.sbr_readiness_reviews ENABLE ROW LEVEL SECURITY;
