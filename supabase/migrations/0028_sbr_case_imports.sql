-- Migration: historical SBR case imports (the Prediction Data page).
--
-- Staff upload Gabby's workbook (or a CSV). The app validates every row and
-- shows a preview; nothing is saved until "Confirm import", which calls
-- sbr_apply_case_import: the new cases plus the corrections staff ticked, in
-- one transaction. "Undo this upload" calls sbr_undo_case_import.
--
--   sbr_case_imports             one row per confirmed upload (the history)
--   sbr_case_import_corrections  one row per case an upload corrected, with
--                                the values it replaced, so undo can put
--                                them back. A case corrected by two uploads
--                                has two rows.
--   sbr_historical_cases         + import_id: the upload that ADDED the case
--                                  (null for the seeded cases). Corrections
--                                  are traced through the table above.
--                                + name_key: the normalised client name,
--                                  generated, unique. Matching an upload
--                                  against the table uses it.
--                                + the detail columns the workbook carries.
--   sbr_outcome_predictions      + practitioner_fee_rate, chosen per client.
--
-- A prediction is stale when an import or an undo happened after it was
-- computed. That is read from sbr_case_imports at display time; nothing here
-- marks predictions.
--
-- days_since_last_payment keeps its 9999 sentinel for "no payments ever" for
-- now, so the code running in production keeps working while this is applied.
-- no_payments_ever is generated from it; a later migration turns it into a
-- plain column and drops the sentinel.
--
-- The cases already in the table are not re-validated: two of the seeded
-- cases fall outside the 80–110% payment / C$ check and stay in use; the page
-- flags them.
--
-- Safe to re-run. One transaction. No backfill beyond the generated columns.

BEGIN;

-- ============================================================
-- 1. sbr_name_key: the normalised name used for matching
-- ============================================================
--
-- lowercase; & = and; anything but a-z, 0-9 and space becomes a space; the
-- words pty, ltd, limited and the are dropped; spaces collapsed and trimmed.
--
--   'Wheel''n & Deal''n Pty Ltd'  ->  'wheel n and deal n'
--   'The Example Co Pty Limited'  ->  'example co'
--
-- src/lib/sbr/import/normalise.ts (nameKey) must give the same answer; the
-- database test compares the two on synthetic names. Changing this function
-- means recomputing name_key (it is stored).

CREATE OR REPLACE FUNCTION public.sbr_name_key(p_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT pg_catalog.btrim(
    pg_catalog.regexp_replace(
      pg_catalog.regexp_replace(
        pg_catalog.regexp_replace(
          pg_catalog.replace(pg_catalog.lower(p_name), '&', ' and '),
          '[^a-z0-9 ]', ' ', 'g'),
        '\m(pty|ltd|limited|the)\M', ' ', 'g'),
      '\s+', ' ', 'g'))
$$;

-- ============================================================
-- 2. sbr_case_imports
-- ============================================================

CREATE TABLE IF NOT EXISTS public.sbr_case_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Who confirmed it, as staffAuthorName() gives it. Display only.
  uploaded_by text NOT NULL,
  uploaded_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  file_name text NOT NULL,
  -- When it was confirmed (set by sbr_apply_case_import, after its lock).
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  -- { added, corrected, already_have, corrections_not_applied, rejected }
  counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  undone_at timestamptz,
  undone_by text,

  CONSTRAINT sbr_case_imports_file_name_check
    CHECK (length(btrim(file_name)) BETWEEN 1 AND 255),
  CONSTRAINT sbr_case_imports_counts_check
    CHECK (jsonb_typeof(counts) = 'object'),
  -- Undone and by whom go together.
  CONSTRAINT sbr_case_imports_undone_consistent
    CHECK ((undone_at IS NULL) = (undone_by IS NULL))
);

CREATE INDEX IF NOT EXISTS sbr_case_imports_uploaded_at_idx
  ON public.sbr_case_imports (uploaded_at DESC);

CREATE INDEX IF NOT EXISTS sbr_case_imports_uploaded_by_user_id_idx
  ON public.sbr_case_imports (uploaded_by_user_id);

ALTER TABLE public.sbr_case_imports ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 3. sbr_historical_cases: new columns
-- ============================================================

ALTER TABLE public.sbr_historical_cases
  ADD COLUMN IF NOT EXISTS import_id uuid
    REFERENCES public.sbr_case_imports(id),
  ADD COLUMN IF NOT EXISTS name_key text
    GENERATED ALWAYS AS (public.sbr_name_key(client_name)) STORED,
  -- "Plan 24 Months" -> 'plan' + 24. Null for upfront and for a plain "Plan".
  ADD COLUMN IF NOT EXISTS term_months integer,
  ADD COLUMN IF NOT EXISTS no_payments_ever boolean
    GENERATED ALWAYS AS (days_since_last_payment = 9999) STORED,
  -- The director-loan cell as written, e.g. 'Yes (Payable)'.
  ADD COLUMN IF NOT EXISTS director_loan_raw text,
  -- The amount on a payable loan, which counts as no receivable loan.
  ADD COLUMN IF NOT EXISTS director_loan_payable_amount numeric,
  ADD COLUMN IF NOT EXISTS business_type text,
  ADD COLUMN IF NOT EXISTS number_of_creditors integer,
  -- The row as uploaded: header -> cell text.
  ADD COLUMN IF NOT EXISTS raw jsonb,
  -- Excluded cases stay in the table but are never used to predict.
  ADD COLUMN IF NOT EXISTS excluded boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS excluded_reason text;

ALTER TABLE public.sbr_historical_cases
  DROP CONSTRAINT IF EXISTS sbr_historical_cases_term_months_check,
  ADD CONSTRAINT sbr_historical_cases_term_months_check
    CHECK (term_months IS NULL OR (payment_plan_type = 'plan' AND term_months BETWEEN 1 AND 120)),
  DROP CONSTRAINT IF EXISTS sbr_historical_cases_payable_amount_check,
  ADD CONSTRAINT sbr_historical_cases_payable_amount_check
    CHECK (director_loan_payable_amount IS NULL OR director_loan_payable_amount >= 0),
  DROP CONSTRAINT IF EXISTS sbr_historical_cases_number_of_creditors_check,
  ADD CONSTRAINT sbr_historical_cases_number_of_creditors_check
    CHECK (number_of_creditors IS NULL OR number_of_creditors >= 0),
  DROP CONSTRAINT IF EXISTS sbr_historical_cases_raw_check,
  ADD CONSTRAINT sbr_historical_cases_raw_check
    CHECK (raw IS NULL OR jsonb_typeof(raw) = 'object'),
  -- Excluded and its reason go together; a reason is a sentence, not blank.
  DROP CONSTRAINT IF EXISTS sbr_historical_cases_excluded_consistent,
  ADD CONSTRAINT sbr_historical_cases_excluded_consistent
    CHECK (excluded = (excluded_reason IS NOT NULL)
           AND (excluded_reason IS NULL OR length(btrim(excluded_reason)) > 0));

-- One case per normalised name. The 59 seeded names give 59 distinct keys.
CREATE UNIQUE INDEX IF NOT EXISTS sbr_historical_cases_name_key_key
  ON public.sbr_historical_cases (name_key);

CREATE INDEX IF NOT EXISTS sbr_historical_cases_import_id_idx
  ON public.sbr_historical_cases (import_id);

-- ============================================================
-- 4. sbr_case_import_corrections
-- ============================================================

CREATE TABLE IF NOT EXISTS public.sbr_case_import_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id uuid NOT NULL REFERENCES public.sbr_case_imports(id),
  -- Null once the case itself is gone (its adding upload was undone); the
  -- record of what this upload changed is kept.
  case_id uuid REFERENCES public.sbr_historical_cases(id) ON DELETE SET NULL,
  -- The name at the time, for the history when case_id is null.
  client_name text NOT NULL,
  -- Only the columns this correction changed: column -> value before / after.
  previous jsonb NOT NULL,
  applied jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT sbr_case_import_corrections_import_case_key UNIQUE (import_id, case_id),
  CONSTRAINT sbr_case_import_corrections_values_check
    CHECK (jsonb_typeof(previous) = 'object' AND jsonb_typeof(applied) = 'object')
);

CREATE INDEX IF NOT EXISTS sbr_case_import_corrections_case_id_idx
  ON public.sbr_case_import_corrections (case_id);

ALTER TABLE public.sbr_case_import_corrections ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 5. sbr_outcome_predictions: the practitioner fee
-- ============================================================
--
-- 0.125 is the default the app also holds (src/lib/sbr/fees.ts). Existing
-- predictions were all computed at 12.5%.

ALTER TABLE public.sbr_outcome_predictions
  ADD COLUMN IF NOT EXISTS practitioner_fee_rate numeric NOT NULL DEFAULT 0.125;

ALTER TABLE public.sbr_outcome_predictions
  DROP CONSTRAINT IF EXISTS sbr_outcome_predictions_fee_rate_check,
  ADD CONSTRAINT sbr_outcome_predictions_fee_rate_check
    CHECK (practitioner_fee_rate >= 0 AND practitioner_fee_rate < 1);

-- ============================================================
-- 6. FUNCTION: sbr_apply_case_import
-- ============================================================
--
-- Saves one confirmed upload, all or nothing:
--
--   p_import       { uploaded_by, uploaded_by_user_id, file_name, counts }
--   p_new_cases    [ { client_name, dpn, payment_plan_type, ... } ]  column
--                  names of sbr_historical_cases. id, import_id, added_at and
--                  the generated columns are set here whatever it carries.
--   p_corrections  [ { case_id, expected: {col: value}, values: {col: value} } ]
--                  expected = what the app read for exactly those columns.
--
-- Uploads and undos run one at a time (advisory lock). A correction whose case
-- no longer holds `expected` fails the whole call with 40001, as does a new
-- case whose name_key now exists (23505): the data changed since the preview,
-- and the app asks staff to upload again. Nothing is half-saved.
--
-- Returns the new sbr_case_imports id.

CREATE OR REPLACE FUNCTION public.sbr_apply_case_import(
  p_import jsonb,
  p_new_cases jsonb,
  p_corrections jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  -- The columns a correction may change. Never the name (it is how the row
  -- was matched), the id, the audit columns or the generated ones.
  c_correctable constant text[] := ARRAY[
    'dpn', 'payment_plan_type', 'term_months',
    'director_loan_at_appointment', 'director_loan_raw',
    'director_loan_receivable_amount', 'director_loan_payable_amount',
    'cumulative_days_late', 'number_of_late_lodgements', 'days_since_last_payment',
    'outcome_percent', 'accepted', 'creditor_amount', 'sbr_payment',
    'business_type', 'number_of_creditors', 'raw'
  ];
  v_import_id uuid;
  v_correction jsonb;
  v_values jsonb;
  v_case public.sbr_historical_cases;
  v_current jsonb;
  v_previous jsonb;
  v_new public.sbr_historical_cases;
BEGIN
  IF p_import IS NULL OR jsonb_typeof(p_import) <> 'object' THEN
    RAISE EXCEPTION 'sbr_apply_case_import: p_import must be an object' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(COALESCE(p_new_cases, 'null'::jsonb)) <> 'array'
     OR jsonb_typeof(COALESCE(p_corrections, 'null'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'sbr_apply_case_import: p_new_cases and p_corrections must be arrays'
      USING ERRCODE = '22023';
  END IF;

  -- One upload or undo at a time, held to the end of the transaction.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('sbr_case_imports', 0));

  -- clock_timestamp(), not now(): taken after the lock, so imports and undos
  -- are ordered the way they actually ran.
  INSERT INTO public.sbr_case_imports (uploaded_by, uploaded_by_user_id, file_name, uploaded_at, counts)
  VALUES (
    p_import->>'uploaded_by',
    (p_import->>'uploaded_by_user_id')::uuid,
    p_import->>'file_name',
    pg_catalog.clock_timestamp(),
    COALESCE(p_import->'counts', '{}'::jsonb)
  )
  RETURNING id INTO v_import_id;

  -- Corrections first: they check the rows as the preview saw them.
  FOR v_correction IN SELECT * FROM jsonb_array_elements(p_corrections) LOOP
    v_values := v_correction->'values';
    IF jsonb_typeof(v_values) IS DISTINCT FROM 'object'
       OR jsonb_typeof(v_correction->'expected') IS DISTINCT FROM 'object'
       OR v_values = '{}'::jsonb THEN
      RAISE EXCEPTION 'sbr_apply_case_import: a correction needs expected and values objects'
        USING ERRCODE = '22023';
    END IF;
    IF EXISTS (
      SELECT 1 FROM jsonb_object_keys(v_values) k WHERE k <> ALL (c_correctable)
    ) THEN
      RAISE EXCEPTION 'sbr_apply_case_import: a correction names a column it may not change'
        USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_case
      FROM public.sbr_historical_cases c
     WHERE c.id = (v_correction->>'case_id')::uuid
       FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'sbr_apply_case_import: a case to correct no longer exists'
        USING ERRCODE = '40001';
    END IF;

    v_current := to_jsonb(v_case);
    SELECT COALESCE(jsonb_object_agg(k, v_current->k), '{}'::jsonb) INTO v_previous
      FROM jsonb_object_keys(v_values) k;
    -- jsonb compares numbers by value (40.3 = 40.30) and objects by content.
    IF v_previous IS DISTINCT FROM (v_correction->'expected') THEN
      RAISE EXCEPTION 'sbr_apply_case_import: a case changed since the preview'
        USING ERRCODE = '40001';
    END IF;

    v_new := jsonb_populate_record(v_case, v_values);
    UPDATE public.sbr_historical_cases c
       SET dpn                             = v_new.dpn,
           payment_plan_type               = v_new.payment_plan_type,
           term_months                     = v_new.term_months,
           director_loan_at_appointment    = v_new.director_loan_at_appointment,
           director_loan_raw               = v_new.director_loan_raw,
           director_loan_receivable_amount = v_new.director_loan_receivable_amount,
           director_loan_payable_amount    = v_new.director_loan_payable_amount,
           cumulative_days_late            = v_new.cumulative_days_late,
           number_of_late_lodgements       = v_new.number_of_late_lodgements,
           days_since_last_payment         = v_new.days_since_last_payment,
           outcome_percent                 = v_new.outcome_percent,
           accepted                        = v_new.accepted,
           creditor_amount                 = v_new.creditor_amount,
           sbr_payment                     = v_new.sbr_payment,
           business_type                   = v_new.business_type,
           number_of_creditors             = v_new.number_of_creditors,
           raw                             = v_new.raw
     WHERE c.id = v_case.id;

    INSERT INTO public.sbr_case_import_corrections (import_id, case_id, client_name, previous, applied)
    VALUES (v_import_id, v_case.id, v_case.client_name, v_previous, v_values);
  END LOOP;

  INSERT INTO public.sbr_historical_cases (
    client_name, dpn, payment_plan_type, term_months,
    director_loan_at_appointment, director_loan_raw,
    director_loan_receivable_amount, director_loan_payable_amount,
    cumulative_days_late, number_of_late_lodgements, days_since_last_payment,
    outcome_percent, accepted, creditor_amount, sbr_payment,
    business_type, number_of_creditors, raw, import_id
  )
  SELECT
    r.client_name, r.dpn, r.payment_plan_type, r.term_months,
    r.director_loan_at_appointment, r.director_loan_raw,
    COALESCE(r.director_loan_receivable_amount, 0), r.director_loan_payable_amount,
    r.cumulative_days_late, r.number_of_late_lodgements, r.days_since_last_payment,
    r.outcome_percent, r.accepted, r.creditor_amount, r.sbr_payment,
    r.business_type, r.number_of_creditors, r.raw, v_import_id
  FROM jsonb_populate_recordset(NULL::public.sbr_historical_cases, p_new_cases) r;

  RETURN v_import_id;
END;
$$;

-- ============================================================
-- 7. FUNCTION: sbr_undo_case_import
-- ============================================================
--
-- Reverses one upload, all or nothing: puts back the values its corrections
-- replaced, deletes the cases it added, and marks it undone.
--
-- Refuses (55000) when a later upload that is still in force corrected a case
-- this one added or corrected — undo that one first. Refuses (55000) when it
-- is already undone; 'P0002' when there is no such upload.
--
-- Returns { deleted, restored }.

CREATE OR REPLACE FUNCTION public.sbr_undo_case_import(
  p_import_id uuid,
  p_undone_by text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_import public.sbr_case_imports;
  v_correction public.sbr_case_import_corrections;
  v_case public.sbr_historical_cases;
  v_new public.sbr_historical_cases;
  v_restored integer := 0;
  v_deleted integer := 0;
BEGIN
  IF p_undone_by IS NULL OR btrim(p_undone_by) = '' THEN
    RAISE EXCEPTION 'sbr_undo_case_import: p_undone_by is required' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('sbr_case_imports', 0));

  SELECT * INTO v_import
    FROM public.sbr_case_imports i
   WHERE i.id = p_import_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'sbr_undo_case_import: no such upload' USING ERRCODE = 'P0002';
  END IF;
  IF v_import.undone_at IS NOT NULL THEN
    RAISE EXCEPTION 'sbr_undo_case_import: this upload is already undone' USING ERRCODE = '55000';
  END IF;

  -- A later upload, still in force, that corrected a case this one touched.
  IF EXISTS (
    SELECT 1
      FROM public.sbr_case_import_corrections later
      JOIN public.sbr_case_imports li ON li.id = later.import_id
     WHERE li.undone_at IS NULL
       AND (li.uploaded_at, li.id) > (v_import.uploaded_at, v_import.id)
       AND later.case_id IN (
             SELECT c.id FROM public.sbr_historical_cases c WHERE c.import_id = v_import.id
             UNION
             SELECT mine.case_id FROM public.sbr_case_import_corrections mine
              WHERE mine.import_id = v_import.id AND mine.case_id IS NOT NULL
           )
  ) THEN
    RAISE EXCEPTION 'sbr_undo_case_import: a later upload changed the same cases; undo it first'
      USING ERRCODE = '55000';
  END IF;

  FOR v_correction IN
    SELECT * FROM public.sbr_case_import_corrections k
     WHERE k.import_id = v_import.id AND k.case_id IS NOT NULL
  LOOP
    SELECT * INTO v_case
      FROM public.sbr_historical_cases c
     WHERE c.id = v_correction.case_id
       FOR UPDATE;
    v_new := jsonb_populate_record(v_case, v_correction.previous);
    UPDATE public.sbr_historical_cases c
       SET dpn                             = v_new.dpn,
           payment_plan_type               = v_new.payment_plan_type,
           term_months                     = v_new.term_months,
           director_loan_at_appointment    = v_new.director_loan_at_appointment,
           director_loan_raw               = v_new.director_loan_raw,
           director_loan_receivable_amount = v_new.director_loan_receivable_amount,
           director_loan_payable_amount    = v_new.director_loan_payable_amount,
           cumulative_days_late            = v_new.cumulative_days_late,
           number_of_late_lodgements       = v_new.number_of_late_lodgements,
           days_since_last_payment         = v_new.days_since_last_payment,
           outcome_percent                 = v_new.outcome_percent,
           accepted                        = v_new.accepted,
           creditor_amount                 = v_new.creditor_amount,
           sbr_payment                     = v_new.sbr_payment,
           business_type                   = v_new.business_type,
           number_of_creditors             = v_new.number_of_creditors,
           raw                             = v_new.raw
     WHERE c.id = v_case.id;
    v_restored := v_restored + 1;
  END LOOP;

  DELETE FROM public.sbr_historical_cases c WHERE c.import_id = v_import.id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  UPDATE public.sbr_case_imports i
     SET undone_at = pg_catalog.clock_timestamp(),
         undone_by = p_undone_by
   WHERE i.id = v_import.id;

  RETURN jsonb_build_object('deleted', v_deleted, 'restored', v_restored);
END;
$$;

-- ============================================================
-- 8. Execute privileges
-- ============================================================
--
-- As 0020: functions in public are executable by PUBLIC, anon and
-- authenticated by default, so all three are revoked and only service_role
-- (the server routes) may call them. sbr_name_key is harmless, but nothing
-- here is callable through /rpc by accident.

REVOKE EXECUTE ON FUNCTION public.sbr_name_key(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sbr_name_key(text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.sbr_apply_case_import(jsonb, jsonb, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sbr_apply_case_import(jsonb, jsonb, jsonb) TO service_role;

REVOKE EXECUTE ON FUNCTION public.sbr_undo_case_import(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sbr_undo_case_import(uuid, text) TO service_role;

COMMIT;
