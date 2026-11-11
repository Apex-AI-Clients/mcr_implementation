-- Migration: count the rows of an ATO account export (activity statement,
-- income tax, superannuation guarantee) whose dates could not be read, as
-- 0048 does for the lodgement analysis.
--
-- Above 0 the account's analysis has failed: the ATO accounts panel, the
-- account's own page and the CVL director's risk show why instead of a
-- balance, payments or SGC figures, and the account's balance is left out of
-- the total ATO debt and the prediction's creditor rows.
--
-- Additive; existing rows start at 0 (the app also counts from the stored
-- rows of income tax and super accounts). Write-only for the user to apply;
-- src/types/database.ts updated by hand.

ALTER TABLE public.ato_account_analyses
  ADD COLUMN IF NOT EXISTS unparsed_date_rows integer NOT NULL DEFAULT 0
    CHECK (unparsed_date_rows >= 0);

COMMENT ON COLUMN public.ato_account_analyses.unparsed_date_rows IS
  'Rows whose processed or effective date is blank or unreadable. Above 0 the analysis failed and its figures are not used.';
