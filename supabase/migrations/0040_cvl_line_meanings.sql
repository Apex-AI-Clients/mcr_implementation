-- Migration: printed-line meanings for the CVL forms (Form 509).
--
-- Additive: the meanings already allowed stay allowed, and no row changes.
--
-- client_line_mappings.meaning gains seven meanings that only the CVL forms
-- read (src/lib/printed/meanings.ts, `cvl: true`):
--
--   cash_at_bank      Form 509 1(d) cash at bank
--   cash_on_hand      Form 509 1(c) cash on hand
--   trade_debtors     Form 509 1(b) sundry debtors
--   stock             Form 509 1(e) stock
--   plant_equipment   Form 509 1(g) plant and machinery
--   other_assets      Form 509 1(h) other assets
--   share_capital     Form 509 item 9 share capital
--
-- The SBR prediction reads none of them: run `npm run figures:proof` before
-- and after and the prediction is byte-identical for every client.
--
-- Not added: a separate meaning for chattel mortgages. Those lines are already
-- "Bank loans and finance" (cash_loans), which the SBR creditor rows use; the
-- CVL screens read the financed vehicles from those lines instead.
--
-- GST, PAYG and super payable stay inside ato_debt. The Form 509 screen lists
-- each printed line separately, for display only.

ALTER TABLE public.client_line_mappings
  DROP CONSTRAINT IF EXISTS client_line_mappings_meaning_check,
  ADD CONSTRAINT client_line_mappings_meaning_check
    CHECK (meaning IN (
      'revenue', 'net_profit', 'net_assets', 'ato_debt', 'income_tax_payable',
      'loan_receivable', 'loan_payable',
      'credit_cards', 'cash_loans', 'bank_overdraft', 'trade_suppliers',
      'cash_at_bank', 'cash_on_hand', 'trade_debtors', 'stock',
      'plant_equipment', 'other_assets', 'share_capital'
    ));

-- Check after applying: the existing rows all still pass, and nothing moved.
--
--   SELECT meaning, count(*) FROM public.client_line_mappings GROUP BY meaning ORDER BY meaning;
