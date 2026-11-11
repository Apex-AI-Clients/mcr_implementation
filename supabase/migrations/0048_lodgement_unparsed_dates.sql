-- Migration: count the rows of an activity statement export whose dates could
-- not be read.
--
-- An ATO account CSV re-saved in Excel carries dates such as "20-Oct-26"
-- instead of the ATO's "20 Oct 2026". The parser read none of them, every
-- lodgement measured as 0 days late, and nothing said so (Doyle, 11 Nov 2026).
-- The parser now reads every format a spreadsheet writes; a row whose
-- processed or effective date is still blank or unreadable is counted here,
-- and above 0 the analysis has failed: the report shows why instead of
-- figures, the readiness item is Failed and the prediction refuses it.
--
-- Additive; existing rows start at 0 (the app also counts from the stored
-- rows, so an older analysis with unread dates is still refused).
-- Write-only for the user to apply; src/types/database.ts updated by hand.

ALTER TABLE public.lodgement_analyses
  ADD COLUMN IF NOT EXISTS unparsed_date_rows integer NOT NULL DEFAULT 0
    CHECK (unparsed_date_rows >= 0);

COMMENT ON COLUMN public.lodgement_analyses.unparsed_date_rows IS
  'Rows whose processed or effective date is blank or unreadable. Above 0 the analysis failed and its figures are not used.';
