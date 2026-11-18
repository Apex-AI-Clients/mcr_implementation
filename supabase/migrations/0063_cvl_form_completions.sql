-- ============================================================
-- 0063 — CVL forms marked complete
-- ============================================================
--
-- On the CVL file page each ASIC form (Form 509, Form 507 Part A, each
-- director's Part B) has "Complete" in place of "Preview" (18 Nov 2026). A
-- completed form cannot be edited: its "Fill in / Continue" button is off and
-- a save is refused. "Unlock forms" (top right of the forms list) deletes the
-- case's rows, and every form can be edited again.
--
-- One row per case, form and subject. Service role only: RLS on, no policies.
-- New table; nothing existing changes. Until applied, "Complete" says so and
-- nothing is locked.
--
-- ── Preflight ──────────────────────────────────────────────────────────────
--   SELECT to_regclass('public.cvl_form_completions');   -- null

CREATE TABLE IF NOT EXISTS public.cvl_form_completions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.cvl_cases(id) ON DELETE CASCADE,
  form_code text NOT NULL CHECK (form_code IN ('509', '507a', '507b')),
  subject text NOT NULL CHECK (subject = 'company' OR subject ~ '^director:[0-9]+$'),
  completed_by text NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (case_id, form_code, subject)
);

ALTER TABLE public.cvl_form_completions ENABLE ROW LEVEL SECURITY;
