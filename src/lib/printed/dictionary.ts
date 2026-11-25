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
const RELATED = /\b(directors?|shareholders?|unitholders?|related part(y|ies)|beneficiar(y|ies)|associates?|owner|proprietor|drawings|funds introduced|quarantined)\b/i
/** "Loan - Aaron Peters": a loan naming a person (two or three words, no lender, vehicle or asset). */
const PERSON_NAME_LOAN = /^loan\s*[-–]\s*[a-z]+\s+[a-z]+(\s+[a-z]+)?$/i
/** A trust's beneficiary accounts: unpaid distributions, shown as their own labelled line so staff can untick them. */
const BENEFICIARY_ACCOUNT = /\bbeneficiar(y|ies)'?s?'?\s+(current\s+)?accounts?\b/i
export const isBeneficiaryAccount = (label: string) => BENEFICIARY_ACCOUNT.test(label)
/** Names the statements give a trust's beneficiaries: "Profit Distribution - Jane Example", "Beneficiary - Jane Example". */
const BENEFICIARY_NAMED = /\b(distributions?|beneficiar(y|ies)'?s?'?(\s+accounts?)?)\s*[-–:]\s*(.+)$/i
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

/**
 * A person's (or company's) own account lines, as Xero prints a trust's or partnership's beneficiary
 * accounts (Gabby, 25 Nov 2026): "Matthew Trow - Drawings", "Matthew Trow - Share of Profit",
 * "Matthew Trow - Capital Introduced". All of one name's lines are one account.
 */
const PERSON_ACCOUNT =
  /^(.+?)\s+[-–]\s+(drawings?|share of (?:profits?|loss(?:es)?|profit\s*\/\s*loss)|capital introduced|funds introduced|loans?(?: account)?|current account|distributions?(?: payable)?|beneficiary account)$/i

/** "Matthew Trow - Drawings" → { name: "Matthew Trow", kind: "Drawings" }; null for any other line. */
export function personAccount(label: string): { name: string; kind: string } | null {
  const m = PERSON_ACCOUNT.exec(label.trim())
  if (!m) return null
  const name = m[1].trim()
  // "Loan - Drawings", "Total - Drawings": not a name.
  if (!/[a-z]{2,}/i.test(name) || /^(loans?|total|less|owner|director|directors|shareholders?)$/i.test(name)) return null
  return { name, kind: m[2].trim() }
}

export const personKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** The names with a "<Name> - Share of Profit" line on the balance sheet: beneficiaries, so related (Gabby, 25 Nov 2026). */
export function profitShareNames(labels: string[]): Set<string> {
  return new Set(labels.flatMap((l) => {
    const p = personAccount(l)
    return p && /^share of/i.test(p.kind) ? [personKey(p.name)] : []
  }))
}

/** Why a person-account name is related: a director, the client / trust / trustee company, or a beneficiary. Null: not known. */
export function personRelatedReason(name: string, { directors = [], parties = [] }: RelatedNames, shares: Set<string>): string | null {
  if (namesDirector(name, directors)) return 'a director on file'
  if (namesParty(name, parties)) return 'the client, the trust or the trustee company on file'
  if (shares.has(personKey(name))) return 'a beneficiary (the balance sheet prints their share of profit)'
  return null
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
const TOTAL_CURRENT_ASSETS: RegExp[] = [/^total current assets$/i]
const TOTAL_NON_CURRENT_ASSETS: RegExp[] = [/^total non[- ]?current assets$/i]
const TOTAL_ASSETS: RegExp[] = [/^total assets$/i]
/** Drawings: money taken out by the owner or a director, printed under equity (Gabby, 18 Nov 2026). */
const DRAWINGS = /\bdrawings?\b/i
export const DRAWINGS_HINT = 'Money taken out by the owner (printed under Equity)'

/** Asset sections by kind, for a balance sheet that prints no "Total current assets" (a Xero layout: "Bank", "Fixed Assets"). */
const CURRENT_SECTION = /^(bank|bank accounts|cash|cash (and|&) cash equivalents|current assets|receivables|trade receivables|debtors|inventor(y|ies)|stock( on hand)?)$/i
const NON_CURRENT_SECTION = /^(fixed assets|non[- ]?current assets|property,? plant (and|&) equipment|plant (and|&) equipment|intangibles?|intangible assets|investments|long[- ]term investments)$/i

export interface SectionLine {
  rowKey: string
  rule: string
  /** Not proven by the statement's own arithmetic: offered as a possible line, never auto-selected. */
  possible: boolean
}

const cents = (v: unknown) => (typeof v === 'number' ? Math.round(v * 100) : null)

/**
 * For each year whose balance sheet prints no "Total current assets" / "Total non-current assets":
 * its asset sections' printed totals, used ONLY when the statement's own arithmetic proves them
 * (Gabby, 18 Nov 2026): every asset section is clearly current-type or non-current-type, there is
 * exactly one of each, and their printed totals add up EXACTLY to the printed "Total Assets"
 * (MBM FY2026: "Total Bank" 11,885.53 + "Total Fixed Assets" 313,633.20 = 325,518.73). Otherwise
 * the section totals are offered as possible lines.
 */
export function assetSectionTotals(bs: ComparisonRow[], columns: number): { current: SectionLine[]; nonCurrent: SectionLine[] } {
  const current = new Map<string, SectionLine>()
  const nonCurrent = new Map<string, SectionLine>()
  const add = (to: Map<string, SectionLine>, line: SectionLine) => {
    const was = to.get(line.rowKey)
    // Proven in any year wins over offered.
    if (!was || (was.possible && !line.possible)) to.set(line.rowKey, line)
  }
  for (let i = 0; i < columns; i++) {
    const printedIn = (r: ComparisonRow) => r.cells[i]?.printed && typeof r.cells[i].value === 'number'
    const named = (rules: RegExp[]) => bs.some((r) => printedIn(r) && rules.some((rule) => rule.test(r.label.trim())))
    const total = bs.find((r) => printedIn(r) && TOTAL_ASSETS.some((rule) => rule.test(r.label.trim())))
    const sectionTotals = bs.filter(
      (r) => printedIn(r) && r.style !== 'line' && r.path.length === 2 && /^assets$/i.test(r.path[0]) && r.label.trim().toLowerCase() === `total ${r.path[1]}`.toLowerCase(),
    )
    const kind = (r: ComparisonRow) => (CURRENT_SECTION.test(r.path[1].trim()) ? 'current' : NON_CURRENT_SECTION.test(r.path[1].trim()) ? 'non_current' : null)
    const cur = sectionTotals.filter((r) => kind(r) === 'current')
    const non = sectionTotals.filter((r) => kind(r) === 'non_current')
    // Both totals printed and no current-type section beside "Current Assets" (Xero's "Bank"): as printed.
    if (named(TOTAL_CURRENT_ASSETS) && named(TOTAL_NON_CURRENT_ASSETS) && cur.length <= 1) continue
    if (!total || sectionTotals.length === 0) continue
    const allKnown = sectionTotals.every((r) => kind(r) !== null)
    const sum = sectionTotals.reduce((s, r) => s + (cents(r.cells[i].value) ?? 0), 0)
    // Bank printed as its own section beside Current Assets (Xero): current assets are both
    // (Gabby, 25 Nov 2026: FY2026 18,326.75 + 26,925.93 = 45,252.68), never "Total Current Assets" alone.
    const proven = allKnown && cur.length >= 1 && non.length === 1 && sum === cents(total.cells[i].value)
    if (proven) {
      const names = (rows: ComparisonRow[]) => rows.map((r) => `“${r.label.trim()}”`).join(' and ')
      const one = cur.length === 1
      const curRule = one
        ? `From ${names(cur)} and ${names(non)}, which add up to the printed Total Assets.`
        : `From ${names(cur)}, added up: with ${names(non)} they add up to the printed Total Assets.`
      const nonRule = one ? curRule : `From ${names(non)}: with ${names(cur)} it adds up to the printed Total Assets.`
      for (const r of cur) add(current, { rowKey: r.key, rule: curRule, possible: false })
      add(nonCurrent, { rowKey: non[0].key, rule: nonRule, possible: false })
    } else {
      const why = 'An asset section total; its sections do not add up exactly to the printed Total Assets (or are not clearly current or non-current), so it is not used on its own.'
      for (const r of cur) add(current, { rowKey: r.key, rule: why, possible: true })
      for (const r of non) add(nonCurrent, { rowKey: r.key, rule: why, possible: true })
    }
  }
  return { current: [...current.values()], nonCurrent: [...nonCurrent.values()] }
}

/**
 * How well a printed line matches a single-line meaning (0 best): the first dictionary rule its label
 * matches; a section total next; a line staff chose last. Decides which of two mapped lines counts in
 * a year that prints both (mapping.ts).
 */
export function lineRank(meaning: Meaning, label: string): number {
  const rules: Partial<Record<Meaning, RegExp[]>> = {
    revenue: REVENUE,
    net_profit: NET_PROFIT,
    net_assets: NET_ASSETS,
    income_tax_payable: [INCOME_TAX],
    total_current_assets: TOTAL_CURRENT_ASSETS,
    total_non_current_assets: TOTAL_NON_CURRENT_ASSETS,
    total_assets: TOTAL_ASSETS,
  }
  const i = (rules[meaning] ?? []).findIndex((rule) => rule.test(label.trim()))
  if (i >= 0) return i
  return /^total /i.test(label.trim()) ? 50 : 100
}

const NET_ASSETS: RegExp[] = [/^net assets$/i, /^total (shareholders'?s? |members'? )?equity$/i, /^total trust funds$/i]

/** An "Income" total that is net of cost of sales, or built on a profit line ("Trading Profit"): not revenue. */
function netOfCosts(rows: ComparisonRow[], total: ComparisonRow): boolean {
  const prefix = total.path.join('\u0000')
  return rows.some(
    (r) => r.path.join('\u0000').startsWith(prefix) && ((r.style === 'heading' && /cost/i.test(r.label)) || (r.style === 'line' && /profit/i.test(r.label))),
  )
}

/**
 * One line per DOCUMENT (each year's statement, Gabby 18 Nov 2026): for every column, the
 * best-ranked line printed in it. A meaning can so map to different printed lines in different
 * years ("Net Profit After Tax" in FY2022–FY2025, "Net Profit" in FY2026); where two chosen lines
 * print in the same year, the better-ranked one counts there (mapping.ts, lineRank).
 */
function bestPerDocument(rows: ComparisonRow[], rules: RegExp[], columns: number): string[] {
  const ranked = [...new Set(rules.flatMap((rule) => rows.filter((r) => rule.test(r.label.trim()) && printedAnywhere(r))))]
  const keys: string[] = []
  for (let i = 0; i < columns; i++) {
    const best = ranked.find((r) => r.cells[i]?.printed && typeof r.cells[i].value === 'number')
    if (best && !keys.includes(best.key)) keys.push(best.key)
  }
  return ranked.filter((r) => keys.includes(r.key)).map((r) => r.key)
}

/** One line per layout: the best match, then more for years it leaves blank. */
export function bestPerLayout(rows: ComparisonRow[], rules: RegExp[], columns: number): string[] {
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
  // Lines offered only (possibleOnly) are never a suggestion: staff choose them (autoMapping.ts).
  return Object.fromEntries(Object.entries(detailed).map(([m, lines]) => [m, lines.filter((l) => !l.possibleOnly).map((l) => l.rowKey)])) as Suggestions
}

/** A suggested line and the dictionary rule that matched it, in plain English (logged with an auto-selection). */
export interface SuggestedLine {
  rowKey: string
  rule: string
  /**
   * A loan naming a person who is not the client, a director, a beneficiary
   * (as the statements name them) or the trustee company: never auto-selected,
   * offered as a possible line (autoMapping.ts).
   */
  unknownPerson?: boolean
  /** Offered as a possible line only, never auto-selected; why, in plain words. */
  possibleOnly?: string
}

/** A loan line that names a person not on file: "Loan - Aaron Peters", "Loan from Aaron Peters". */
export function namesUnknownPerson(label: string, { directors = [], parties = [] }: RelatedNames): boolean {
  const t = label.trim()
  if (!PERSON_NAME_LOAN.test(t) && !PERSON_LOAN.test(t)) return false
  // "Loan - Related Parties", "Loan - Director Smith": related-party words, not an unknown person.
  if (EQUIPMENT_OR_LENDER.test(t) || RELATED.test(t)) return false
  return !namesDirector(t, directors) && !namesParty(t, parties)
}

/** The beneficiaries the balance sheet names ("Profit Distribution - Jane Example"): related parties of a trust. */
export function beneficiaryNames(labels: string[]): string[] {
  return [...new Set(labels.flatMap((l) => {
    const m = BENEFICIARY_NAMED.exec(l.trim())
    return m ? [m[4].trim()] : []
  }))].filter((n) => /[a-z]/i.test(n))
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
  if (isBeneficiaryAccount(label)) return 'Beneficiary accounts — unpaid distributions owed to the beneficiaries.'
  if (RELATED.test(label)) return 'Labelled as a director, shareholder, related-party, owner or beneficiary account.'
  if (PERSON_NAME_LOAN.test(label.trim())) return 'A loan naming a person.'
  return null
}

const RULE: Partial<Record<Meaning, string>> = {
  revenue: 'The total income (or sales) line the profit and loss prints.',
  net_profit: 'The net profit (or loss) line the profit and loss prints.',
  net_assets: 'The net assets (or total equity) line the balance sheet prints.',
  ato_debt: 'A liability labelled ATO, BAS, GST, PAYG or activity statement (not super, not income tax).',
  income_tax_payable: 'A liability labelled income tax payable, provision for income tax or taxation.',
  total_current_assets: 'The "Total current assets" line the balance sheet prints.',
  total_non_current_assets: 'The "Total non-current assets" line the balance sheet prints.',
  total_assets: 'The "Total assets" line the balance sheet prints.',
  credit_cards: 'A liability labelled credit card, Amex, Visa or Mastercard.',
  cash_loans: 'A liability labelled loan, chattel mortgage, hire purchase, finance or mortgage (not a related-party loan).',
  bank_overdraft: 'An overdraft, or a bank account printed under liabilities.',
  trade_suppliers: 'A liability labelled trade creditors, accounts payable or creditors.',
}

export function suggestMappingWithRules(comparison: PrintedComparison, names: RelatedNames = {}): Record<Meaning, SuggestedLine[]> {
  const pl = comparison.tables.find((t) => t.kind === 'profit_and_loss')?.rows ?? []
  const bs = comparison.tables.find((t) => t.kind === 'balance_sheet')?.rows ?? []
  const directors = names.directors ?? []
  // A trust's beneficiaries, as its balance sheet names them, are related parties too.
  const parties = [...(names.parties ?? []), ...beneficiaryNames(bs.map((r) => r.label))]
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
  // One account per person (Gabby, 25 Nov 2026): a name printed with two or more of its own account
  // lines ("Matthew Trow - Drawings", "- Share of Profit", "- Capital Introduced") is one director loan
  // account, its lines added up (mapping.ts nets them per year, never across people). A related name
  // (a director, the client / trust / trustee company, a beneficiary): all its lines, on the side its
  // latest net says. Any other name: offered, staff decide.
  const shares = profitShareNames(bs.map((r) => r.label))
  const groups = new Map<string, { name: string; rows: ComparisonRow[] }>()
  for (const r of lines.filter((x) => isLiability(x) || isAsset(x))) {
    const p = personAccount(r.label)
    if (!p) continue
    const g = groups.get(personKey(p.name)) ?? { name: p.name, rows: [] }
    g.rows.push(r)
    groups.set(personKey(p.name), g)
  }
  const personRule = new Map<string, string>()
  const personOffered: { rowKey: string; why: string }[] = []
  const personTo: ComparisonRow[] = []
  const personBy: ComparisonRow[] = []
  for (const g of groups.values()) {
    if (g.rows.length < 2) continue
    const kinds = [...new Set(g.rows.map((r) => personAccount(r.label)!.kind))].join(', ')
    const reason = personRelatedReason(g.name, { directors, parties }, shares)
    if (!reason) {
      for (const r of g.rows) personOffered.push({ rowKey: r.key, why: `“${g.name}”'s own account lines (${kinds}): not a director, beneficiary or the client on file.` })
      g.rows.forEach((r) => taken.add(r.key))
      continue
    }
    // Owed TO the company: printed negative under liabilities, positive under assets.
    const owed = g.rows.reduce((s, r) => s + (isLiability(r) ? -latest(r) : latest(r)), 0)
    for (const r of g.rows) personRule.set(r.key, `One account per person: “${g.name}”'s own lines (${kinds}) are added up — ${reason}. Its net says which way it is owed, year by year.`)
    ;(owed >= 0 ? personTo : personBy).push(...g.rows)
  }
  const personReceivable = pick(personTo)
  const personPayable = pick(personBy)
  // Drawings naming nobody ("Owner A Drawings"): offered only, never selected (Gabby, 25 Nov 2026).
  const unnamedDrawings = (r: ComparisonRow) => DRAWINGS.test(r.label) && !personAccount(r.label) && !namesDirector(r.label, directors) && !namesParty(r.label, parties)
  const loanReceivable = [...personReceivable, ...pick(lines.filter((r) => owedTo(r) && !fundsLoaned(r) && !unnamedDrawings(r)))]
  const loanPayable = [...personPayable, ...pick(lines.filter((r) => owedBy(r) && !unnamedDrawings(r)))]
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

  const sections = assetSectionTotals(bs, comparison.columns.length)
  const keys_taken = (key: string) => taken.has(key)
  const keys: Record<Meaning, string[]> = {
    // One printed line each: the best match.
    revenue: bestPerDocument(revenueRows, REVENUE, n),
    net_profit: bestPerDocument(pl, NET_PROFIT, n),
    net_assets: bestPerDocument(bs, NET_ASSETS, n),
    ato_debt: ato,
    income_tax_payable: bestPerDocument(bs.filter((r) => incomeTax.includes(r.key)), [/./], n),
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
    total_current_assets: [...new Set([...bestPerDocument(bs, TOTAL_CURRENT_ASSETS, n), ...sections.current.filter((l) => !l.possible).map((l) => l.rowKey)])],
    total_non_current_assets: [...new Set([...bestPerDocument(bs, TOTAL_NON_CURRENT_ASSETS, n), ...sections.nonCurrent.filter((l) => !l.possible).map((l) => l.rowKey)])],
    total_assets: bestPerDocument(bs, TOTAL_ASSETS, n),
  }
  // Lines offered, never auto-selected: section totals the statement's arithmetic does not prove,
  // and drawings (money taken out by the owner) for the director loan account (Debit).
  const offered: Partial<Record<Meaning, { rowKey: string; why: string }[]>> = {
    total_current_assets: sections.current.filter((l) => l.possible).map((l) => ({ rowKey: l.rowKey, why: l.rule })),
    total_non_current_assets: sections.nonCurrent.filter((l) => l.possible).map((l) => ({ rowKey: l.rowKey, why: l.rule })),
    loan_receivable: [
      ...personOffered,
      ...bs.filter((r) => r.style === 'line' && printedAnywhere(r) && DRAWINGS.test(r.label) && !keys_taken(r.key)).map((r) => ({ rowKey: r.key, why: DRAWINGS_HINT })),
    ],
  }
  const sectionRule = new Map([...sections.current, ...sections.nonCurrent].map((l) => [l.rowKey, l.rule]))
  const byKey = new Map([...bs, ...pl].map((r) => [r.key, r]))
  const loanRule = (meaning: 'loan_receivable' | 'loan_payable', key: string) => {
    const r = byKey.get(key)
    if (!r) return 'A loan account line.'
    const person = personRule.get(key)
    if (person) return person
    const why = relatedLoanReason(r.label, { directors, parties }) ?? 'A loan with no lender, vehicle or person named.'
    const side = isLiability(r) ? 'liabilities' : 'assets'
    const sign = latest(r) < 0 ? 'negative' : 'positive'
    const div7a = isDiv7A(r.label)
      ? 'Div 7A loan (counted; untick it if it should not be). '
      : isBeneficiaryAccount(r.label)
        ? 'Beneficiary accounts — unpaid distributions (counted; untick it if it should not be). '
        : ''
    return `${div7a}${why} Printed ${sign} under ${side}, so it is owed ${meaning === 'loan_receivable' ? 'TO' : 'BY'} the company.`
  }
  return Object.fromEntries(
    (Object.keys(keys) as Meaning[]).map((m) => [
      m,
      [
        ...keys[m].map((rowKey) => {
          const loan = m === 'loan_receivable' || m === 'loan_payable'
          const label = byKey.get(rowKey)?.label ?? ''
          return {
            rowKey,
            rule: loan ? loanRule(m, rowKey) : (sectionRule.get(rowKey) ?? RULE[m] ?? 'Matched by its printed label.'),
            ...(loan && namesUnknownPerson(label, { directors, parties }) ? { unknownPerson: true } : {}),
          }
        }),
        ...(offered[m] ?? []).filter((o) => !keys[m].includes(o.rowKey)).map((o) => ({ rowKey: o.rowKey, rule: o.why, possibleOnly: o.why })),
      ],
    ]),
  ) as Record<Meaning, SuggestedLine[]>
}
