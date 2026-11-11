-- Migration: a saved SBR prediction can be marked stale with a reason.
--
-- Staleness was worked out at read time only (new historical cases, 0028).
-- Some saved predictions were computed on an ATO activity statement whose
-- dates could not be read (an export re-saved in Excel: every lodgement read
-- as on time). Once that analysis is re-run with the date fix, nothing left in
-- the data shows it, so the prediction carries the reason itself:
-- "Calculated on unreadable ATO dates — re-run". The page then shows the
-- reason and never the saved figures as current; the next prediction clears it.
--
-- Additive, nullable. Write-only for the user to apply; src/types/database.ts
-- updated by hand.

ALTER TABLE public.sbr_outcome_predictions
  ADD COLUMN IF NOT EXISTS stale_reason text;

COMMENT ON COLUMN public.sbr_outcome_predictions.stale_reason IS
  'Why the saved prediction must not be used (shown instead of its figures); null when current. Cleared by the next prediction.';
