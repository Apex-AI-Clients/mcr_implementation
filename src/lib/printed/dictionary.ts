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
 *   "Funds Loaned to Trust - <anyone>", "Loan from
 *   <person>", "<person> Loan Account" under
 *   liabilities                                   owed by the company
 *   a loan line naming the client, a director,
 *   the trust or the trustee company             related party (its sign says which way)
 *   finance ("Loan - Dynamoney …", "…: Interest",
 *   chattel, hire purchase, vehicle/equipment)    never a related-party loan
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

/**
 * The names a loan line can name to be a related-party loan: the client's
 * directors (any line naming one, as before), and the client, the trust and
 * the trustee company on file (a LOAN line naming one of them).
 */
export interface RelatedNames {
  directors?: readonly string[]
  parties?: readonly string[]
}

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
/** Money lent to the business by whoever is named after it: owed BY the company (under liabilities). */
const FUNDS_LOANED = /\bfunds (loaned|lent|advanced) to (the )?(trust|company|business|partnership|entity)\b/i
/** "Loan from John Smith", "John Smith Loan Account": a person's loan (lenders are left out below). */
const PERSON_LOAN = /^loans? from [a-z]+( [a-z]+){1,2}$|^[a-z]+( [a-z]+){1,2} loan account$/i
/** A line that is a loan account at all: what a name needs beside it to be a related-party loan. */
const LOANISH = /\b(loans?|lent|loaned|advances?|funds introduced|loan account|div(ision)? ?7a)\b/i
/** A Division 7A loan: shown as its own labelled line ("Div 7A") so staff can see it and untick it. */
const DIV_7A = /\bdiv(ision)? ?7a\b/i
export const isDiv7A = (label: string) => DIV_7A.test(label)
/** Finance on a line, whatever else it names: interest, chattel mortgage, hire purchase, leases. */
const FINANCE_LINE = /:\s*interest\b|\b(unexpired interest|chattel|hire purchase|lease|leasing)\b/i
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
    // Equipment and vehicle financiers
    'dynamoney|earlypay|flexi ?commercial|flexicommercial|resimac|scotpac|multipli|true pillars|g ?& ?gf|group & general',
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
/** Words a company or trust name shares with any other: never enough to name one. */
const GENERIC_NAME_WORDS = /\b(pty|ltd|limited|the|and|trust|trustee|family|for|as|atf|co|company|corporation|corp|inc|holdings|group|services)\b/g

/**
 * A line naming the client, the trust or the trustee company: a one-word name
 * (once "Pty Ltd", "Family Trust"… are left out) needs that word, a longer
 * name two of its words. "Doyle Family Trust" is named by "Doyle";
 * "Example Earthworks & Haulage Pty Ltd" by "Example Earthworks".
 */
export function namesParty(label: string, parties: readonly string[]): boolean {
  const words = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(GENERIC_NAME_WORDS, ' ')
      .replace(/\b(loans?|less|to|from|account|a c|payable|receivable|owing|funds|loaned|lent)\b/g, ' ')
      .split(' ')
      .filter((t) => t.length >= 3)
  const tokens = words(label)
  return parties.some((party) => {
    const name = [...new Set(words(party))]
    if (name.length === 0) return false
    const shared = name.filter((t) => tokens.includes(t)).length
    return name.length === 1 ? shared === 1 : shared >= 2
  })
}

/** CVL, Form 509 assets and share capital (migration 0040). */
const CASH_AT_BANK = /\b(cash at bank|bank accounts?|cheque account|operating account|business (cheque |transaction )?account|savings account|term deposits?)\b/i
const CASH_ON_HAND = /\b(cash on hand|petty cash|cash in hand|float)\b/i
const TRADE_DEBTORS = /\b(trade debtors|debtors|accounts receivable|trade receivables?|receivables?)\b/i
const STOCK = /\b(stock|inventor(y|ies)|work in progress|finished goods|raw materials)\b/i
const PLANT = /\b(plant|equipment|machinery|motor vehicles?|vehicles?|furniture|fixtures|fittings|office equipment|computer equipment|tools)\b/i
const SHARE_CAPITAL = /\b(share capital|issued capital|paid[- ]up capital|ordinary shares?|contributed equity)\b/i
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

export function suggestMapping(comparison: PrintedComparison, names: RelatedNames = {}): Suggestions {
  const detailed = suggestMappingWithRules(comparison, names)
  return Object.fromEntries(Object.entries(detailed).map(([m, lines]) => [m, lines.map((l) => l.rowKey)])) as Suggestions
}

/** A suggested line and the dictionary rule that matched it, in plain English (logged with an auto-selection). */
export interface SuggestedLine {
  rowKey: string
  rule: string
}

/** Whether a balance sheet line is a related-party loan, and why: null when it is not one. */
export function relatedLoanReason(label: string, { directors = [], parties = [] }: RelatedNames): string | null {
  if (FINANCE_LINE.test(label)) return null
  if (FUNDS_LOANED.test(label)) return '“Funds loaned to …” is money lent to the business.'
  if (NOT_A_LOAN.test(label)) return null
  if (LOANISH.test(label) && namesParty(label, parties)) return 'A loan line naming the client, the trust or the trustee company on file.'
  if (EQUIPMENT_OR_LENDER.test(label)) return null
  if (namesDirector(label, directors)) return 'Names a director on file.'
  if (PERSON_LOAN.test(label.trim())) return 'A loan from (or loan account of) a person.'
  if (RELATED.test(label)) return 'Labelled as a director, shareholder, related-party, owner or beneficiary account.'
  return null
}

const RULE: Partial<Record<Meaning, string>> = {
  revenue: 'The total income (or sales) line the profit and loss prints.',
  net_profit: 'The net profit (or loss) line the profit and loss prints.',
  net_assets: 'The net assets (or total equity) line the balance sheet prints.',
  ato_debt: 'A liability labelled ATO, BAS, GST, PAYG or activity statement (not super, not income tax).',
  income_tax_payable: 'A liability labelled income tax payable, provision for income tax or taxation.',
  credit_cards: 'A liability labelled credit card, Amex, Visa or Mastercard.',
  cash_loans: 'A liability labelled loan, chattel mortgage, hire purchase, finance or mortgage (not a related-party loan).',
  bank_overdraft: 'An overdraft, or a bank account printed under liabilities.',
  trade_suppliers: 'A liability labelled trade creditors, accounts payable or creditors.',
}

export function suggestMappingWithRules(comparison: PrintedComparison, { directors = [], parties = [] }: RelatedNames = {}): Record<Meaning, SuggestedLine[]> {
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
  const related = (r: ComparisonRow) => relatedLoanReason(r.label, { directors, parties }) !== null
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
  // "Funds loaned to the trust" under liabilities is owed by it, whatever the sign.
  const fundsLoaned = (r: ComparisonRow) => isLiability(r) && FUNDS_LOANED.test(r.label)
  const owedBy = (r: ComparisonRow) =>
    fundsLoaned(r) ||
    (isLiability(r) && latest(r) >= 0 && (related(r) || unnamedLoan(r))) ||
    (isAsset(r) && latest(r) < 0 && (related(r) || unnamedLoan(r)))
  const loanReceivable = pick(lines.filter((r) => owedTo(r) && !fundsLoaned(r)))
  const loanPayable = pick(lines.filter(owedBy))
  const creditCards = pick(lines.filter((r) => isLiability(r) && CREDIT_CARD.test(r.label)))
  const overdraft = pick(lines.filter((r) => isLiability(r) && (OVERDRAFT.test(r.label) || under(r, OVERDRAFT) || BANK_ACCOUNT.test(r.label.trim()))))
  const cashLoans = pick(lines.filter((r) => isLiability(r) && FINANCE.test(r.label)))
  const trade = pick(lines.filter((r) => isLiability(r) && TRADE.test(r.label)))
  // CVL meanings last, so they never take a line from an SBR meaning above.
  const cashAtBank = pick(lines.filter((r) => isAsset(r) && (CASH_AT_BANK.test(r.label) || BANK_ACCOUNT.test(r.label.trim())) && !CASH_ON_HAND.test(r.label)))
  const cashOnHand = pick(lines.filter((r) => isAsset(r) && CASH_ON_HAND.test(r.label)))
  const tradeDebtors = pick(lines.filter((r) => isAsset(r) && TRADE_DEBTORS.test(r.label) && !RELATED.test(r.label)))
  const stock = pick(lines.filter((r) => isAsset(r) && STOCK.test(r.label)))
  // A printed "less accumulated depreciation" line is part of the written-down value.
  const plant = pick(lines.filter((r) => isAsset(r) && (PLANT.test(r.label) || (/depreciation/i.test(r.label) && PLANT.test(section(r))))))
  const shareCapital = pick(bs.filter((r) => r.style === 'line' && printedAnywhere(r) && EQUITY.test(section(r)) && SHARE_CAPITAL.test(r.label)))

  const keys: Record<Meaning, string[]> = {
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
    cash_at_bank: cashAtBank,
    cash_on_hand: cashOnHand,
    trade_debtors: tradeDebtors,
    stock,
    plant_equipment: plant,
    // Never guessed: what is left over is for staff to choose.
    other_assets: [],
    share_capital: shareCapital,
  }
  const byKey = new Map([...bs, ...pl].map((r) => [r.key, r]))
  const loanRule = (meaning: 'loan_receivable' | 'loan_payable', key: string) => {
    const r = byKey.get(key)
    if (!r) return 'A loan account line.'
    const why = relatedLoanReason(r.label, { directors, parties }) ?? 'A loan with no lender, vehicle or person named.'
    const side = isLiability(r) ? 'liabilities' : 'assets'
    const sign = latest(r) < 0 ? 'negative' : 'positive'
    const div7a = isDiv7A(r.label) ? 'Div 7A loan (counted; untick it if it should not be). ' : ''
    return `${div7a}${why} Printed ${sign} under ${side}, so it is owed ${meaning === 'loan_receivable' ? 'TO' : 'BY'} the company.`
  }
  return Object.fromEntries(
    (Object.keys(keys) as Meaning[]).map((m) => [
      m,
      keys[m].map((rowKey) => ({
        rowKey,
        rule: m === 'loan_receivable' || m === 'loan_payable' ? loanRule(m, rowKey) : (RULE[m] ?? 'Matched by its printed label.'),
      })),
    ]),
  ) as Record<Meaning, SuggestedLine[]>
}
