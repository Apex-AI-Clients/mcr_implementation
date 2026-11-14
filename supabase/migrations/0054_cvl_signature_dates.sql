-- ============================================================
-- 0054 — CVL signature dates are typed and saved
-- ============================================================
--
-- Until now every date beside a signature on the CVL forms was left blank for
-- the hand and refused by cvl_form_answers_no_handwritten (0039). Since Nov
-- 2026 they are typed: each starts from Form 509's "Date to which summary is
-- made up" and can be changed on its form, so they are saved with the draft:
--
--   Form 509   date_signed
--   Part A     a9_date, a10_date, f507a_date_signed
--   Part B     b31_date
--   tables     signedDate ("...and dated", top level of the answers)
--
-- Still refused, as before: Part B's B6 user name and password, and the B1
-- address. The signatures themselves are never stored anywhere.
--
-- The constraint is replaced, not altered: Postgres has no ALTER for a CHECK.
--
-- ── Preflight (run before applying) ───────────────────────────────────────
--
--   -- The constraint from 0039 is there: 1 row.
--   SELECT conname FROM pg_constraint
--    WHERE conrelid = 'public.cvl_form_answers'::regclass AND conname = 'cvl_form_answers_no_handwritten';
--
-- ── Post-apply ─────────────────────────────────────────────────────────────
--
--   -- The new definition lists no date: expect no 'date' in it.
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conrelid = 'public.cvl_form_answers'::regclass AND conname = 'cvl_form_answers_no_handwritten';
--
--   -- Drafts holding a signature date (counts only).
--   SELECT form_code, count(*) FROM public.cvl_form_answers
--    WHERE answers ? 'signedDate'
--       OR (answers -> 'fields') ?| ARRAY['date_signed', 'a9_date', 'a10_date', 'f507a_date_signed', 'b31_date']
--    GROUP BY form_code;

ALTER TABLE public.cvl_form_answers
  DROP CONSTRAINT IF EXISTS cvl_form_answers_no_handwritten;

ALTER TABLE public.cvl_form_answers
  ADD CONSTRAINT cvl_form_answers_no_handwritten
    CHECK (
      jsonb_typeof(answers) = 'object'
      AND NOT (answers ?| ARRAY[
        'b6_username', 'b6_password',
        'b1_address', 'b1_street', 'b1_suburb', 'b1_state', 'b1_postcode'
      ])
      AND NOT (COALESCE(answers -> 'fields', '{}'::jsonb) ?| ARRAY[
        'b6_username', 'b6_password',
        'b1_address', 'b1_street', 'b1_suburb', 'b1_state', 'b1_postcode'
      ])
    );
