-- Migration: keep a grouped state answer instead of losing it.
--
-- Some Meta lead forms group regions into one option — form 1220173909314387
-- offers "NSW, VIC, ACT, TAS" and "NT, SA". A lead who picks one is in one of
-- those states and the answer does not say which, so `state` has to stay null:
-- a lead shown as NSW who is actually in Tasmania would be worked on wrong
-- information. Before this column, the grouping itself was dropped.
--
-- Null unless `state` is null and the form gave a grouping. The two are never
-- both set. Holds display labels ("NSW, VIC, ACT, TAS"), not the option key
-- Meta sends, so it can be shown as-is.
--
-- No index and no CHECK: it is shown, never filtered on, and its shape is
-- whatever grouping a form author chose.

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS meta_state_raw text;
