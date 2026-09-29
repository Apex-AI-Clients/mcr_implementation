-- Migration: one row per enquiry, and one lead per email.
--
-- Until now a repeat enquiry from a known email only added a timeline note:
-- its name, phone, debt, state, entity type and attribution were dropped, and
-- the leads row kept showing the first enquiry. From here:
--
--   - lead_submissions holds every enquiry received, with every field it
--     carried, so nothing a lead ever told us is lost.
--   - the leads row stays the one record staff work (stage, follow-up,
--     conversion), and takes the newest contact and qualifying details.
--     A blank never wipes a known value.
--   - retry protection moves to lead_submissions. It used to check only the
--     first enquiry's id on the leads row, so a Meta retry of a *repeat*
--     enquiry appended its note twice.
--   - leads.email becomes unique, so two deliveries for a new email arriving
--     together cannot create two leads.
--
-- Attribution on the leads row stays first touch (the enquiry that created the
-- lead), so a partner report for August does not change when someone enquires
-- again in September. Every touch is in lead_submissions. The function takes
-- p_latest_touch so the row can be switched to latest touch without another
-- migration. See CRM_CHANGES.md for how the dashboard derives each view.
--
-- The unique email index fails this migration if duplicate emails exist. That
-- is intended: duplicates are reported and resolved by hand, never merged here.

-- ============================================================
-- 1. New columns on leads
-- ============================================================

ALTER TABLE public.leads
  -- Maintained by the trigger on lead_submissions below, never by application
  -- code — the same rule as last_action_at. Nullable until the backfill has
  -- run, so existing leads take their created_at rather than this migration's
  -- timestamp.
  ADD COLUMN IF NOT EXISTS last_enquiry_at timestamptz,
  ADD COLUMN IF NOT EXISTS enquiry_count integer NOT NULL DEFAULT 0,

  -- Set when a converted or closed lead enquires again. Cleared by any stage
  -- change (trigger below). Dismissing the marker records who and when in the
  -- two columns after it, and deliberately writes no lead_activities row: a
  -- dismissal is not a logged action and must not reset the follow-up clock.
  -- The marker shows while reenquired_after_close_at is set and later than
  -- any dismissal.
  ADD COLUMN IF NOT EXISTS reenquired_after_close_at timestamptz,
  ADD COLUMN IF NOT EXISTS reenquiry_dismissed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reenquiry_dismissed_by text;

-- ============================================================
-- 2. TABLE: lead_submissions
-- ============================================================
--
-- Same fields and the same CHECKs as the leads row, so any submission can be
-- written back onto its lead unchanged. Holds names, phones and financial
-- position: service role only, like every lead table.

CREATE TABLE IF NOT EXISTS public.lead_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Cascades: deleting a lead deletes what it told us, not just its row.
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  received_at timestamptz NOT NULL DEFAULT now(),
  -- True when the lead was converted or closed as this arrived. Kept per
  -- enquiry so the Enquiries list can still say so after the marker clears.
  after_close boolean NOT NULL DEFAULT false,

  name text NOT NULL,
  email text NOT NULL,
  phone text NOT NULL,

  debt_min integer,
  debt_max integer,
  CONSTRAINT lead_submissions_debt_min_non_negative CHECK (debt_min IS NULL OR debt_min >= 0),
  CONSTRAINT lead_submissions_debt_range_ordered
    CHECK (debt_min IS NULL OR debt_max IS NULL OR debt_max >= debt_min),

  state text CHECK (state IN ('NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT')),
  meta_state_raw text,
  meta_state_options text[],
  CONSTRAINT lead_submissions_meta_state_options_valid
    CHECK (meta_state_options <@ ARRAY['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT']::text[]),
  CONSTRAINT lead_submissions_state_or_state_options
    CHECK (state IS NULL OR meta_state_options IS NULL),

  entity_type text CHECK (entity_type IN ('company', 'trust')),
  message text,
  preferred_call_time text,

  source text NOT NULL
    CHECK (source IN ('facebook', 'website', 'google_form', 'manual')),
  external_id text,

  meta_form_id text,
  meta_ad_id text,
  meta_adgroup_id text,
  meta_page_id text,
  meta_campaign_id text,
  meta_campaign_name text,
  meta_ad_name text,
  meta_account_id text
);

ALTER TABLE public.lead_submissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lead_submissions_service_role" ON public.lead_submissions
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "lead_submissions_no_anon_read" ON public.lead_submissions
  FOR SELECT USING (false);

-- The Enquiries list on a lead, newest first.
CREATE INDEX IF NOT EXISTS idx_lead_submissions_lead_id
  ON public.lead_submissions(lead_id, received_at DESC);

-- One submission per delivery, per source. This is now the retry check.
-- Partial for the same reason as idx_leads_source_external_id: manual leads
-- have no external id.
CREATE UNIQUE INDEX IF NOT EXISTS lead_submissions_source_external_id_key
  ON public.lead_submissions(source, external_id)
  WHERE external_id IS NOT NULL;

-- ============================================================
-- 3. Backfill
-- ============================================================
--
-- One submission per existing lead, from its current row. Earlier repeat
-- enquiries that exist only as "New enquiry from the … form" notes are not
-- reconstructed, so they are not counted either: every existing lead starts
-- at one enquiry. Accepted; see CRM_CHANGES.md.

INSERT INTO public.lead_submissions (
  lead_id, received_at, after_close,
  name, email, phone, debt_min, debt_max,
  state, meta_state_raw, meta_state_options,
  entity_type, message, preferred_call_time,
  source, external_id,
  meta_form_id, meta_ad_id, meta_adgroup_id, meta_page_id,
  meta_campaign_id, meta_campaign_name, meta_ad_name, meta_account_id
)
SELECT
  l.id, l.created_at, false,
  l.name, l.email, l.phone, l.debt_min, l.debt_max,
  l.state, l.meta_state_raw, l.meta_state_options,
  l.entity_type, l.message, l.preferred_call_time,
  l.source, l.external_id,
  l.meta_form_id, l.meta_ad_id, l.meta_adgroup_id, l.meta_page_id,
  l.meta_campaign_id, l.meta_campaign_name, l.meta_ad_name, l.meta_account_id
FROM public.leads l
WHERE NOT EXISTS (SELECT 1 FROM public.lead_submissions s WHERE s.lead_id = l.id);

UPDATE public.leads
   SET enquiry_count = 1,
       last_enquiry_at = created_at
 WHERE last_enquiry_at IS NULL;

ALTER TABLE public.leads
  ALTER COLUMN last_enquiry_at SET DEFAULT now(),
  ALTER COLUMN last_enquiry_at SET NOT NULL;

-- ============================================================
-- 4. Indexes on leads
-- ============================================================

-- One lead per email. Replaces the plain lookup index from 0014, which it
-- makes redundant. Fails the migration if duplicates exist — see the header.
CREATE UNIQUE INDEX IF NOT EXISTS leads_email_lower_key ON public.leads(lower(email));
DROP INDEX IF EXISTS public.idx_leads_email;

-- The table's "recent" sort and date filter move from created_at to this.
CREATE INDEX IF NOT EXISTS idx_leads_last_enquiry_at ON public.leads(last_enquiry_at DESC);

-- ============================================================
-- 5. Triggers
-- ============================================================

-- Every new lead gets its first submission in the same transaction, whichever
-- path created it: the ingest function, the Add lead dialog, or anything
-- later. A lead can therefore never exist without its enquiry.
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
    state, meta_state_raw, meta_state_options,
    entity_type, message, preferred_call_time,
    source, external_id,
    meta_form_id, meta_ad_id, meta_adgroup_id, meta_page_id,
    meta_campaign_id, meta_campaign_name, meta_ad_name, meta_account_id
  ) VALUES (
    NEW.id, NEW.created_at, false,
    NEW.name, NEW.email, NEW.phone, NEW.debt_min, NEW.debt_max,
    NEW.state, NEW.meta_state_raw, NEW.meta_state_options,
    NEW.entity_type, NEW.message, NEW.preferred_call_time,
    NEW.source, NEW.external_id,
    NEW.meta_form_id, NEW.meta_ad_id, NEW.meta_adgroup_id, NEW.meta_page_id,
    NEW.meta_campaign_id, NEW.meta_campaign_name, NEW.meta_ad_name, NEW.meta_account_id
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER insert_lead_first_submission
  AFTER INSERT ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.lead_insert_first_submission();

-- The count and the latest date follow the submissions, the same way
-- last_action_at follows lead_activities. GREATEST so a back-dated insert
-- never drags the date backwards.
CREATE OR REPLACE FUNCTION public.lead_count_submission()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.leads
     SET enquiry_count = enquiry_count + 1,
         last_enquiry_at = GREATEST(last_enquiry_at, NEW.received_at)
   WHERE id = NEW.lead_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER count_lead_submission
  AFTER INSERT ON public.lead_submissions
  FOR EACH ROW EXECUTE FUNCTION public.lead_count_submission();

-- Any stage change clears the "enquired again" marker: moving the stage is
-- staff acting on it. In the database rather than the PATCH route so no path
-- that changes a stage can forget.
CREATE OR REPLACE FUNCTION public.lead_clear_reenquiry_on_stage_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  NEW.reenquired_after_close_at := NULL;
  RETURN NEW;
END;
$$;

CREATE TRIGGER clear_lead_reenquiry_on_stage_change
  BEFORE UPDATE OF stage ON public.leads
  FOR EACH ROW
  WHEN (OLD.stage IS DISTINCT FROM NEW.stage)
  EXECUTE FUNCTION public.lead_clear_reenquiry_on_stage_change();

-- ============================================================
-- 6. FUNCTION: ingest_lead_submission
-- ============================================================
--
-- Everything an inbound enquiry does, in one transaction:
--
--   1. Serialise on the email, so two deliveries for the same person run one
--      after the other instead of both deciding "new lead".
--   2. Same (source, external_id) as a stored submission → 'duplicate', no-op.
--   3. Unknown email → insert the lead (its trigger adds the first
--      submission) → 'created'.
--   4. Known email → insert the submission, then either merge it onto the
--      row (open lead) or set the "enquired again" marker and leave the row
--      alone (converted or closed lead). Stage and conversion are never
--      touched. Add the timeline note, which resets the follow-up clock as
--      before → 'appended'.
--
-- Merge rules. Some fields only mean something together, so they move as a
-- group; a group is replaced only when the new enquiry has something in it:
--   name, phone           – replaced when non-blank (ingest requires both)
--   debt_min + debt_max   – replaced together when either is set; a null max
--                           alone means "or more", not blank
--   state + meta_state_raw + meta_state_options
--                         – replaced together when any is set; the CHECK
--                           forbids state and options both being set
--   entity_type, message, preferred_call_time – each replaced when non-blank
--   source, external_id, meta_* – first touch: never replaced, unless
--                           p_latest_touch, when they are replaced together
--
-- p_submission uses the lead_submissions column names. Keys it does not
-- recognise are ignored; id, lead_id, received_at and after_close are set here
-- regardless of what it carries.
--
-- SECURITY INVOKER with execute granted only to service_role (section 7):
-- without that, PostgREST would expose it at /rpc to anyone holding the anon
-- key.

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
        meta_campaign_id, meta_campaign_name, meta_ad_name, meta_account_id
      ) VALUES (
        v_lead.id, now(), v_closed,
        COALESCE(v_in.name, v_lead.name), v_email, COALESCE(v_in.phone, v_lead.phone),
        v_in.debt_min, v_in.debt_max,
        v_in.state, v_in.meta_state_raw, v_in.meta_state_options,
        v_in.entity_type, v_in.message, v_in.preferred_call_time,
        v_in.source, v_in.external_id,
        v_in.meta_form_id, v_in.meta_ad_id, v_in.meta_adgroup_id, v_in.meta_page_id,
        v_in.meta_campaign_id, v_in.meta_campaign_name, v_in.meta_ad_name, v_in.meta_account_id
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

-- ============================================================
-- 7. Execute privileges
-- ============================================================
--
-- Functions in public are executable by PUBLIC by default, and Supabase also
-- grants anon and authenticated through default privileges, so all three are
-- revoked explicitly. The trigger functions cannot be called through /rpc, but
-- they get the same treatment so nothing here is callable by accident.

REVOKE EXECUTE ON FUNCTION public.ingest_lead_submission(jsonb, text, text, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_lead_submission(jsonb, text, text, boolean)
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.lead_insert_first_submission() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.lead_count_submission() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.lead_clear_reenquiry_on_stage_change()
  FROM PUBLIC, anon, authenticated;
