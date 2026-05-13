-- Clear DPN risk and debt breakdown payloads from analyses created with the
-- pre-fix methodology, so admins are prompted to re-analyse for an updated
-- result. The compliance metrics (number_of_late_lodgements, cumulative_days_late)
-- remain valid and are not touched.
UPDATE public.lodgement_analyses
SET
  dpn_risk = NULL,
  debt_breakdown = NULL,
  ai_summary = NULL,
  ai_summary_generated_at = NULL,
  ai_summary_model = NULL
WHERE
  (dpn_risk IS NOT NULL AND NOT (dpn_risk ? 'contributingRows'))
  OR (debt_breakdown IS NOT NULL AND NOT (debt_breakdown ? 'principalDebits'));
