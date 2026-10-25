-- Migration: which printed lines mean what, per client, confirmed by staff.
--
-- Additive only: two new tables. Nothing existing is changed.
--
-- The comparison shows lines exactly as printed (printed_reads, migration
-- 0033). The headline tiles and the SBR prediction need to know which printed
-- line is the revenue, the net profit, the net assets, the ATO-related debt,
-- the director or related-party loan account and the other creditors. A
-- dictionary suggests them (src/lib/printed/dictionary.ts); staff confirm
-- once per client; the confirmed lines are the only source of those figures.
-- Nothing is guessed: a meaning with no confirmed line shows "Not identified".
--
-- 1. client_line_mappings — the current mapping. One row per meaning and
--    printed line ("row_key": statement, section path and label as printed,
--    normalised). row_key '' with none_printed = true records staff saying
--    the statements print no such line (no loan account, say).
-- 2. client_line_mapping_changes — every change, who and when.
--
-- ── Preflight (run before applying) ───────────────────────────────────────
--
--   -- Neither table exists yet: 0 rows.
--   SELECT table_name
--     FROM information_schema.tables
--    WHERE table_schema = 'public'
--      AND table_name IN ('client_line_mappings', 'client_line_mapping_changes');
--
-- ── Post-apply ─────────────────────────────────────────────────────────────
--
--   -- Both tables, RLS on: rls_enabled = true for each.
--   SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled
--     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--    WHERE n.nspname = 'public'
--      AND c.relname IN ('client_line_mappings', 'client_line_mapping_changes');
--
--   -- After staff confirm a client's mapping: what is mapped, and by whom.
--   SELECT m.client_id, m.meaning, m.statement, m.label, m.none_printed, m.confirmed_by, m.confirmed_at
--     FROM public.client_line_mappings m
--    ORDER BY m.client_id, m.meaning, m.label;
--
--   -- Its history.
--   SELECT ch.client_id, ch.meaning, ch.action, ch.label, ch.changed_by, ch.changed_at
--     FROM public.client_line_mapping_changes ch
--    ORDER BY ch.client_id, ch.changed_at;

CREATE TABLE IF NOT EXISTS public.client_line_mappings (
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  -- src/lib/printed/meanings.ts
  meaning text NOT NULL CHECK (meaning IN (
    'revenue', 'net_profit', 'net_assets', 'ato_debt', 'income_tax_payable',
    'loan_receivable', 'loan_payable',
    'credit_cards', 'cash_loans', 'bank_overdraft', 'trade_suppliers'
  )),
  -- The comparison row key (src/lib/printed/compare.ts); '' when none printed.
  row_key text NOT NULL,
  statement text CHECK (statement IS NULL OR statement IN ('profit_and_loss', 'balance_sheet')),
  -- As printed, for people reading the table: the key is what matches.
  label text,
  section_path text[] NOT NULL DEFAULT '{}',
  none_printed boolean NOT NULL DEFAULT false,
  confirmed_by text NOT NULL,
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (client_id, meaning, row_key),
  CONSTRAINT client_line_mappings_none_has_no_line
    CHECK ((none_printed AND row_key = '') OR (NOT none_printed AND row_key <> ''))
);

CREATE TABLE IF NOT EXISTS public.client_line_mapping_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  meaning text NOT NULL,
  -- 'added' / 'removed': a line; 'none_printed': staff said there is none.
  action text NOT NULL CHECK (action IN ('added', 'removed', 'none_printed')),
  row_key text NOT NULL,
  label text,
  changed_by text NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS client_line_mapping_changes_client_id_idx
  ON public.client_line_mapping_changes (client_id, changed_at);

-- Server-side only (service role).
ALTER TABLE public.client_line_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_line_mapping_changes ENABLE ROW LEVEL SECURITY;
