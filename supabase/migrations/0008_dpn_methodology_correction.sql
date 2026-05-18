-- Migration: DPN risk methodology corrected.
-- The previous DPN payload pooled credits across late rows as "reversed".
-- Gabby (MCR Partners) confirmed on 15 May 2026 that the correct methodology
-- is per-row net of cash payments since each lodgement's processed date.
--
-- We wipe the dpn_risk and ai_summary columns on existing rows so admins are
-- forced to re-analyse under the corrected methodology. Compliance metrics
-- (number_of_late_lodgements, cumulative_days_late) remain valid and untouched.

UPDATE public.lodgement_analyses
SET
  dpn_risk = NULL,
  ai_summary = NULL,
  ai_summary_generated_at = NULL,
  ai_summary_model = NULL;
