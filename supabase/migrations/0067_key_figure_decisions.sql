-- ============================================================
-- 0067 — key_figure_decisions: each key figure is decided once per set of documents
-- ============================================================
--
-- Gabby, 24 Nov 2026 (item 9c), the user, 26 Nov 2026: every key-figure
-- choice (by the AI, by the rules, or by staff) is stored with who / what /
-- when and, for the AI, its one-line reason. It is never decided again on a
-- page load or a release: only a changed document (one added, replaced or
-- removed) or a staff change re-opens it.
--
-- One row per client and meaning: the current decision, with the lines it
-- chose (also copied to client_line_mappings, 0034, as before); every change is still logged
-- in client_line_mapping_changes. `document_ids` are the files the
-- comparison's figures came from when it was decided: a different set re-opens it. A chosen
-- line the statements no longer print (a re-read changed it) re-opens it too.
--
-- outcome:
--   'lines'        lines chosen (in client_line_mappings)
--   'not_printed'  the statements print no such line
--   'possible'     nothing chosen: the lines in `possible` wait for staff ("Possible line — use it?")
-- chosen_by: 'ai' (Claude chose, the rules agreed), 'rule' (the rules alone: AI off, failed or
-- not asked), 'staff'.
--
-- Labels in `possible` are as printed (our side only); nothing here is sent anywhere.
-- Service role only: RLS on, no policies. New table; nothing existing changes.
--
-- ── Preflight ──────────────────────────────────────────────────────────────
--   SELECT to_regclass('public.key_figure_decisions');   -- null

CREATE TABLE IF NOT EXISTS public.key_figure_decisions (
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  meaning text NOT NULL CHECK (length(meaning) BETWEEN 1 AND 60),
  outcome text NOT NULL CHECK (outcome IN ('lines', 'not_printed', 'possible')),
  chosen_by text NOT NULL CHECK (chosen_by IN ('ai', 'rule', 'staff')),
  -- 'auto' for the AI and the rules; the staff member's email for staff.
  decided_by text NOT NULL CHECK (length(decided_by) BETWEEN 1 AND 320),
  decided_at timestamptz NOT NULL DEFAULT now(),
  -- The rule used (plain English) and, for the AI, its one-line reason (names restored, our side only).
  rule text,
  ai_reason text,
  -- The lines chosen (outcome 'lines'): the comparison's row keys. The decision is the source of
  -- truth for auto choices; client_line_mappings keeps a copy as before.
  row_keys text[] NOT NULL DEFAULT '{}',
  -- [{ "rowKey", "label", "value", "column", "why" }]
  possible jsonb NOT NULL DEFAULT '[]'::jsonb,
  document_ids uuid[] NOT NULL DEFAULT '{}',
  PRIMARY KEY (client_id, meaning)
);

ALTER TABLE public.key_figure_decisions ENABLE ROW LEVEL SECURITY;

-- ── Verify ─────────────────────────────────────────────────────────────────
--   SELECT relrowsecurity FROM pg_class WHERE oid = 'public.key_figure_decisions'::regclass;   -- true
--   SELECT count(*) FROM public.key_figure_decisions;   -- 0 until a client's key figures are next opened
