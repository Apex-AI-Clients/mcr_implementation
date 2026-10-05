import { digitsOnly, isValidAbn } from '@/lib/asic/identifiers'
import { financialYearOf } from './filenameYear'
import type {
  FinancialDocumentKind,
  FinancialPageClass,
  HeadingEntity,
  StatementHalfKey,
} from './types'

/**
 * What a financials PDF holds, from its text layer alone. Pure: it takes the
 * page lines lib/pdf/pageLines.ts reads, and no I/O happens here.
 *
 * Decided per page, from the headings at the top of each page:
 *
 *   tax_return        an appended Company/Trust Tax Return or its schedules.
 *                     Checked first: tax forms are full of statement words.
 *   cover             cover letter, title page, contents.
 *   income_statement  Income Statement / Profit and Loss, and its continuation
 *   balance_sheet     Balance Sheet / Statement of Financial Position
 *   notes_other       notes, appropriation, declarations, depreciation, etc.
 *   unknown           none of the above
 *
 * The earliest heading in a page's top lines wins, so "Notes to the Financial
 * Statements" followed by an "Income statement items" sub-heading is a notes
 * page, and a contents page listing "Balance Sheet ... 4" is a cover page.
 *
 * Then per document: its kind, the periods its statement headings name, the
 * column-header years, and the entity name and ABNs printed in the headings.
 */

/** How many lines from the top of a page count as its heading zone. */
const HEADING_ZONE_LINES = 10

/** Fewer non-empty lines than this across the whole file: no text layer. */
const MIN_TEXT_LINES = 3

export type NotesSection =
  | 'notes'
  | 'appropriation'
  | 'changes_in_equity'
  | 'declaration'
  | 'compilation'
  | 'depreciation'
  | 'cash_flow'

export type CoverSection = 'contents' | 'letter' | 'title'

export interface ClassifiedPage {
  /** 1-based physical page number in the file. */
  page: number
  class: FinancialPageClass
  /** The statements this page carries. Usually one; both on a one-page export. */
  statements: StatementHalfKey[]
  /** A statement page with no heading of its own, following one that had it. */
  continued?: boolean
  section?: NotesSection | CoverSection
}

export interface HeadingPeriod {
  page: number
  statement: StatementHalfKey
  kind: 'annual' | 'current_period'
  /** ISO date. */
  endDate: string
  /** ISO date; current-period P&L only. */
  startDate: string | null
  financialYear: number
  /** The heading phrase as printed (normalised), e.g. "1 july 2025 to 4 may 2026". */
  label: string
}

export interface PrepassClassification {
  kind: FinancialDocumentKind
  hasTextLayer: boolean
  pages: ClassifiedPage[]
  statementPages: Record<StatementHalfKey, number[]>
  periods: HeadingPeriod[]
  /** FYs of the annual statements' headings, ascending. */
  headingYears: number[]
  /** FY of a current-period heading, when there is one. */
  currentPeriodYear: number | null
  /** Years in the statements' column headers that are not heading years. */
  comparativeYears: number[]
  entity: HeadingEntity | null
}

// ─── Text helpers ─────────────────────────────────────────────────────────────

function norm(line: string): string {
  return line
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/[^a-z0-9&',./()\-–\s$]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function headingZone(lines: string[]): string[] {
  return lines.slice(0, HEADING_ZONE_LINES).map(norm)
}

// ─── Dates ────────────────────────────────────────────────────────────────────

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
}

const WORD_DATE = /(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})\.?,?\s+(\d{4}|\d{2})(?!\d)/
const NUMERIC_DATE = /(\d{1,2})[/.](\d{1,2})[/.](\d{4})/
/** Either shape, without capture groups, for building larger patterns. */
const ANY_DATE = String.raw`(?:\d{1,2}(?:st|nd|rd|th)?\s+[a-z]{3,9}\.?,?\s+(?:\d{4}|\d{2})(?!\d)|\d{1,2}[/.]\d{1,2}[/.]\d{4})`
const DATE_IN_LINE = new RegExp(ANY_DATE)

interface ParsedDate {
  iso: string
  year: number
  month: number
  day: number
}

function toDate(day: number, month: number, year: number): ParsedDate | null {
  if (!month || month > 12 || day < 1 || day > 31) return null
  const full = year < 100 ? 2000 + year : year
  if (full < 2000 || full > 2100) return null
  const iso = `${full}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  return { iso, year: full, month, day }
}

/** The first date in a string: "30 June 2025", "30th Jun, 25" or "30/06/2025". */
function findDate(text: string): ParsedDate | null {
  const word = WORD_DATE.exec(text)
  if (word) {
    const month = MONTHS[word[2].slice(0, 4)] ?? MONTHS[word[2].slice(0, 3)]
    const parsed = month ? toDate(parseInt(word[1], 10), month, parseInt(word[3], 10)) : null
    if (parsed) return parsed
  }
  const numeric = NUMERIC_DATE.exec(text)
  return numeric
    ? toDate(parseInt(numeric[1], 10), parseInt(numeric[2], 10), parseInt(numeric[3], 10))
    : null
}

/** Whole months from start to end, counting a period that ends the day before an anniversary as complete. */
function monthsBetween(start: ParsedDate, end: ParsedDate): number {
  return (end.year - start.year) * 12 + (end.month - start.month) + (end.day >= start.day - 1 ? 1 : 0)
}

function isThirtiethJune(date: ParsedDate): boolean {
  return date.month === 6 && date.day === 30
}

// ─── Amount lines ─────────────────────────────────────────────────────────────

/** Grouped or decimal amounts: "120,000", "(1,234.56)", "-45.00", "$98,500". */
const GROUPED_AMOUNT = /^\(?-?\$?\d{1,3}(,\d{3})+(\.\d{2})?\)?$|^\(?-?\$?\d+\.\d{2}\)?$/
const PLAIN_NUMBER = /^\(?-?\$?\d{2,}\)?$/
const YEAR_TOKEN = /^(19|20)\d{2}$/

/**
 * A line of figures: "Sales 120,000 98,500", "Cash (1,234.56)", "Bank fees 45 30".
 * Not a dated heading ("as at 30 June 2025") and not an ABN line.
 */
function isAmountLine(raw: string): boolean {
  const line = norm(raw)
  if (/\babn\b|\bacn\b/.test(line) || DATE_IN_LINE.test(line)) return false
  const last = line.split(' ').pop() ?? ''
  if (GROUPED_AMOUNT.test(last)) return true
  return PLAIN_NUMBER.test(last) && !YEAR_TOKEN.test(last) && /[a-z]/.test(line)
}

// ─── Heading patterns (matched at the start of a normalised line) ────────────

const INCOME_STATEMENT_HEADING =
  /^(detailed )?(income statement|profit (and|&) loss( statement| account| report)?|statement of profit (or|and) loss|statement of (comprehensive )?income|trading,? profit (and|&) loss|operating statement|statement of financial performance)\b/

const BALANCE_SHEET_HEADING = /^(detailed )?(balance sheet|statement of financial position)\b/

/**
 * What may NOT follow a statement heading on its line. "Balance sheet items"
 * (a tax return label) and "Income statement items" (a notes sub-heading) are
 * not statements; "Profit & Loss [Accrual]" or "Balance Sheet as at …" are.
 */
const NOT_A_STATEMENT_TAIL =
  /^\s*(items?|schedules?|reconciliation|work ?sheets?|labels?|adjustments?|information|details? of|summary of|notes?|amounts?|totals? (per|from)|per (the )?(tax|return))\b/

function isStatementHeading(line: string, pattern: RegExp): boolean {
  const match = pattern.exec(line)
  return match !== null && !NOT_A_STATEMENT_TAIL.test(line.slice(match[0].length))
}

const NOTES_HEADINGS: Array<[RegExp, NotesSection]> = [
  [/^notes? (to|forming part of) (and forming part of )?the (financial|special purpose)/, 'notes'],
  [/^notes? to the accounts\b/, 'notes'],
  [/^(statement of )?appropriation( statement| account)?\b/, 'appropriation'],
  [/^statement of changes in equity\b/, 'changes_in_equity'],
  [/^(director'?s'?|trustee'?s'?|partners'?|proprietor'?s'?|responsible person'?s'?) declaration\b/, 'declaration'],
  [/^declaration by (the )?(directors?|trustees?)\b/, 'declaration'],
  [/^(compilation report|accountant'?s'? (compilation )?report|independent (audit|auditor'?s'?)( report)?)\b/, 'compilation'],
  [/^(detailed )?depreciation (schedule|worksheet|report)\b/, 'depreciation'],
  [/^(statement of )?cash flows?( statement)?\b/, 'cash_flow'],
]

/** Phrases that put a page in a tax return when they head it. */
const TAX_RETURN_HEADING =
  /^((company|trust|partnership|individual|smsf|fund) (income )?tax return|tax return\b|losses schedule|calculation statement|electronic lodg(e)?ment declaration|capital gains tax (cgt )?schedule|cgt schedule|international dealings schedule|tax agent'?s'? declaration)/

/** Strong tax-form markers anywhere on a page; two different ones make it a tax return. */
const TAX_RETURN_MARKERS: RegExp[] = [
  /\btax file number\b/,
  /\btfn\b/,
  /\bcompany tax return\b/,
  /\btrust tax return\b/,
  /\btaxable income or loss\b/,
  /\bpayg instalments? raised\b/,
  /\bitem \d{1,2}\b/,
  /\bdeclaration\b.*\btax agent\b/,
]

const CONTENTS_HEADING = /^(table of )?contents$|^index$/
/** A contents line: a known section name, then a page number. */
const CONTENTS_LINE =
  /^(detailed )?(income statement|profit (and|&) loss|balance sheet|statement of financial position|notes|appropriation|statement of changes|director|trustee|compilation|depreciation|cash flow)[a-z '&,()-]*\s\d{1,3}$/

const COVER_LETTER = /^dear\b|\byours (faithfully|sincerely|truly)\b|^kind regards\b/
const TITLE_PAGE = /\b(financial (statements|report)|annual (report|accounts)|special purpose financial)\b/

/** Positive evidence that a document is not financial statements at all. */
const NOT_FINANCIAL_MARKERS: RegExp[] = [
  /\btrust deed\b/,
  /\bdeed of (settlement|variation|appointment)\b/,
  /\bthis deed\b/,
  /\bexecuted as a deed\b/,
  /\bin witness whereof\b/,
  /\bsettlor\b/,
  /\bappointor\b/,
  /\blicen[cs]e (number|no\b|holder|class)\b/,
  /\bcertificate of registration\b/,
  /\bcurrent (& historical |and historical )?(company|organisation) extract\b/,
]

// ─── Page classification ──────────────────────────────────────────────────────

function firstHeading(
  zone: string[],
): { class: FinancialPageClass; section?: NotesSection; line: number } | null {
  for (let i = 0; i < zone.length; i++) {
    const line = zone[i]
    if (isStatementHeading(line, INCOME_STATEMENT_HEADING)) return { class: 'income_statement', line: i }
    if (isStatementHeading(line, BALANCE_SHEET_HEADING)) return { class: 'balance_sheet', line: i }
    for (const [pattern, section] of NOTES_HEADINGS) {
      if (pattern.test(line)) return { class: 'notes_other', section, line: i }
    }
  }
  return null
}

function isTaxReturnPage(zone: string[], all: string[]): boolean {
  if (zone.some((line) => TAX_RETURN_HEADING.test(line))) return true
  const text = all.join('\n')
  return TAX_RETURN_MARKERS.filter((marker) => marker.test(text)).length >= 2
}

function isContentsPage(zone: string[], all: string[]): boolean {
  if (zone.some((line) => CONTENTS_HEADING.test(line))) return true
  return all.filter((line) => CONTENTS_LINE.test(line)).length >= 3
}

/** The other statement's heading, as a line of its own anywhere below the first. */
function secondStatement(rest: string[], first: StatementHalfKey): StatementHalfKey | null {
  const other: StatementHalfKey = first === 'income_statement' ? 'balance_sheet' : 'income_statement'
  const pattern = other === 'balance_sheet' ? BALANCE_SHEET_HEADING : INCOME_STATEMENT_HEADING
  return rest.some((line) => isStatementHeading(line, pattern) && !isAmountLine(line)) ? other : null
}

export function classifyPages(pages: string[][]): ClassifiedPage[] {
  const out: ClassifiedPage[] = []
  let inTaxReturn = false

  pages.forEach((lines, index) => {
    const page = index + 1
    const all = lines.map(norm).filter(Boolean)
    const zone = headingZone(lines)
    const previous = out[out.length - 1]

    if (isTaxReturnPage(zone, all)) {
      inTaxReturn = true
      out.push({ page, class: 'tax_return', statements: [] })
      return
    }
    if (isContentsPage(zone, all)) {
      out.push({ page, class: 'cover', statements: [], section: 'contents' })
      return
    }

    const heading = firstHeading(zone)
    if (heading && heading.class !== 'notes_other') {
      // A statement heading ends a tax return: some bundles put the return first.
      inTaxReturn = false
      const first = heading.class as StatementHalfKey
      const second = secondStatement(all.slice(heading.line + 1), first)
      out.push({ page, class: first, statements: second ? [first, second] : [first] })
      return
    }
    if (heading) {
      out.push({ page, class: 'notes_other', statements: [], section: heading.section })
      return
    }

    // A tax return's later pages (schedules, worksheets) rarely repeat its
    // heading. Until a statement heading appears, they stay in the return.
    if (inTaxReturn) {
      out.push({ page, class: 'tax_return', statements: [] })
      return
    }

    if (all.some((line) => COVER_LETTER.test(line))) {
      out.push({ page, class: 'cover', statements: [], section: 'letter' })
      return
    }

    // A long statement runs onto the next page without repeating its heading.
    if (
      previous &&
      (previous.class === 'income_statement' || previous.class === 'balance_sheet') &&
      all.filter(isAmountLine).length >= 3
    ) {
      const last = previous.statements[previous.statements.length - 1]
      out.push({ page, class: last, statements: [last], continued: true })
      return
    }

    const beforeAnyStatement = !out.some((p) => p.statements.length > 0)
    if (beforeAnyStatement && zone.some((line) => TITLE_PAGE.test(line))) {
      out.push({ page, class: 'cover', statements: [], section: 'title' })
      return
    }

    out.push({ page, class: 'unknown', statements: [] })
  })

  return out
}

// ─── Periods ──────────────────────────────────────────────────────────────────

const PERIOD_RANGE = new RegExp(String.raw`(${ANY_DATE})\s*(?:to|until|-|–)\s*(${ANY_DATE})`)
const YEAR_ENDED = /\b(?:year|period of twelve months) (?:ended|ending)\b(.*)$/
const AS_AT = /\bas (?:at|of)\b(.*)$/

/** The period named in a statement page's heading lines, if any. */
function periodOf(page: ClassifiedPage, lines: string[]): HeadingPeriod | null {
  const statement = page.class as StatementHalfKey

  for (const line of headingZone(lines)) {
    const range = PERIOD_RANGE.exec(line)
    if (range) {
      const start = findDate(range[1])
      const end = findDate(range[2])
      if (start && end && end.iso > start.iso) {
        // A full year to 30 June is an annual statement, however it is worded.
        const annual = monthsBetween(start, end) >= 12 && isThirtiethJune(end)
        return {
          page: page.page,
          statement,
          kind: annual ? 'annual' : 'current_period',
          endDate: end.iso,
          startDate: annual ? null : start.iso,
          financialYear: financialYearOf(end.year, end.month),
          label: line.slice(range.index).trim(),
        }
      }
    }
    const yearEnded = YEAR_ENDED.exec(line)
    const yearEnd = yearEnded ? findDate(yearEnded[1]) : null
    if (yearEnded && yearEnd) {
      return {
        page: page.page,
        statement,
        kind: 'annual',
        endDate: yearEnd.iso,
        startDate: null,
        financialYear: financialYearOf(yearEnd.year, yearEnd.month),
        label: line.slice(yearEnded.index).trim(),
      }
    }
    const asAt = AS_AT.exec(line)
    const atDate = asAt ? findDate(asAt[1]) : null
    if (asAt && atDate) {
      // Annual balance sheets are struck at 30 June. Any other date is a point
      // inside the year: the current-period balance sheet.
      const annual = isThirtiethJune(atDate)
      return {
        page: page.page,
        statement,
        kind: annual ? 'annual' : 'current_period',
        endDate: atDate.iso,
        startDate: null,
        financialYear: financialYearOf(atDate.year, atDate.month),
        label: line.slice(asAt.index).trim(),
      }
    }
  }
  return null
}

/** Years in a statement's column-header lines: "2025 2024", "30 JUN 2025 30 JUN 2024". */
function columnYears(lines: string[]): number[] {
  const years = new Set<number>()
  for (const raw of lines.slice(0, 25)) {
    const stripped = norm(raw)
      .replace(new RegExp(WORD_DATE.source, 'g'), ' $3 ')
      .replace(/\b(notes?|aud)\b/g, ' ')
      .replace(/\$/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    // Only a line made of years and nothing else is a column header.
    if (/^20\d{2}( 20\d{2})+$/.test(stripped)) {
      for (const y of stripped.split(' ')) years.add(parseInt(y, 10))
    }
  }
  return [...years]
}

// ─── Entity ───────────────────────────────────────────────────────────────────

const ENTITY_NAME = /\b(pty\.?\s*ltd\.?|proprietary|limited|trust|atf|as trustee for)\b/i
const ABN = /\babn[:\s.]*((?:\d\s*){11})/gi

function entityFrom(pages: string[][], classified: ClassifiedPage[]): HeadingEntity | null {
  // Statement pages first: their heading names the entity being reported on.
  // Then the title page. Never a cover letter: its letterhead is the accountant's.
  const order = [
    ...classified.filter((p) => p.statements.length > 0 && !p.continued),
    ...classified.filter((p) => p.class === 'cover' && p.section === 'title'),
  ]
  let name: string | null = null
  const abns: string[] = []
  for (const page of order) {
    const zone = (pages[page.page - 1] ?? []).slice(0, HEADING_ZONE_LINES)
    if (!name) {
      const found = zone.find(
        (line) => ENTITY_NAME.test(line) && !TITLE_PAGE.test(norm(line)) && !isAmountLine(line),
      )
      if (found) name = found.replace(/\s*\babn\b.*$/i, '').replace(/\s+/g, ' ').trim() || null
    }
    for (const line of zone) {
      for (const match of line.matchAll(ABN)) {
        const abn = digitsOnly(match[1])
        if (isValidAbn(abn) && !abns.includes(abn)) abns.push(abn)
      }
    }
  }
  return name || abns.length > 0 ? { name, abns } : null
}

// ─── Document ─────────────────────────────────────────────────────────────────

export function classifyFinancialDocument(pages: string[][]): PrepassClassification {
  const textLines = pages.reduce((n, lines) => n + lines.filter((l) => l.trim()).length, 0)
  const hasTextLayer = textLines >= MIN_TEXT_LINES
  const classified: ClassifiedPage[] = hasTextLayer
    ? classifyPages(pages)
    : pages.map((_, i) => ({ page: i + 1, class: 'unknown', statements: [] }))

  const statementPages: Record<StatementHalfKey, number[]> = { income_statement: [], balance_sheet: [] }
  for (const page of classified) {
    for (const statement of page.statements) statementPages[statement].push(page.page)
  }

  const periods: HeadingPeriod[] = []
  const columnYearSet = new Set<number>()
  for (const page of classified) {
    if (page.statements.length === 0 || page.continued) continue
    const lines = pages[page.page - 1] ?? []
    const period = periodOf(page, lines)
    if (period) periods.push(period)
    for (const year of columnYears(lines)) columnYearSet.add(year)
  }

  const headingYears = [
    ...new Set(periods.filter((p) => p.kind === 'annual').map((p) => p.financialYear)),
  ].sort((a, b) => a - b)
  const current = periods.find((p) => p.kind === 'current_period')
  const comparativeYears = [...columnYearSet]
    .filter((y) => !headingYears.includes(y) && y !== current?.financialYear)
    .sort((a, b) => a - b)

  const hasIs = statementPages.income_statement.length > 0
  const hasBs = statementPages.balance_sheet.length > 0
  let kind: FinancialDocumentKind
  if (!hasTextLayer) kind = 'unknown'
  else if (hasIs && hasBs) kind = 'combined'
  else if (hasIs) kind = 'pnl_only'
  else if (hasBs) kind = 'bs_only'
  else if (classified.some((p) => p.class === 'tax_return')) kind = 'tax_return_only'
  else {
    // Only on positive evidence: a statement we failed to recognise must go to
    // the model as today, not be thrown away as "not financial".
    const text = pages.flat().map(norm).join('\n')
    kind = NOT_FINANCIAL_MARKERS.some((marker) => marker.test(text)) ? 'not_financial' : 'unknown'
  }

  return {
    kind,
    hasTextLayer,
    pages: classified,
    statementPages,
    periods,
    headingYears,
    currentPeriodYear: current?.financialYear ?? null,
    comparativeYears,
    entity: hasTextLayer ? entityFrom(pages, classified) : null,
  }
}
