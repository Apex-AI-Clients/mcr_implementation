-- Migration: free-text source on a lead.
--
-- Staff can now type any source into the lead table ("Referral — Dave",
-- "Trade show"), the way they type any figure into Debt. It goes in its own
-- column rather than in `source`, because `source` is not just a label: it is
-- half of the delivery dedup key (idx_leads_source_external_id), it picks the
-- ingest field map, and ingest_lead_submission rewrites it on a new enquiry.
-- `source` keeps doing that job, untouched.
--
-- Null means "show the delivered source". Set means "show this instead".
-- Clearing the text in the table sets it back to null.
--
-- No backfill: no lead has a typed source yet.

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS source_label text;

-- Blank is stored as null, never as ''; and a label, not an essay.
ALTER TABLE public.leads
  DROP CONSTRAINT IF EXISTS leads_source_label_check,
  ADD CONSTRAINT leads_source_label_check
    CHECK (source_label IS NULL OR (length(btrim(source_label)) BETWEEN 1 AND 100));
