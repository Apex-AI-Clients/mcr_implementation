-- v2 SBR prediction overhaul:
--   1. Drop director_loan_sent_to_ato (Tom 26 May 2026: only knowable
--      6 weeks post-appointment, can't help pre-appointment prediction)
--   2. Wipe all 49 seed rows so they can be re-seeded with the combined
--      59-row dataset (41 accepted + 18 rejected) per Tom's new submission
--      List_of_Rejected_SBR_s.xlsx.
--   3. Clear all cached predictions so practitioners re-run under v2.

ALTER TABLE public.sbr_historical_cases
  DROP COLUMN IF EXISTS director_loan_sent_to_ato;

TRUNCATE TABLE public.sbr_historical_cases;
TRUNCATE TABLE public.sbr_outcome_predictions;
