import type { ComparisonRow, ComparisonTable, PrintedComparison } from './compare'
import type { Meaning } from './meanings'
import { MEANING } from './meanings'

/**
 * What "Choose another" offers for each key figure: by default only the
 * printed lines that could plausibly be it; "Show all lines" offers the
 * whole statement. Pure.
 *
 *   Revenue             profit and loss: income, sales and revenue lines and totals
 *   Net profit          profit and loss: result lines (profit, loss, earnings)
 *   Net assets          balance sheet: net assets, total equity
 *   Income tax payable  liabilities with "tax" in the label
 *   Loan accounts       loan, director, shareholder, related party, associate, beneficiary lines
 *   ATO-related debt    liabilities with ATO, BAS, GST, PAYG or tax in the label
 */

export const STATEMENT_NAME = { profit_and_loss: 'Profit and loss', balance_sheet: 'Balance sheet' } as const

const path = (r: ComparisonRow) => r.path.join(' > ').toLowerCase()
const isLiability = (r: ComparisonRow) => /liabilit/.test(path(r)) && !/equity|capital|funds|reserves/.test((r.path[r.path.length - 1] ?? '').toLowerCase())
const isExpenseSection = (r: ComparisonRow) => /expense|cost|outgoing|overhead/.test(path(r))

const PLAUSIBLE: Record<Meaning, (r: ComparisonRow) => boolean> = {
  revenue: (r) => !isExpenseSection(r) && /\b(income|sales?|revenue|turnover|fees?)\b/i.test(`${r.label} ${r.path.join(' ')}`) && !/\b(profit|loss|tax)\b/i.test(r.label),
  net_profit: (r) => r.style === 'total' || /\b(profit|loss|earnings|surplus|deficit)\b/i.test(r.label) || /^net income\b/i.test(r.label),
  net_assets: (r) => /\bnet assets\b|\bequity\b|\btrust funds\b|\bnet liabilities\b/i.test(r.label),
  income_tax_payable: (r) => isLiability(r) && /\btax(ation)?\b/i.test(r.label),
  loan_receivable: (r) => /\b(loans?|directors?|shareholders?|related|associates?|associated|beneficiar(y|ies))\b/i.test(r.label),
  loan_payable: (r) => /\b(loans?|directors?|shareholders?|related|associates?|associated|beneficiar(y|ies))\b/i.test(r.label),
  ato_debt: (r) => isLiability(r) && /\b(ato|bas|gst|payg|tax(ation)?|activity statement)\b/i.test(r.label),
  credit_cards: (r) => isLiability(r) && /\b(credit cards?|amex|visa|mastercard)\b/i.test(r.label),
  cash_loans: (r) => isLiability(r) && /\b(loans?|chattel|hire purchase|finance|unexpired interest|mortgage|borrowings?)\b/i.test(r.label),
  bank_overdraft: (r) => isLiability(r) && (/overdraft/i.test(r.label) || /overdraft/.test(path(r))),
  trade_suppliers: (r) => isLiability(r) && /\b(creditors|accounts payable|trade payables?|suppliers?)\b/i.test(r.label),
}

function statementRows(comparison: PrintedComparison, meaning: Meaning): ComparisonRow[] {
  const table: ComparisonTable | undefined = comparison.tables.find((t) => t.kind === MEANING[meaning].statement)
  // Headings carry no figure; ratios ("Gross Profit Margin 88%") are not amounts.
  return (table?.rows ?? []).filter((r) => r.style !== 'heading' && r.style !== 'ratio')
}

/**
 * The lines to choose from: the ones already chosen first (marked "current"
 * by the picker), then the plausible ones in printed order, or every line
 * with `all`. Loan accounts list the owed-to-the-company side first: assets
 * for the receivable, liabilities for the payable.
 */
export function pickerRows(comparison: PrintedComparison, meaning: Meaning, chosen: string[], { all = false } = {}): ComparisonRow[] {
  const rows = statementRows(comparison, meaning)
  const current = chosen.map((k) => rows.find((r) => r.key === k)).filter((r): r is ComparisonRow => !!r)
  let rest = rows.filter((r) => !chosen.includes(r.key) && (all || PLAUSIBLE[meaning](r)))
  if (meaning === 'loan_receivable' || meaning === 'loan_payable') {
    const first = (r: ComparisonRow) => (meaning === 'loan_receivable' ? !isLiability(r) : isLiability(r))
    rest = [...rest.filter(first), ...rest.filter((r) => !first(r))]
  }
  return [...current, ...rest]
}

/** `"Loan - Related Parties" — Balance sheet › ASSETS › Current Assets`; an empty heading is left out. */
export function describeLine(row: ComparisonRow, meaning: Meaning): { label: string; where: string } {
  const where = [STATEMENT_NAME[MEANING[meaning].statement], ...row.path.filter((p) => p.trim() !== '')].join(' › ')
  return { label: row.label.trim() || '(line with no label)', where }
}

/** Case-insensitive search over the label and its headings. */
export function matchesSearch(row: ComparisonRow, query: string): boolean {
  const q = query.trim().toLowerCase()
  return !q || `${row.label} ${row.path.join(' ')}`.toLowerCase().includes(q)
}
