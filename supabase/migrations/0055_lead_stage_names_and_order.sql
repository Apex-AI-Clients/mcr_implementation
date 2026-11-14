-- ============================================================
-- 0055 — lead stages: every stage can be renamed, every tab reordered
-- ============================================================
--
-- Gabby (Nov 2026): rename any stage, built-in ones included, and put the
-- tabs in his own order from an "Edit stages" panel on the leads page.
--
-- Built-in stages already have a lead_stages row each (0042), holding the
-- default singular name ("Client"). A built-in whose label differs from that
-- default has been renamed: its new name is then used for its tab and the
-- stage everywhere. One unrenamed keeps its plural tab name ("Clients").
--
-- 1. former_labels: the names a stage had before. Activity entries keep the
--    name they were written with ("Stage before: Prospect."), and
--    clientDeleted.ts reads the stage back from it, so a rename must not lose
--    the old name.
-- 2. position now orders every tab, built-in ones too (it was custom only;
--    built-ins were ordered in code). Built-ins take today's order, 0–7;
--    staff-added stages keep theirs after them.
--
-- ── Preflight ──────────────────────────────────────────────────────────────
--   -- The 8 built-in rows (0042): 8.
--   SELECT count(*) FROM public.lead_stages WHERE built_in;
--   -- No former_labels yet: 0 rows.
--   SELECT column_name FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'lead_stages' AND column_name = 'former_labels';
--
-- ── Post-apply ─────────────────────────────────────────────────────────────
--   -- Tab order as before: lead, prospect, client, unresponsive, do_not_contact,
--   -- contact_in_30_days, non_proceeding, converted, then staff-added.
--   SELECT key, label, position FROM public.lead_stages ORDER BY position, label;

ALTER TABLE public.lead_stages
  ADD COLUMN IF NOT EXISTS former_labels text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.lead_stages.former_labels IS
  'Names this stage had before a rename, so activity entries written under an old name still read back to the stage.';
COMMENT ON COLUMN public.lead_stages.position IS
  'Tab order on the leads page, built-in and staff-added stages together (0055).';

-- Built-ins in today's tab order (constants.ts LEAD_VIEWS), only while they
-- still all sit at the 0042 default of 0, so a re-run never undoes an order
-- Gabby set.
UPDATE public.lead_stages s
   SET position = o.position
  FROM (VALUES
    ('lead', 0), ('prospect', 1), ('client', 2), ('unresponsive', 3),
    ('do_not_contact', 4), ('contact_in_30_days', 5), ('non_proceeding', 6), ('converted', 7)
  ) AS o(key, position)
 WHERE s.key = o.key
   AND NOT EXISTS (SELECT 1 FROM public.lead_stages b WHERE b.built_in AND b.position <> 0);

-- Staff-added stages after the built-ins, keeping their own order.
UPDATE public.lead_stages
   SET position = position + 100
 WHERE NOT built_in AND position < 100;
