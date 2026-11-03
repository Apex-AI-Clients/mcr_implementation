-- ============================================================
-- 0042: lead stages as rows, not a CHECK list
--
-- Until now leads.stage was held to six fixed values by a CHECK constraint.
-- Staff can now add their own stages (each gets its own tab on the Leads
-- page), so the list lives in a table and leads.stage points at it.
--
--  - The built-in stages are seeded here, two of them new: Unresponsive and
--    Contact in 30 days. Their labels and behaviour live in code
--    (src/lib/leads/constants.ts); the rows exist so the foreign key holds.
--  - A stage staff add is a row with built_in = false and a key of the form
--    custom_xxxxxxxx. Its label is the one thing about it that can change.
--  - A custom stage is hidden, never deleted, and only while no lead is in it,
--    so no lead is ever left pointing at nothing.
--
-- Numbered 0042 though 0039–0041 may not be applied yet: it touches only the
-- leads tables, so it does not depend on them, nor they on it.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.lead_stages (
  key text PRIMARY KEY CHECK (key ~ '^[a-z0-9_]+$'),
  label text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 40),
  built_in boolean NOT NULL DEFAULT false,
  -- Tab order for custom stages, after the built-in tabs. Built-ins are
  -- ordered in code.
  position integer NOT NULL DEFAULT 0,
  hidden_at timestamptz,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Two stages can't share a name, whatever the case: two "Waiting" tabs would
-- be indistinguishable. Hidden ones included, so adding the name of a hidden
-- stage brings it back instead.
CREATE UNIQUE INDEX IF NOT EXISTS lead_stages_label_unique
  ON public.lead_stages (lower(btrim(label)));

ALTER TABLE public.lead_stages ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER set_lead_stages_updated_at
  BEFORE UPDATE ON public.lead_stages
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE POLICY "lead_stages_service_role" ON public.lead_stages
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "lead_stages_no_anon_read" ON public.lead_stages
  FOR SELECT USING (false);

INSERT INTO public.lead_stages (key, label, built_in) VALUES
  ('lead', 'Lead', true),
  ('prospect', 'Prospect', true),
  ('client', 'Client', true),
  ('unresponsive', 'Unresponsive', true),
  ('contact_in_30_days', 'Contact in 30 days', true),
  ('converted', 'Converted', true),
  ('non_proceeding', 'Non-proceeding – other', true),
  ('do_not_contact', 'Do not contact again', true)
ON CONFLICT (key) DO NOTHING;

-- The fixed list goes; the table holds the line instead. Found by what it
-- checks rather than by name: 0014 left it to Postgres to name, and a drop
-- that missed would leave the old list refusing every new stage.
DO $$
DECLARE
  old_check record;
BEGIN
  FOR old_check IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.leads'::regclass
      AND contype = 'c'
      -- The word "stage" on its own: not "stage_since", not "state".
      AND pg_get_constraintdef(oid) ~ '\mstage\M'
  LOOP
    EXECUTE format('ALTER TABLE public.leads DROP CONSTRAINT %I', old_check.conname);
  END LOOP;
END $$;

-- ON UPDATE CASCADE only for completeness: keys are never changed by the app.
ALTER TABLE public.leads
  ADD CONSTRAINT leads_stage_fkey FOREIGN KEY (stage)
  REFERENCES public.lead_stages(key) ON UPDATE CASCADE;
