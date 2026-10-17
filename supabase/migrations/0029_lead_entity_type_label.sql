-- Migration: free-text business type on a lead.
--
-- Staff can now type any business type in Edit lead ("Sole trader",
-- "Partnership"), the way they type any source (0025). It goes in its own
-- column rather than in `entity_type`, because `entity_type` is not just a
-- label: the trust warning, the SBR path and the convert-to-client form all
-- read it as company or trust, and the CHECK from 0014 keeps it to those two.
--
-- Null means "show entity_type". Set means "show this instead". Edit lead
-- clears entity_type when a type is typed, so a stale company or trust is not
-- acted on behind a label that says something else.
--
-- No backfill: no lead has a typed business type yet.

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS entity_type_label text;

-- Blank is stored as null, never as ''; and a label, not an essay.
ALTER TABLE public.leads
  DROP CONSTRAINT IF EXISTS leads_entity_type_label_check,
  ADD CONSTRAINT leads_entity_type_label_check
    CHECK (entity_type_label IS NULL OR (length(btrim(entity_type_label)) BETWEEN 1 AND 100));
