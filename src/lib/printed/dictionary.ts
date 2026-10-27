import type { ComparisonRow, PrintedComparison } from './compare'
import type { Meaning } from './meanings'

/**
 * Suggested printed lines for each meaning, from the printed label and the
 * section it sits in. Pure. Only a suggestion: staff confirm the mapping
 * (mapping.ts) before any tile or prediction uses it.
 *
 *   "Loan - Related Parties" under assets         loan account owed to the company
 *   the same under liabilities                    loan account owed by the company
 *   … printed NEGATIVE under liabilities          owed TO the company (the director owes it)
 *   "Owner … Funds Introduced" under liabilities  owed by the company
 *   "Loan 2019" (no lender named), negative under
 *   liabilities or positive under assets          owed to the company
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
const RELATED = /\b(directors?|shareholders?|unitholders?|related part(y|ies)|beneficiar(y|ies)|associates?|owner|proprietor|drawings|funds introduced|quarantined)\b|^loan\s*[-–]\s*[a-z]+\s+[a-z]+(\s+[a-z]+)?$/i
const LOAN_OWED_TO = /\b(loans?|accounts?)\b|^loan\b/i
/** A loan with no lender, vehicle or person named: "Loan 2019", "Loan - 2023", "Loans" (old reader: director-related). */
const UNNAMED_LOAN = /^loans?(\s*[-–]?\s*(19|20)\d{2})?$/i
/** Money a director put in or took out, which is owed either way without the word "loan". */
const DIRECTOR_MONEY = /\b(funds introduced|drawings|owner)\b/i
const NOT_A_LOAN = /\b(borrowing costs?|deposits?|bond|interest)\b/i
/**
 * "Loan - Hino Truck" is equipment finance and "Loan - Westpac" a lender, not
 * a person: never a related-party loan. The old reader's lists (labels.ts
 * ASSET_WORDS, VEHICLE_BRANDS, LENDER_MARKERS), with its rule that "Van" is a
 * vehicle unless a name follows it ("Loan - Van Nguyen" is a person).
 */
const EQUIPMENT_OR_LENDER = new RegExp(
  [
    // Asset words
    'trucks?|utes?|cars?|excavators?|plant|equipment|vehicles?|machinery|forklift|trailer|bobcat|tractor|boat|crane|loader|motorbike|motorcycle',
    // Vehicle brands and models
    'vw|volkswagen|audi|toyota|hino|isuzu|ford|holden|mazda|nissan|mitsubishi|mercedes|benz|bmw|landcruiser|land cruiser|hilux|t cross|tcross|ranger|navara|triton|prado|kia|hyundai|subaru|volvo|kenworth|iveco|fuso|kubota|caterpillar|cat|komatsu|tesla|jeep|lexus|porsche|suzuki|honda|renault|peugeot|skoda|ldv|ram|dmax|d max',
    // Lenders and finance
    'bank|banking|finance|financial|capital|credit|pty|ltd|limited|leasing|lease|funding|lending|lender|ondesk|getcapital|capify|westpac|nab|anz|cba|commonwealth|macquarie|st george|stgeorge|bendigo|suncorp|amex|pepper|latitude|prospa|moula|ato|insurance|premium|mortgage|chattel|hire purchase|hire|unexpired',
  ]
    .map((words) => `\\b(${words})\\b`)
    .join('|') + '|\\bvan\\b(?!\\s+(?!loans?\\b)[a-z]{2,})',
  'i',
)
const CREDIT_CARD = /\b(credit cards?|amex|american express|visa|mastercard)\b/i
const FINANCE = /\b(loans?|chattel|hire purchase|finance|unexpired interest|mortgage|borrowings?)\b/i
const OVERDRAFT = /overdraft/i
/** A bank account printed under liabilities is overdrawn (old reader labels.ts BANK_ACCOUNT). */
const BANK_ACCOUNT =
  /^((business|cheque|operating|trading|transaction|everyday|savings|working|bank|main|online)( (cheque|saver|savings))? account|bank|cash at bank|bank overdraft|overdraft|(westpac|cba|commonwealth|nab|anz|bendigo|st george|stgeorge|macquarie|suncorp|bankwest|ing)( bank)?( (business|cheque|operating|transaction|savings))? account)( \d+| no \d+)?$/i

/**
 * A loan naming a director on file (old reader labels.ts classifyLoan): a
 * one-word name needs that word in the label, a longer name two of its words.
 */
export function namesDirector(label: string, directors: readonly string[]): boolean {
  const words = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\b(loans?|less|to|from|account|a c|payable|receivable|owing|the)\b/g, ' ')
      .split(' ')
      .filter((t) => t.length >= 2)
  const tokens = words(label)
  return directors.some((director) => {
    const name = words(director)
    if (name.length === 0) return false
    const shared = name.filter((t) => tokens.includes(t)).length
    return name.length === 1 ? shared === 1 : shared >= 2
  })
}
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

export function suggestMapping(comparison: PrintedComparison, { directors = [] }: { directors?: readonly string[] } = {}): Suggestions {
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
  const related = (r: ComparisonRow) =>
    (RELATED.test(r.label) || namesDirector(r.label, directors)) && !NOT_A_LOAN.test(r.label) && !EQUIPMENT_OR_LENDER.test(r.label)
  // The newest printed amount says which way a loan account is owed (mapping.ts readLoanLine).
  const latest = (r: ComparisonRow) => {
    for (let i = r.cells.length - 1; i >= 0; i--) {
      const v = r.cells[i]
      if (v.printed && typeof v.value === 'number') return v.value
    }
    return 0
  }
  const unnamedLoan = (r: ComparisonRow) => UNNAMED_LOAN.test(r.label.trim()) && !NOT_A_LOAN.test(r.label) && !EQUIPMENT_OR_LENDER.test(r.label)
  const owedTo = (r: ComparisonRow) =>
    (isAsset(r) && latest(r) >= 0 && ((related(r) && (LOAN_OWED_TO.test(r.label) || DIRECTOR_MONEY.test(r.label))) || unnamedLoan(r))) ||
    (isLiability(r) && latest(r) < 0 && (related(r) || unnamedLoan(r)))
  // Old reader: an unnamed loan under liabilities is the director's, owed by the company.
  const owedBy = (r: ComparisonRow) =>
    (isLiability(r) && latest(r) >= 0 && (related(r) || unnamedLoan(r))) || (isAsset(r) && latest(r) < 0 && (related(r) || unnamedLoan(r)))
  const loanReceivable = pick(lines.filter(owedTo))
  const loanPayable = pick(lines.filter(owedBy))
  const creditCards = pick(lines.filter((r) => isLiability(r) && CREDIT_CARD.test(r.label)))
  const overdraft = pick(lines.filter((r) => isLiability(r) && (OVERDRAFT.test(r.label) || under(r, OVERDRAFT) || BANK_ACCOUNT.test(r.label.trim()))))
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
