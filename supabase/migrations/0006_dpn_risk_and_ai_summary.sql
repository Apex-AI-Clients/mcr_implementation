-- Migration: extend lodgement_analyses with DPN risk, debt composition, and AI summary

ALTER TABLE public.lodgement_analyses
  ADD COLUMN IF NOT EXISTS dpn_risk jsonb,
  ADD COLUMN IF NOT EXISTS debt_breakdown jsonb,
  ADD COLUMN IF NOT EXISTS ai_summary text,
  ADD COLUMN IF NOT EXISTS ai_summary_generated_at timestamptz,
  ADD COLUMN IF NOT EXISTS ai_summary_model text;
