-- ============================================================
-- 0061 — The balance sheet's totals as line meanings
-- ============================================================
--
-- The comparison page shows headline figures only (Gabby, 16 Nov 2026),
-- among them the balance sheet's own "Total current assets", "Total
-- non-current assets" and "Total assets". Like every headline figure they are
-- printed lines staff can confirm or change on "Confirm key figures", and are
-- auto-selected from the printed total (src/lib/printed/dictionary.ts).
--
-- Adds the three meanings to the allowed list. Nothing else changes; the
-- prediction does not use them.
--
-- Until this is applied the page still shows them (worked out when it opens);
-- they are just not kept, and a staff choice for one of them cannot be saved.
--
-- ── Preflight ──────────────────────────────────────────────────────────────
--   SELECT count(*) FROM public.client_line_mappings WHERE meaning LIKE 'total_%';   -- 0
--
-- ── Post-apply ─────────────────────────────────────────────────────────────
--   SELECT meaning, count(*) FROM public.client_line_mappings GROUP BY meaning ORDER BY meaning;

ALTER TABLE public.client_line_mappings
  DROP CONSTRAINT IF EXISTS client_line_mappings_meaning_check,
  ADD CONSTRAINT client_line_mappings_meaning_check
    CHECK (meaning IN (
      'revenue', 'net_profit', 'net_assets', 'ato_debt', 'income_tax_payable',
      'loan_receivable', 'loan_payable',
      'credit_cards', 'cash_loans', 'bank_overdraft', 'trade_suppliers',
      'cash_at_bank', 'cash_on_hand', 'trade_debtors', 'stock',
      'plant_equipment', 'other_assets', 'share_capital',
      'total_current_assets', 'total_non_current_assets', 'total_assets'
    ));
