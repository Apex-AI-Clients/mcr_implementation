-- Migration: Meta ad attribution on leads.
--
-- Facebook tells us which ad produced a lead, but only at the moment of
-- delivery: the webhook envelope carries ad_id, adgroup_id and page_id, and the
-- Graph response carries form_id. None of it can be recovered afterwards from a
-- leadgen id we have already consumed, so a lead that lands before these
-- columns exist has lost its attribution for good. That is the whole reason
-- they are being added now, ahead of any decision about how they get read.
--
-- Every column nullable, and the null carries meaning: no non-Facebook source
-- has any of them, Meta's test leads and organic Page submissions carry no ad,
-- and the resolved columns stay null when the ad lookup fails. Null is "not
-- supplied", never "zero" and never "none".
--
-- No indexes: nothing queries these yet. They arrive with whatever reads them.

ALTER TABLE public.leads
  -- ----------------------------------------------------------
  -- Raw identifiers, straight off the delivery. Always attempted.
  -- ----------------------------------------------------------
  -- The Page the form ran on. Already used at ingest to pick the access token;
  -- stored so a lead can still say where it came from once the token map moves
  -- on from the test Page.
  ADD COLUMN IF NOT EXISTS meta_page_id text,
  -- Which of the Page's 19 lead forms was filled in. From the Graph lead
  -- response, not the webhook — the envelope does not name the form.
  ADD COLUMN IF NOT EXISTS meta_form_id text,
  -- The individual ad. Null on test leads and on organic submissions, and its
  -- being null is what stops the resolve call below from running at all.
  ADD COLUMN IF NOT EXISTS meta_ad_id text,
  -- Meta's name for the ad set the ad belongs to; their field is `adgroup_id`,
  -- and the column keeps that spelling so the two are searchable as one thing.
  ADD COLUMN IF NOT EXISTS meta_adgroup_id text,

  -- ----------------------------------------------------------
  -- Resolved from the ad, denormalised on purpose.
  -- ----------------------------------------------------------
  -- GET /{ad_id}?fields=account_id,name,campaign{id,name} at ingest, so the
  -- dashboard never calls Meta to render a chart. The cost of denormalising is
  -- that a campaign renamed later keeps its old name here — which is arguably
  -- what a historical lead should show anyway.
  --
  -- These four are null together whenever there was no ad to resolve, or the
  -- resolve failed. A lead is never rejected over them: the raw ids above are
  -- still stored, so a backfill from ad_id remains possible later. That is not
  -- true of the ids themselves, which is why the two groups differ.
  ADD COLUMN IF NOT EXISTS meta_campaign_id text,
  ADD COLUMN IF NOT EXISTS meta_campaign_name text,
  ADD COLUMN IF NOT EXISTS meta_ad_name text,
  -- Meta returns this as `act_<digits>`; stored exactly as returned.
  ADD COLUMN IF NOT EXISTS meta_account_id te