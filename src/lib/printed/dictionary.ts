import type { ComparisonRow, PrintedComparison } from './compare'
import type { Meaning } from './meanings'

/**
 * Suggested printed lines for each meaning, from the printed label and the
 * section it sits in. Pure. Only a suggestion: staff confirm the mapping
 * (mapping.ts) before any tile or prediction uses it.
 *
 *   "Loan - Related Parties" under assets         loan account owed to the company
 *   the same under liabilities                    loan account owed by the company
 *   "BAS Payable", "GST", "PAYG", "ATO …"         ATO-related debt
 *   "Income Tax Payable", "Taxation"              income tax payable, on its own
 *
 * For revenue, net profit and net assets one line per layout: the best line,
 * then another for any year it does not print (a current-period report laid
 * out differently from the annual ones).
 */

export type Suggestions = Record<Meaning, string[]>

const pathText = (r: ComparisonRow) => r.path.join(' > ').toLowerCase()
const under = (r: ComparisonRow, re: RegExp) => re.test(pathText(r))
/** The innermost printed section: equity under "Liabilities and shareholders' equity" is equity. */
const section = (r: ComparisonRow) => (r.path[r.path.length - 1] ?? '').toLowerCase()
const EQUITY = /equity|capital|funds|reserves/
const isLiability = (r: ComparisonRow) => under(r, /liabilit/) && !EQUITY.test(section(r)) && !/^total\b/i.test(r.label)
const isAsset = (r: ComparisonRow) => under(r, /asset/) && !under(r, /liabilit/) && !/^total\b/i.test(r.label)
const printedAnywhere = (r: ComparisonRow) => r.cells.some((c) => c.printed && typeof c.value === 'number')

const ATO = /\b(ato|bas|gst|payg|activity statement|taxation office|integrated client account)\b/i
const INCOME_TAX = /\b(income tax|provision for (income )?tax)\b|^taxation$/i
const SUPER = /\bsuper/i
const RELATED = /\b(directors?|shareholders?|related part(y|ies)|beneficiar(y|ies)|associates?|owner|proprietor|drawings|funds introduced)\b|^loan\s*[-–]\s*[a-z]+\s+[a-z]+(\s+[a-z]+)?$/i
const LOAN_OWED_TO = /\b(loans?|accounts?)\b|^loan\b/i
const NOT_A_LOAN = /\b(borrowing costs?|deposits?|bond|interest)\b/i
/** "Loan - Hino Truck" is equipment finance, not a person: never a related-party loan. */
const EQUIPMENT_OR_LENDER = /\b(truck|excavator|vehicle|car|ute|van|trailer|equipment|machinery|plant|finance|bank|chattel|mortgage|unexpired|lease|hire|vw|audi|toyota|hino|ford|holden|nissan|mazda|isuzu|landcruiser|prospa|getcapital|ondesk|moula|capify)\b/i
const CREDIT_CARD = /\b(credit cards?|amex|american express|visa|mastercard)\b/i
const FINANCE = /\b(loans?|chattel|hire purchase|finance|unexpired interest|mortgage|borrowings?)\b/i
const OVERDRAFT = /overdraft/i
const TRADE = /\b(trade creditors|accounts payable|trade payables|sundry creditors|creditors)\b/i

/** Best first: the first rule a row matches ranks it. */
const REVENUE: RegExp[] = [/^total (trading )?(income|revenue|sales)$/i, /^total sales? of goods$/i, /^(sales|sales revenue|revenue|turnover|income from sales)$/i]
const NET_PROFIT: RegExp[] = [
  /^net profit after (income )?tax/i,
  /^net (profit|earnings|income)( ?\/? ?\(?loss\)?)?$/i,
  /^net trading profit ?\/?\(?loss\)?$/i,
  /^profit ?\/? ?\(?loss\)? before (distributions?|taxation|tax|income tax)$/i,
  /^profit \(?loss\)? from ordinary activities (before|after) (income )?tax/i,
]
const NET_ASSETS: RegExp[] = [/^net assets$/i, /^total (shareholders'?s? |members'? )?equity$/i, /^total trust funds$/i]

/** An "Income" total that is net of cost of sales, or built on a profit line ("Trading Profit"): not revenue. */
function netOfCosts(rows: ComparisonRow[], total: ComparisonRow): boolean {
  const prefix = total.path.join('\u0000')
  return rows.some(
    (r) => r.path.join('\u0000').startsWith(prefix) && ((r.style === 'heading' && /cost/i.test(r.label)) || (r.style === 'line' && /profit/i.test(r.label))),
  )
}

/** One line per layout: the best match, then more for years it leaves blank. */
function bestPerLayout(rows: ComparisonRow[], rules: RegExp[], columns: number): string[] {
  const ranked = rules.flatMap((rule) => rows.filter((r) => rule.test(r.label.trim()) && printedAnywhere(r)))
  const chosen: ComparisonRow[] = []
  for (const r of ranked) {
    if (chosen.includes(r)) continue
    const covered = (i: number) => chosen.some((c) => c.cells[i].printed)
    if (chosen.length === 0 || Array.from({ length: columns }, (_, i) => i).some((i) => !covered(i) && r.cells[i].printed)) chosen.push(r)
  }
  return chosen.map((r) => r.key)
}

export function suggestMapping(comparison: PrintedComparison): Suggestions {
  const pl = comparison.tables.find((t) => t.kind === 'profit_and_loss')?.rows ?? []
  const bs = comparison.tables.find((t) => t.kind === 'balance_sheet')?.rows ?? []
  const n = comparison.columns.length
  const lines = bs.filter((r) => r.style === 'line' && printedAnywhere(r))
  const taken = new Set<string>()
  const pick = (rows: ComparisonRow[]) => {
    const keys = rows.filter((r) => !taken.has(r.key)).map((r) => r.key)
    keys.forEach((k) => taken.add(k))
    return keys
  }

  // A section total or a line, never a result; never the total of "other income".
  const revenueRows = pl.filter((r) => r.style !== 'total' && !(r.style === 'subtotal' && (/\bother\b/i.test(section(r)) || netOfCosts(pl, r))))
  const incomeTax = pick(lines.filter((r) => isLiability(r) && INCOME_TAX.test(r.label)))
  const ato = pick(lines.filter((r) => isLiability(r) && ATO.test(r.label) && !SUPER.test(r.label)))
  const related = (r: ComparisonRow) => RELATED.test(r.label) && !NOT_A_LOAN.test(r.label) && !EQUIPMENT_OR_LENDER.test(r.label)
  const loanReceivable = pick(lines.filter((r) => isAsset(r) && related(r) && LOAN_OWED_TO.test(r.label)))
  const loanPayable = pick(lines.filter((r) => isLiability(r) && related(r)))
  const creditCards = pick(lines.filter((r) => isLiability(r) && CREDIT_CARD.test(r.label)))
  const overdraft = pick(lines.filter((r) => isLiability(r) && (OVERDRAFT.test(r.label) || under(r, OVERDRAFT))))
  const cashLoans = pick(lines.filter((r) => isLiability(r) && FINANCE.test(r.label)))
  const trade = pick(lines.filter((r) => isLiability(r) && TRADE.test(r.label)))

  return {
    // One printed line each: the best match.
    revenue: bestPerLayout(revenueRows, REVENUE, n).slice(0, 1),
    net_profit: bestPerLayout(pl, NET_PROFIT, n).slice(0, 1),
    net_assets: bestPerLayout(bs, NET_ASSETS, n).slice(0, 1),
    ato_debt: ato,
    income_tax_payable: incomeTax.slice(0, 1),
    loan_receivable: loanReceivable,
    loan_payable: loanPayable,
    credit_cards: creditCards,
    cash_loans: cashLoans,
    bank_overdraft: overdraft,
    trade_suppliers: trade,
  }
}
