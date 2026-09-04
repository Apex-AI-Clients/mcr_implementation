-- Migration: CRM leads and their activity history.
--
-- Field set follows CRM_ADDENDUM.md, which supersedes the `debt_band` enum in
-- CRM_CHANGES.md. Debt is stored as a whole-dollar range because every capture
-- form offers ranges, and the two forms in play do not reconcile into one enum:
-- the website sells consumer debt hardship ($30k-$150k+) while the Facebook
-- campaign targets business insolvency with much larger brackets. A range maps
-- either without losing information, and a new bracket set needs no migration.

-- ============================================================
-- TABLE: leads
-- ============================================================

CREATE TABLE IF NOT EXISTS public.leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL,
  phone text NOT NULL,

  -- Whole dollars, both nullable. Null min = the form did not ask; null max =
  -- open-ended, as in the website's "$150,000 or +". Never cents: nothing here
  -- is an exact figure, so there is no sub-dollar precision to lose.
  debt_min integer,
  debt_max integer,
  CONSTRAINT leads_debt_min_non_negative CHECK (debt_min IS NULL OR debt_min >= 0),
  CONSTRAINT leads_debt_range_ordered
    CHECK (debt_min IS NULL OR debt_max IS NULL OR debt_max >= debt_min),

  state text NOT NULL
    CHECK (state IN ('NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT')),

  -- A qualifying question, not metadata: SBR is for incorporated companies and
  -- a trust is a different path. Null when the source form did not ask.
  entity_type text CHECK (entity_type IN ('company', 'trust')),

  -- The lead's own words from the capture form. Required on the website form,
  -- optional on Facebook, so nullable here.
  message text,

  -- Free text, e.g. "after 6pm". Too variable to normalise.
  preferred_call_time text,

  stage text NOT NULL DEFAULT 'lead'
    CHECK (stage IN ('lead', 'prospect', 'client',
                     'converted', 'non_proceeding', 'do_not_contact')),
  source text NOT NULL
    CHECK (source IN ('facebook', 'website', 'google_form', 'manual')),

  company text,
  next_step text,

  stage_since timestamptz NOT NULL DEFAULT now(),

  -- Maintained by the trigger on lead_activities below, never by application
  -- code. Two writers to one clock is how it drifts.
  last_action_at timestamptz NOT NULL DEFAULT now(),

  -- The join to the SBR workspace. ON DELETE SET NULL: deleting a client file
  -- must not delete the lead history that produced it.
  converted_client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,

  -- Stage 5 idempotency key (Meta retries on any non-200, and people
  -- double-submit forms). Unused until ingestion exists; here now so that
  -- work needs no second migration.
  external_id text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER set_leads_updated_at
  BEFORE UPDATE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE POLICY "leads_service_role" ON public.leads
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- Anonymous cannot read leads
CREATE POLICY "leads_no_anon_read" ON public.leads
  FOR SELECT USING (false);

-- ============================================================
-- TABLE: lead_activities
-- ============================================================

CREATE TABLE IF NOT EXISTS public.lead_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  type text NOT NULL
    CHECK (type IN ('note', 'call', 'email', 'next_step', 'stage_change')),
  body text NOT NULL,
  author text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.lead_activities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lead_activities_service_role" ON public.lead_activities
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "lead_activities_no_anon_read" ON public.lead_activities
  FOR SELECT USING (false);

-- ============================================================
-- The follow-up clock
-- ============================================================

-- Every recorded action writes an activity row, so the clock lives here rather
-- than in application code. Stage changes reset it because they write a
-- 'stage_change' activity; correcting a phone number, a debt range or an entity
-- type writes no activity, so it correctly leaves the clock alone.
--
-- The `<` guard means importing back-dated history can never drag the clock
-- backwards and make a chased lead look neglected.
CREATE OR REPLACE FUNCTION public.touch_lead_last_action()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.leads
     SET last_action_at = NEW.created_at
   WHERE id = NEW.lead_id
     AND last_action_at < NEW.created_at;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_leads_last_action_at
  AFTER INSERT ON public.lead_activities
  FOR EACH ROW EXECUTE FUNCTION public.touch_lead_last_action();

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_leads_stage ON public.leads(stage);
CREATE INDEX IF NOT EXISTS idx_leads_created_at ON public.leads(created_at DESC);
-- Follow-up sweeps filter on open stages by this column.
CREATE INDEX IF NOT EXISTS idx_leads_last_action_at ON public.leads(last_action_at);
-- "Largest debt first", nulls last.
CREATE INDEX IF NOT EXISTS idx_leads_debt_min ON public.leads(debt_min DESC NULLS LAST);
-- Stage 5 looks a lead up by email to decide new lead vs new touch.
CREATE INDEX IF NOT EXISTS idx_leads_email ON public.leads(lower(email));
CREATE INDEX IF NOT EXISTS idx_leads_converted_client_id
  ON public.leads(converted_client_id);
CREATE INDEX IF NOT EXISTS idx_lead_activities_lead_id
  ON public.lead_activities(lead_id, created_at DESC);

-- One lead per delivery, per source. Partial so that manually added leads —
-- which have no external id — are not all in conflict with each other.
CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_source_external_id
  ON public.leads(source, external_id)
  WHERE external_id IS NOT NULL;
