-- ============================================================
-- 0043: auto-selected key figures (Gabby's request, 4 Nov 2026)
--
-- "Confirm key figures" pre-selects every meaning staff have not confirmed
-- (src/lib/printed/autoMapping.ts): the line(s) the dictionary matched, or
-- "Not printed" when no printed line looks like it. Auto-selections count as
-- confirmed for the SBR prediction, and are worked out again whenever the
-- figures change. A staff choice is never replaced.
--
--  - client_line_mappings.auto_rule: the rule used, in plain English. NULL
--    for a staff choice. An auto-selection has confirmed_by = 'auto'.
--  - client_line_mapping_changes.rule: the rule, on the auto_* log rows.
--  - client_line_mapping_changes.action takes three more values:
--    auto_selected, auto_none_printed, auto_removed (changed_by = 'auto').
--
-- Additive: until it is applied the app still auto-selects on every load,
-- it just keeps and logs nothing.
--
-- Check after applying:
--   SELECT column_name FROM information_schema.columns
--    WHERE table_schema = 'public'
--      AND ((table_name = 'client_line_mappings' AND column_name = 'auto_rule')
--        OR (table_name = 'client_line_mapping_changes' AND column_name = 'rule'));
-- ============================================================

ALTER TABLE public.client_line_mappings
  ADD COLUMN IF NOT EXISTS auto_rule text;

ALTER TABLE public.client_line_mapping_changes
  ADD COLUMN IF NOT EXISTS rule text;

ALTER TABLE public.client_line_mapping_changes
  DROP CONSTRAINT IF EXISTS client_line_mapping_changes_action_check,
  ADD CONSTRAINT client_line_mapping_changes_action_check
    CHECK (action IN ('added', 'removed', 'none_printed', 'auto_selected', 'auto_none_printed', 'auto_removed'));

-- An auto-selection says which rule chose it; a staff choice has none.
ALTER TABLE public.client_line_mappings
  DROP CONSTRAINT IF EXISTS client_line_mappings_auto_has_rule,
  ADD CONSTRAINT client_line_mappings_auto_has_rule
    CHECK ((confirmed_by = 'auto') = (auto_rule IS NOT NULL));
