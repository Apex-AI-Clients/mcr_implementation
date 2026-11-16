-- ============================================================
-- 0056 — Director penalty notices: which table layout the notice printed
-- ============================================================
--
-- Until Nov 2026 every notice seen had a five-column table: Column 3 (unpaid)
-- split into Column 4 (removed if the company pays or appoints an SBR
-- practitioner, administrator or liquidator within 21 days) and Column 5
-- (stays with the director unless paid).
--
-- Some PAYG withholding notices (template 73075.500008-02-2025) print only
-- three columns, and their remission paragraph says EVERY amount in the
-- table is remitted on payment or appointment within 21 days. The parser
-- then records Column 4 = Column 3 and Column 5 = 0, and this column says
-- the notice had no Column 4/5 split, so the notice card can say so.
--
--   five_column    the notice printed Columns 4 and 5 (every notice before)
--   three_column   no Column 4/5 split on the notice; 4 = 3, 5 = 0 by its wording
--
-- Add-only, with a default: existing rows become five_column, as they were.
-- Code that writes the column must not be deployed before this is applied.
--
-- ── Preflight (run before applying) ───────────────────────────────────────
--
--   -- No such column yet: 0 rows.
--   SELECT column_name FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'director_penalty_notices' AND column_name = 'table_layout';
--
-- ── Post-apply ─────────────────────────────────────────────────────────────
--
--   -- Every existing notice is five_column (counts only).
--   SELECT table_layout, count(*) FROM public.director_penalty_notices GROUP BY table_layout;

ALTER TABLE public.director_penalty_notices
  ADD COLUMN IF NOT EXISTS table_layout text NOT NULL DEFAULT 'five_column';

ALTER TABLE public.director_penalty_notices
  DROP CONSTRAINT IF EXISTS director_penalty_notices_table_layout_check;

ALTER TABLE public.director_penalty_notices
  ADD CONSTRAINT director_penalty_notices_table_layout_check
  CHECK (table_layout IN ('five_column', 'three_column'));
