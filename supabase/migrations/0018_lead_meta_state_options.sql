-- Migration: the states a grouped state answer resolved to.
--
-- 0017 kept a grouped answer ("NSW, VIC, ACT, TAS") as display text. That is
-- enough to show it but not to filter on it: a lead from that grouping might be
-- in NSW, and should appear under an NSW filter, marked as uncertain. So the
-- resolved states are stored alongside the label.
--
-- Null unless the answer resolved to two or more distinct states. A group that
-- resolves to one state is just that state and goes in `state`; an answer with
-- any token that did not resolve keeps only meta_state_raw. So `state` and this
-- column are never both set.
--
-- No index: the leads table is small and the state filter already scans it.

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS meta_state_options text[];

ALTER TABLE public.leads
  -- The same set as the `state` CHECK in 0014, so the app's AuState[] cast in
  -- rowMappers.ts is as safe as its AuState one.
  ADD CONSTRAINT leads_meta_state_options_valid
    CHECK (meta_state_options <@ ARRAY['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT']::text[]),
  ADD CONSTRAINT leads_state_or_state_options
    CHECK (state IS NULL OR meta_state_options IS NULL);
