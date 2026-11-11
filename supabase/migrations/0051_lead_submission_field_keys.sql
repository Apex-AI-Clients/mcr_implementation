-- ============================================================
-- 0051 — question keys per Facebook enquiry
-- ============================================================
--
-- Form 1751128836351174 went live on 4 Nov 2026 with a state question whose
-- key no field map listed, and every lead from it landed with a blank State.
-- Nothing stored could say why: a successful lead keeps only the mapped
-- columns, so the key had to be dug out of Vercel logs.
--
-- From now on each Facebook enquiry records the NAMES of the questions it
-- carried — never the answers. Names are the form's wording, which is ours;
-- answers are the lead's name, phone and financial position, and stay where
-- they were (lead_intake_log, rejected payloads only).
--
-- Null on every other source and on every enquiry stored before this.
--
-- ingest_lead_submission is re-created below, identical to 0020 except for
-- the two places marked "0051": a new lead's first submission is written by
-- the leads insert trigger, which cannot see p_submission, so the keys are set
-- on it straight after; a repeat enquiry's insert lists the column.

ALTER TABLE public.lead_submissions
  ADD COLUMN IF NOT EXISTS meta_field_keys text[];

COMMENT ON COLUMN public.lead_submissions.meta_field_keys IS
  'Facebook only: question keys the lead carried, in Meta''s order. Names only, never answers.';

CREATE OR REPLACE FUNCTION public.ingest_lead_submission(
  p_submission jsonb,
  p_note_body text,
  p_note_author text,
  p_latest_touch boolean DEFAULT false
)
RETURNS TABLE (outcome text, lead_id uuid)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_in public.lead_submissions;
  v_email text;
  v_lead public.leads;
  v_seen uuid;
  v_closed boolean;
  v_has_debt boolean;
  v_has_state boolean;
  v_constraint text;
BEGIN
  v_in := jsonb_populate_record(NULL::public.lead_submissions, p_submission);

  v_email := lower(btrim(v_in.email));
  IF v_email IS NULL OR v_email = '' THEN
    RAISE EXCEPTION 'ingest_lead_submission: email is required' USING ERRCODE = '22023';
  END IF;
  IF v_in.source IS NULL THEN
    RAISE EXCEPTION 'ingest_lead_submission: source is required' USING ERRCODE = '22023';
  END IF;

  -- A blank is not a value. Content is kept exactly as sent otherwise.
  v_in.email := v_email;
  v_in.name := CASE WHEN btrim(v_in.name) = '' THEN NULL ELSE v_in.name END;
  v_in.phone := CASE WHEN btrim(v_in.phone) = '' THEN NULL ELSE v_in.phone END;
  v_in.state := CASE WHEN btrim(v_in.state) = '' THEN NULL ELSE v_in.state END;
  v_in.meta_state_raw := CASE WHEN btrim(v_in.meta_state_raw) = '' THEN NULL ELSE v_in.meta_state_raw END;
  v_in.meta_state_options := CASE WHEN cardinality(v_in.meta_state_options) = 0 THEN NULL ELSE v_in.meta_state_options END;
  v_in.entity_type := CASE WHEN btrim(v_in.entity_type) = '' THEN NULL ELSE v_in.entity_type END;
  v_in.message := CASE WHEN btrim(v_in.message) = '' THEN NULL ELSE v_in.message END;
  v_in.preferred_call_time := CASE WHEN btrim(v_in.preferred_call_time) = '' THEN NULL ELSE v_in.preferred_call_time END;
  v_in.external_id := CASE WHEN btrim(v_in.external_id) = '' THEN NULL ELSE v_in.external_id END;

  v_has_debt := v_in.debt_min IS NOT NULL OR v_in.debt_max IS NOT NULL;
  v_has_state := v_in.state IS NOT NULL
              OR v_in.meta_state_raw IS NOT NULL
              OR v_in.meta_state_options IS NOT NULL;

  -- Held to the end of the transaction.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('lead_email:' || v_email, 0)
  );

  -- Two attempts: the second only runs when a lead with this email was
  -- committed by a path that does not take the lock above (the Add lead
  -- dialog) between our lookup and our insert. It then finds that lead and
  -- takes the repeat path.
  FOR attempt IN 1..2 LOOP
    BEGIN
      IF v_in.external_id IS NOT NULL THEN
        SELECT s.lead_id INTO v_seen
          FROM public.lead_submissions s
         WHERE s.source = v_in.source AND s.external_id = v_in.external_id;
        IF FOUND THEN
          RETURN QUERY SELECT 'duplicate'::text, v_seen;
          RETURN;
        END IF;
      END IF;

      SELECT * INTO v_lead
        FROM public.leads l
       WHERE lower(l.email) = v_email
         FOR UPDATE;

      IF NOT FOUND THEN
        INSERT INTO public.leads (
          name, email, phone, debt_min, debt_max,
          state, meta_state_raw, meta_state_options,
          entity_type, message, preferred_call_time,
          source, external_id,
          meta_form_id, meta_ad_id, meta_adgroup_id, meta_page_id,
          meta_campaign_id, meta_campaign_name, meta_ad_name, meta_account_id,
          stage
        ) VALUES (
          v_in.name, v_email, v_in.phone, v_in.debt_min, v_in.debt_max,
          v_in.state, v_in.meta_state_raw, v_in.meta_state_options,
          v_in.entity_type, v_in.message, v_in.preferred_call_time,
          v_in.source, v_in.external_id,
          v_in.meta_form_id, v_in.meta_ad_id, v_in.meta_adgroup_id, v_in.meta_page_id,
          v_in.meta_campaign_id, v_in.meta_campaign_name, v_in.meta_ad_name, v_in.meta_account_id,
          'lead'
        )
        RETURNING * INTO v_lead;

        -- 0051: the trigger wrote the first submission from the leads row,
        -- which has no keys column. It is the lead's only submission.
        IF v_in.meta_field_keys IS NOT NULL THEN
          UPDATE public.lead_submissions s
             SET meta_field_keys = v_in.meta_field_keys
           WHERE s.lead_id = v_lead.id;
        END IF;

        RETURN QUERY SELECT 'created'::text, v_lead.id;
        RETURN;
      END IF;

      v_closed := v_lead.converted_client_id IS NOT NULL
               OR v_lead.stage IN ('converted', 'non_proceeding', 'do_not_contact');

      -- A submission needs its NOT NULL fields; fall back to what the lead
      -- already holds rather than reject an enquiry over a blank.
      INSERT INTO public.lead_submissions (
        lead_id, received_at, after_close,
        name, email, phone, debt_min, debt_max,
        state, meta_state_raw, meta_state_options,
        entity_type, message, preferred_call_time,
        source, external_id,
        meta_form_id, meta_ad_id, meta_adgroup_id, meta_page_id,
        meta_campaign_id, meta_campaign_name, meta_ad_name, meta_account_id,
        meta_field_keys -- 0051
      ) VALUES (
        v_lead.id, now(), v_closed,
        COALESCE(v_in.name, v_lead.name), v_email, COALESCE(v_in.phone, v_lead.phone),
        v_in.debt_min, v_in.debt_max,
        v_in.state, v_in.meta_state_raw, v_in.meta_state_options,
        v_in.entity_type, v_in.message, v_in.preferred_call_time,
        v_in.source, v_in.external_id,
        v_in.meta_form_id, v_in.meta_ad_id, v_in.meta_adgroup_id, v_in.meta_page_id,
        v_in.meta_campaign_id, v_in.meta_campaign_name, v_in.meta_ad_name, v_in.meta_account_id,
        v_in.meta_field_keys -- 0051
      );

      IF v_closed THEN
        UPDATE public.leads l
           SET reenquired_after_close_at = now()
         WHERE l.id = v_lead.id;
      ELSE
        UPDATE public.leads l
           SET name                = COALESCE(v_in.name, l.name),
               phone               = COALESCE(v_in.phone, l.phone),
               debt_min            = CASE WHEN v_has_debt THEN v_in.debt_min ELSE l.debt_min END,
               debt_max            = CASE WHEN v_has_debt THEN v_in.debt_max ELSE l.debt_max END,
               state               = CASE WHEN v_has_state THEN v_in.state ELSE l.state END,
               meta_state_raw      = CASE WHEN v_has_state THEN v_in.meta_state_raw ELSE l.meta_state_raw END,
               meta_state_options  = CASE WHEN v_has_state THEN v_in.meta_state_options ELSE l.meta_state_options END,
               entity_type         = COALESCE(v_in.entity_type, l.entity_type),
               message             = COALESCE(v_in.message, l.message),
               preferred_call_time = COALESCE(v_in.preferred_call_time, l.preferred_call_time),
               source              = CASE WHEN p_latest_touch THEN v_in.source ELSE l.source END,
               external_id         = CASE WHEN p_latest_touch THEN v_in.external_id ELSE l.external_id END,
               meta_form_id        = CASE WHEN p_latest_touch THEN v_in.meta_form_id ELSE l.meta_form_id END,
               meta_ad_id          = CASE WHEN p_latest_touch THEN v_in.meta_ad_id ELSE l.meta_ad_id END,
               meta_adgroup_id     = CASE WHEN p_latest_touch THEN v_in.meta_adgroup_id ELSE l.meta_adgroup_id END,
               meta_page_id        = CASE WHEN p_latest_touch THEN v_in.meta_page_id ELSE l.meta_page_id END,
               meta_campaign_id    = CASE WHEN p_latest_touch THEN v_in.meta_campaign_id ELSE l.meta_campaign_id END,
               meta_campaign_name  = CASE WHEN p_latest_touch THEN v_in.meta_campaign_name ELSE l.meta_campaign_name END,
               meta_ad_name        = CASE WHEN p_latest_touch THEN v_in.meta_ad_name ELSE l.meta_ad_name END,
               meta_account_id     = CASE WHEN p_latest_touch THEN v_in.meta_account_id ELSE l.meta_account_id END
         WHERE l.id = v_lead.id;
      END IF;

      INSERT INTO public.lead_activities (lead_id, type, body, author)
      VALUES (v_lead.id, 'note', p_note_body, p_note_author);

      RETURN QUERY SELECT 'appended'::text, v_lead.id;
      RETURN;

    EXCEPTION WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;

      IF v_constraint = 'leads_email_lower_key' AND attempt = 1 THEN
        CONTINUE;
      END IF;

      -- The same delivery, committed by a concurrent call.
      IF v_constraint IN ('lead_submissions_source_external_id_key',
                          'idx_leads_source_external_id') THEN
        SELECT s.lead_id INTO v_seen
          FROM public.lead_submissions s
         WHERE s.source = v_in.source AND s.external_id = v_in.external_id;
        RETURN QUERY SELECT 'duplicate'::text, v_seen;
        RETURN;
      END IF;

      RAISE;
    END;
  END LOOP;

  RAISE EXCEPTION 'ingest_lead_submission: could not store the enquiry';
END;
$$;

-- CREATE OR REPLACE keeps the grants from 0020 (service_role only); restated
-- so this file is correct on its own.
REVOKE EXECUTE ON FUNCTION public.ingest_lead_submission(jsonb, text, text, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_lead_submission(jsonb, text, text, boolean)
  TO service_role;
