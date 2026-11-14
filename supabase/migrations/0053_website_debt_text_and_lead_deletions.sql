-- ============================================================
-- 0053 — typed website debt, website form/page, lead deletion log
-- ============================================================
--
-- 1. Typed debt (leads.debt_text, lead_submissions.debt_text)
--
--    The website's results-page form has a free-text debt box. A lead typed
--    "200,000", the webhook read it as a dropdown code, matched nothing, and
--    stored no debt — silently. From now on a typed debt keeps the words
--    exactly as sent in debt_text. When they read as one amount, debt_min =
--    debt_max = that amount, the exact-figure convention the Edit dialog's
--    "Type my own" already uses, so the debt filter, sorting and search keep
--    including the lead. When they do not ("about two hundred grand"),
--    debt_min and debt_max stay null and only the text is kept.
--
--    Null on a dropdown answer, on every other source, on hand-entered debt,
--    and on every row stored before this. Staff editing the debt clears it on
--    the lead (the app does that): what shows is then what staff entered.
--
-- 2. Website form and page (lead_submissions.page_url)
--
--    The form id a website form posts goes in the existing meta_form_id; its
--    key names in the existing meta_field_keys (0051), names only. The page it
--    was posted from (no query string) goes in page_url, new here.
--
-- 3. lead_deletions — who deleted which lead, when. Lead id, its source and
--    stage, who and when: no name, email, phone or answer.
--
-- ingest_lead_submission is re-created, identical to 0051 except where marked
-- "0053". lead_insert_first_submission is re-created, identical to 0020 except
-- for debt_text.
--
-- ── Preflight (run before applying) ───────────────────────────────────────
--
--   -- None of the new columns or the table exist yet: 0 rows.
--   SELECT table_name, column_name FROM information_schema.columns
--    WHERE table_schema = 'public'
--      AND ((table_name IN ('leads', 'lead_submissions') AND column_name = 'debt_text')
--        OR (table_name = 'lead_submissions' AND column_name = 'page_url'));
--   SELECT table_name FROM information_schema.tables
--    WHERE table_schema = 'public' AND table_name = 'lead_deletions';
--
--   -- 0051 is applied (the function below writes meta_field_keys): 1 row.
--   SELECT column_name FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'lead_submissions' AND column_name = 'meta_field_keys';
--
-- ── Post-apply ─────────────────────────────────────────────────────────────
--
--   -- Three columns: 3 rows.
--   SELECT table_name, column_name FROM information_schema.columns
--    WHERE table_schema = 'public'
--      AND ((table_name IN ('leads', 'lead_submissions') AND column_name = 'debt_text')
--        OR (table_name = 'lead_submissions' AND column_name = 'page_url'));
--
--   -- lead_deletions with RLS on and no policy (service role only).
--   SELECT c.relname, c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--    WHERE n.nspname = 'public' AND c.relname = 'lead_deletions';
--   SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'lead_deletions';
--
--   -- After the next website lead: counts only.
--   SELECT count(*) FILTER (WHERE debt_text IS NOT NULL) AS typed_debt,
--          count(*) FILTER (WHERE meta_field_keys IS NOT NULL) AS with_key_names,
--          count(*) FILTER (WHERE meta_form_id IS NOT NULL) AS with_form_id,
--          count(*) FILTER (WHERE page_url IS NOT NULL) AS with_page
--     FROM public.lead_submissions
--    WHERE source = 'website' AND received_at > now() - interval '7 days';

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS debt_text text;
ALTER TABLE public.lead_submissions
  ADD COLUMN IF NOT EXISTS debt_text text,
  ADD COLUMN IF NOT EXISTS page_url text;

COMMENT ON COLUMN public.leads.debt_text IS
  'Debt exactly as the lead typed it (website free-text box). debt_min = debt_max = the amount when it reads as one; both null when it does not. Null for a dropdown answer or hand-entered debt.';
COMMENT ON COLUMN public.lead_submissions.debt_text IS
  'Debt exactly as typed on this enquiry. See leads.debt_text.';
COMMENT ON COLUMN public.lead_submissions.page_url IS
  'Website only: the page the form was posted from, without its query string.';

-- ------------------------------------------------------------
-- lead_deletions
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.lead_deletions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The deleted lead's id: no foreign key, the row is gone.
  lead_id uuid NOT NULL,
  source text,
  external_id text,
  stage text,
  deleted_by text NOT NULL,
  deleted_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.lead_deletions IS
  'One row per deleted lead: id, source, external id, stage, who and when. No personal details.';

CREATE INDEX IF NOT EXISTS idx_lead_deletions_deleted_at ON public.lead_deletions (deleted_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_deletions_external_id ON public.lead_deletions (external_id);

ALTER TABLE public.lead_deletions ENABLE ROW LEVEL SECURITY;
-- No policy: only the service role (server code) reads or writes it.

-- ------------------------------------------------------------
-- First submission: carries debt_text (0053)
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.lead_insert_first_submission()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.lead_submissions (
    lead_id, received_at, after_close,
    name, email, phone, debt_min, debt_max,
    debt_text, -- 0053
    state, meta_state_raw, meta_state_options,
    entity_type, message, preferred_call_time,
    source, external_id,
    meta_form_id, meta_ad_id, meta_adgroup_id, meta_page_id,
    meta_campaign_id, meta_campaign_name, meta_ad_name, meta_account_id
  ) VALUES (
    NEW.id, NEW.created_at, false,
    NEW.name, NEW.email, NEW.phone, NEW.debt_min, NEW.debt_max,
    NEW.debt_text, -- 0053
    NEW.state, NEW.meta_state_raw, NEW.meta_state_options,
    NEW.entity_type, NEW.message, NEW.preferred_call_time,
    NEW.source, NEW.external_id,
    NEW.meta_form_id, NEW.meta_ad_id, NEW.meta_adgroup_id, NEW.meta_page_id,
    NEW.meta_campaign_id, NEW.meta_campaign_name, NEW.meta_ad_name, NEW.meta_account_id
  );
  RETURN NEW;
END;
$$;

-- ------------------------------------------------------------
-- ingest_lead_submission
-- ------------------------------------------------------------

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
  v_in.debt_text := CASE WHEN btrim(v_in.debt_text) = '' THEN NULL ELSE v_in.debt_text END; -- 0053
  v_in.page_url := CASE WHEN btrim(v_in.page_url) = '' THEN NULL ELSE v_in.page_url END; -- 0053

  -- 0053: typed text that is not an amount is still an answer about debt.
  v_has_debt := v_in.debt_min IS NOT NULL OR v_in.debt_max IS NOT NULL OR v_in.debt_text IS NOT NULL;
  v_has_state := v_in.state IS NOT NULL
              OR v_in.meta_state_raw IS NOT NULL
              OR v_in.meta_state_options IS NOT NULL;

  -- Held to the end of the transaction.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('lead_email:' || v_email, 0)
  );

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
          debt_text, -- 0053
          state, meta_state_raw, meta_state_options,
          entity_type, message, preferred_call_time,
          source, external_id,
          meta_form_id, meta_ad_id, meta_adgroup_id, meta_page_id,
          meta_campaign_id, meta_campaign_name, meta_ad_name, meta_account_id,
          stage
        ) VALUES (
          v_in.name, v_email, v_in.phone, v_in.debt_min, v_in.debt_max,
          v_in.debt_text, -- 0053
          v_in.state, v_in.meta_state_raw, v_in.meta_state_options,
          v_in.entity_type, v_in.message, v_in.preferred_call_time,
          v_in.source, v_in.external_id,
          v_in.meta_form_id, v_in.meta_ad_id, v_in.meta_adgroup_id, v_in.meta_page_id,
          v_in.meta_campaign_id, v_in.meta_campaign_name, v_in.meta_ad_name, v_in.meta_account_id,
          'lead'
        )
        RETURNING * INTO v_lead;

        -- The trigger wrote the first submission from the leads row, which has
        -- no keys or page column. It is the lead's only submission.
        IF v_in.meta_field_keys IS NOT NULL OR v_in.page_url IS NOT NULL THEN -- 0053: page_url
          UPDATE public.lead_submissions s
             SET meta_field_keys = v_in.meta_field_keys,
                 page_url = v_in.page_url -- 0053
           WHERE s.lead_id = v_lead.id;
        END IF;

        RETURN QUERY SELECT 'created'::text, v_lead.id;
        RETURN;
      END IF;

      v_closed := v_lead.converted_client_id IS NOT NULL
               OR v_lead.stage IN ('converted', 'non_proceeding', 'do_not_contact');

      INSERT INTO public.lead_submissions (
        lead_id, received_at, after_close,
        name, email, phone, debt_min, debt_max,
        debt_text, -- 0053
        state, meta_state_raw, meta_state_options,
        entity_type, message, preferred_call_time,
        source, external_id,
        meta_form_id, meta_ad_id, meta_adgroup_id, meta_page_id,
        meta_campaign_id, meta_campaign_name, meta_ad_name, meta_account_id,
        meta_field_keys,
        page_url -- 0053
      ) VALUES (
        v_lead.id, now(), v_closed,
        COALESCE(v_in.name, v_lead.name), v_email, COALESCE(v_in.phone, v_lead.phone),
        v_in.debt_min, v_in.debt_max,
        v_in.debt_text, -- 0053
        v_in.state, v_in.meta_state_raw, v_in.meta_state_options,
        v_in.entity_type, v_in.message, v_in.preferred_call_time,
        v_in.source, v_in.external_id,
        v_in.meta_form_id, v_in.meta_ad_id, v_in.meta_adgroup_id, v_in.meta_page_id,
        v_in.meta_campaign_id, v_in.meta_campaign_name, v_in.meta_ad_name, v_in.meta_account_id,
        v_in.meta_field_keys,
        v_in.page_url -- 0053
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
               debt_text           = CASE WHEN v_has_debt THEN v_in.debt_text ELSE l.debt_text END, -- 0053
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

REVOKE EXECUTE ON FUNCTION public.ingest_lead_submission(jsonb, text, text, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_lead_submission(jsonb, text, text, boolean)
  TO service_role;
