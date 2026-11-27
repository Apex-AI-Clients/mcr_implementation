-- ============================================================
-- 0065 — Part B's B1 address is typed and saved
-- ============================================================
--
-- Until now the B1 address (Address, Street/Unit number and name,
-- Suburb/City, State/Territory, Postcode) was left blank for the director
-- to write by hand, and cvl_form_answers_no_handwritten (0039, replaced in
-- 0054) refused it. Since 24 Nov 2026 (Gabby) it is pre-filled from the
-- director's address on the kept ASIC extract, editable, and saved with the
-- Part B draft.
--
-- Still refused, as before: Part B's B6 user name and password. They are
-- written by hand on the printout and never stored.
--
-- The constraint is replaced, not altered: Postgres has no ALTER for a CHECK.
-- It only relaxes the check, so every existing row still passes.
--
-- ── Preflight ──────────────────────────────────────────────────────────────
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conrelid = 'public.cvl_form_answers'::regclass AND conname = 'cvl_form_answers_no_handwritten';
--   -- lists b1_address … b1_postcode

ALTER TABLE public.cvl_form_answers
  DROP CONSTRAINT IF EXISTS cvl_form_answers_no_handwritten;

ALTER TABLE public.cvl_form_answers
  ADD CONSTRAINT cvl_form_answers_no_handwritten
    CHECK (
      jsonb_typeof(answers) = 'object'
      AND NOT (answers ?| ARRAY['b6_username', 'b6_password'])
      AND NOT (COALESCE(answers -> 'fields', '{}'::jsonb) ?| ARRAY['b6_username', 'b6_password'])
    );

-- ── Verify ─────────────────────────────────────────────────────────────────
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conrelid = 'public.cvl_form_answers'::regclass AND conname = 'cvl_form_answers_no_handwritten';
--   -- lists only b6_username and b6_password
