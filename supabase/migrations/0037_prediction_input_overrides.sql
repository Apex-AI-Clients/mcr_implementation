-- Migration: staff overrides saved with the SBR prediction.
--
-- Additive: code running before this migration keeps working after it.
--
-- "Director loan at appointment" and the director loan receivable amount can
-- disagree: a loan owed to the company with the flag at No, or Yes with $0.
-- The predict route refuses that unless staff give a reason, and the reason is
-- kept with the prediction so the page and the PDF can show it and a later
-- change on the balance sheet can be told apart from it
-- (src/lib/sbr/inputPrecedence.ts):
--
--   input_overrides — { "directorLoanAtAppointment": { "value": bool,
--                       "reason": text, "setAt": timestamptz text,
--                       "amount": number } }
--
-- Null when nothing was overridden, which is every row saved before this.

ALTER TABLE public.sbr_outcome_predictions
  ADD COLUMN IF NOT EXISTS input_overrides jsonb;

ALTER TABLE public.sbr_outcome_predictions
  DROP CONSTRAINT IF EXISTS sbr_outcome_predictions_input_overrides_shape_check,
  ADD CONSTRAINT sbr_outcome_predictions_input_overrides_shape_check
    CHECK (input_overrides IS NULL OR jsonb_typeof(input_overrides) = 'object');

COMMENT ON COLUMN public.sbr_outcome_predictions.input_overrides IS
  'Inputs staff kept against the evidence, with their reason and when. See src/lib/sbr/inputPrecedence.ts.';
