-- Migration: "Creditors in the SBR" saved with the prediction.
--
-- Additive: code running before this migration keeps working after it.
--
-- The SBR offer is sized on the ATO debt PLUS the other creditors staff
-- enter (credit cards, cash loans, overdraft, trade suppliers, other creditors),
-- as instructed on the call of 14 Oct 2026. Both are saved with the client's
-- prediction so the page shows what the offer was sized on:
--
--   creditors              — { "atoDebt": number|null, "atoDebtEdited": bool,
--                              "rows": [{ "label": text, "amount": number|null }, …6] }
--   total_creditor_amount  — ATO debt + every row with an amount; null when
--                            there is neither. Never negative.
--
-- Rows saved before this migration keep both null: the page then starts from
-- the default rows and the automatic ATO debt, as before.

ALTER TABLE public.sbr_outcome_predictions
  ADD COLUMN IF NOT EXISTS creditors jsonb,
  ADD COLUMN IF NOT EXISTS total_creditor_amount numeric(14,2);

ALTER TABLE public.sbr_outcome_predictions
  DROP CONSTRAINT IF EXISTS sbr_outcome_predictions_total_creditor_amount_check,
  ADD CONSTRAINT sbr_outcome_predictions_total_creditor_amount_check
    CHECK (total_creditor_amount IS NULL OR total_creditor_amount >= 0);

ALTER TABLE public.sbr_outcome_predictions
  DROP CONSTRAINT IF EXISTS sbr_outcome_predictions_creditors_shape_check,
  ADD CONSTRAINT sbr_outcome_predictions_creditors_shape_check
    CHECK (creditors IS NULL OR (jsonb_typeof(creditors) = 'object' AND jsonb_typeof(creditors -> 'rows') = 'array'));

COMMENT ON COLUMN public.sbr_outcome_predictions.creditors IS
  'Creditors in the SBR: the ATO debt used and up to 6 staff-entered rows (label, amount). See src/lib/sbr/creditors.ts.';
COMMENT ON COLUMN public.sbr_outcome_predictions.total_creditor_amount IS
  'ATO debt + other creditor rows: the amount the suggested offer is sized on.';
