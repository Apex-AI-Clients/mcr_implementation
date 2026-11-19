-- ============================================================
-- 0060 — The test bank: proven notices and statements
-- ============================================================
--
-- Gabby, 18 Nov 2026: every notice and financial statement that is proven
-- joins a private regression set. What is kept is the document id and the
-- figures it was proven with, never a copy of the file: the check
-- (`npm run proof:check`, and `npm run figures:check`) reads each file again
-- from our storage with the current code, and any change to a proven figure
-- fails it.
--
--   kind       'dpn' | 'statement'
--   expected   dpn: { type, issuedOn, rows: [{ periodFrom, periodTo, column2..5 }], totals }
--              (cents; no name, reference, ACN or address)
--              statement: { years: { "FY2024": { "<statement>|<line key>": <figure> } } }
--   joined_at  when the file first proved; an entry is never overwritten
--              (the first proven figures are the answer key). To bank a file
--              again after a deliberate change: delete its row, and the next
--              run joins it with the figures it proves then.
--
-- Service role only: RLS on, no policies (the app's server and the scripts).
-- New table; nothing existing changes.
--
-- ── Preflight ──────────────────────────────────────────────────────────────
--   SELECT to_regclass('public.proof_bank');   -- null
--
-- ── Post-apply ─────────────────────────────────────────────────────────────
--   SELECT kind, count(*) FROM public.proof_bank GROUP BY 1;   -- none, until a run (or PROOF_BANK_JOIN=yes npm run proof:check)

CREATE TABLE IF NOT EXISTS public.proof_bank (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('dpn', 'statement')),
  expected jsonb NOT NULL,
  joined_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, kind)
);

CREATE INDEX IF NOT EXISTS proof_bank_client_idx ON public.proof_bank (client_id);

ALTER TABLE public.proof_bank ENABLE ROW LEVEL SECURITY;
