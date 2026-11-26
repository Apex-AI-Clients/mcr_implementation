import { namesDirector, namesParty, personAccount, personKey } from '@/lib/printed/dictionary'

/**
 * Pure. Masks the names in printed labels and headings before they go to
 * Claude for the key-figure choice (item 9b; the user's conditions, 26 Nov 2026):
 *
 *   - every name is replaced by a placeholder by role, from our records:
 *     [client], [director n], [beneficiary n], [related company n]; any other
 *     name is [person n]. A line naming a [person n] is only ever a possible
 *     line, never auto-chosen (keyFigureChoice.ts).
 *   - the same person is always the same placeholder within a masker (one per
 *     client's statements), so one person's Drawings / Share of Profit /
 *     Capital Introduced lines can be grouped;
 *   - long digit strings (account numbers, ABN / ACN) and street addresses are
 *     masked too. Amounts and file names are never given to the masker.
 *
 * Real names are restored on our side only (`restore`).
 *
 * What counts as a name: a known name from our records (in full, or a
 * distinctive word of it); two or more capitalised words in a row that are
 * not accounting words ("Matthew Trow"); a company or trust name ("Example
 * Holdings Pty Ltd"); the person in "Loan - john smith", "Loan from …",
 * "… Loan Account", "<name> - Drawings". A single unknown capitalised word
 * ("Hino") is not taken for a name.
 */

export interface MaskRecords {
  /** The client, and its trust or company (when the client is not a trust's trustee). */
  client: string[]
  directors: string[]
  /** The trustee company of a trust client, and other related companies on file. */
  relatedCompanies: string[]
  /** As the statements name them ("Profit Distribution - Jane Example", "Jane Example - Share of Profit"). */
  beneficiaries: string[]
}

/** Lower-case words that are never a name: accounting words, and the small words between them. */
const VOCAB = new Set(
  `a an and or of the to for from in on at by with as less plus per via into
  total totals subtotal net gross other others sundry miscellaneous misc general
  assets asset liabilities liability equity capital reserves reserve retained earnings profits profit loss losses surplus deficit
  current non noncurrent non-current fixed intangible tangible long short term
  income revenue sales sale turnover fees fee commission commissions interest dividends dividend received receivable receivables payable payables
  expenses expense costs cost cogs purchases purchase stock inventory inventories opening closing goods sold work progress finished raw materials
  wages wage salaries salary super superannuation payroll leave annual long-service service provision provisions accrued accruals accrual prepaid prepayments prepayment
  tax taxation taxes gst payg bas ato withholding instalment instalments fbt income-tax deferred
  cash bank banks account accounts cheque savings saver operating trading transaction business everyday online offset term deposit deposits petty float hand on
  loan loans lent loaned advance advances borrowings borrowing mortgage mortgages chattel hire finance lease leases leasing unexpired charges charge
  credit debit card cards visa mastercard amex american express overdraft facility facilities line
  trade creditors creditor debtors debtor suppliers supplier customers customer allowance doubtful debts debt bad
  director directors shareholder shareholders shareholders' unitholder unitholders related party parties associate associates associated entity entities
  beneficiary beneficiaries beneficiary's distribution distributions distributed drawings owner owners proprietor partner partners partners' members member
  share shares ordinary preference issued paid up called contributed introduced funds fund trust trusts trustee trustees unit units discretionary family
  company companies pty ltd limited proprietary holdings holding group services corporation corp inc co
  div 7a division intercompany inter loan-account
  plant equipment machinery motor vehicle vehicles car cars truck trucks ute utes trailer trailers excavator forklift tools tool furniture fixtures fittings
  office computer computers software hardware buildings building land property properties improvements leasehold freehold premises
  goodwill intellectual patents trademarks formation establishment preliminary
  depreciation accumulated amortisation amortization impairment written down value at cost valuation revaluation
  investments investment shares listed unlisted managed portfolio
  rent rental rates insurance repairs maintenance electricity gas water telephone phone internet advertising marketing
  accounting legal consulting professional subscriptions travel entertainment fuel oil freight cartage postage printing stationery
  bank-fees merchant cleaning security training uniforms protective clothing licences licence registrations registration
  government grants grant rebate rebates subsidies subsidy jobkeeper boost cashflow covid
  gain gains disposal sale-of written-off forgiveness forgiven
  before after year years month months period ended ending end beginning start comparative restated
  statement statements position financial balance sheet profit-and-loss detailed trading-statement
  note notes schedule appendix page continued
  owing owed due unpaid outstanding refund refundable recoverable claimable
  employee employees staff contractors subcontractors labour labor hire-purchase
  other-income other-expenses miscellaneous-income sundry-income
  ato-integrated integrated client clearing suspense rounding unallocated unreconciled
  first second third new old main primary secondary`
    .split(/\s+/)
    .filter(Boolean),
)

const isVocab = (word: string) => {
  const w = word.toLowerCase().replace(/[’']s$/, '').replace(/[’'.]/g, '')
  return w.length <= 1 || VOCAB.has(w) || /^\d/.test(w)
}

const LONG_DIGITS = /\d(?:[\d \-]*\d)?/g
const ADDRESS =
  /\b(?:(?:unit|lot|shop|suite)\s+)?\d+[a-z]?(?:\s*\/\s*\d+[a-z]?)?\s+(?:[A-Za-z][A-Za-z'-]+\s+){1,3}(?:st|street|rd|road|ave|avenue|dr|drive|pl|place|ct|court|cres|crescent|hwy|highway|pde|parade|ln|lane|tce|terrace|bvd|blvd|boulevard|way|close|cl|cct|circuit|esp|esplanade)\b\.?/gi
/** A company or trust name: capitalised words then Pty Ltd / Limited / Ltd / Trust. */
const ENTITY = /\b((?:[A-Z][A-Za-z&'’.-]*\s+){1,5})(Pty\.?\s*Ltd\.?|Proprietary\s+Limited|Limited|Ltd\.?|Trust)\b/g
const LOAN_DASH_NAME = /^(loans?\s*[-–:]\s*)([a-z][a-z'’-]+(?:\s+[a-z][a-z'’-]+){1,2})$/i
const LOAN_FROM_NAME = /^(loans?\s+(?:from|to)\s+)([a-z][a-z'’-]+(?:\s+[a-z][a-z'’-]+){1,2})$/i
const NAME_LOAN_ACCOUNT = /^([a-z][a-z'’-]+(?:\s+[a-z][a-z'’-]+){1,2})(\s+loan account)$/i
const PLACEHOLDER = /\[(?:client|director \d+|beneficiary \d+|related company \d+|person \d+|number|address)\]/g

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export class LabelMasker {
  private readonly records: MaskRecords
  /** Placeholder → the real name it stands for (the first one seen), for `restore`. */
  private readonly real = new Map<string, string>()
  /** An unknown person's key → their placeholder. */
  private readonly people = new Map<string, string>()

  constructor(records: MaskRecords) {
    const clean = (names: string[]) => [...new Set(names.map((n) => n.trim()).filter((n) => /[a-z]/i.test(n)))]
    this.records = {
      client: clean(records.client),
      directors: clean(records.directors),
      relatedCompanies: clean(records.relatedCompanies),
      beneficiaries: clean(records.beneficiaries),
    }
  }

  /** The placeholder a name takes, by role from our records; anyone else is a [person n]. */
  private placeholderFor(name: string): string {
    const { client, directors, relatedCompanies, beneficiaries } = this.records
    const key = personKey(name)
    let tag: string | null = null
    const d = directors.findIndex((x) => personKey(x) === key || namesDirector(name, [x]))
    if (d >= 0) tag = `[director ${d + 1}]`
    else if (client.some((x) => personKey(x) === key || namesParty(name, [x]))) tag = '[client]'
    else {
      const c = relatedCompanies.findIndex((x) => personKey(x) === key || namesParty(name, [x]))
      if (c >= 0) tag = `[related company ${c + 1}]`
      else {
        const b = beneficiaries.findIndex((x) => personKey(x) === key || namesDirector(name, [x]))
        if (b >= 0) tag = `[beneficiary ${b + 1}]`
      }
    }
    if (!tag) {
      tag = this.people.get(key) ?? `[person ${this.people.size + 1}]`
      this.people.set(key, tag)
    }
    if (!this.real.has(tag)) this.real.set(tag, name.trim())
    return tag
  }

  /** Every name on our records, longest first, with the placeholder it takes. */
  private known(): { name: string; tag: string }[] {
    const { client, directors, relatedCompanies, beneficiaries } = this.records
    const all = [
      ...directors.map((name, i) => ({ name, tag: `[director ${i + 1}]` })),
      ...client.map((name) => ({ name, tag: '[client]' })),
      ...relatedCompanies.map((name, i) => ({ name, tag: `[related company ${i + 1}]` })),
      ...beneficiaries.map((name, i) => ({ name, tag: `[beneficiary ${i + 1}]` })),
    ]
    return all.sort((a, b) => b.name.length - a.name.length)
  }

  /** The distinctive words of the names on our records ("Doyle" of "Doyle Family Trust"), with their placeholder. */
  private knownWords(): Map<string, string> {
    const words = new Map<string, string>()
    for (const { name, tag } of [...this.known()].reverse()) {
      for (const w of name.split(/[^A-Za-z'’-]+/)) {
        if (w.length >= 3 && !isVocab(w)) words.set(w.toLowerCase(), tag)
      }
    }
    return words
  }

  mask(text: string): string {
    let out = text
    // Digits first: account numbers, ABN / ACN, BSBs (six or more digits, spaces and dashes allowed).
    out = out.replace(LONG_DIGITS, (m) => (m.replace(/\D/g, '').length >= 6 ? '[number]' : m))
    out = out.replace(ADDRESS, '[address]')
    // Names on our records, in full.
    for (const { name, tag } of this.known()) {
      out = out.replace(new RegExp(`(?<![A-Za-z])${escape(name)}(?![A-Za-z])`, 'gi'), () => {
        if (!this.real.has(tag)) this.real.set(tag, name)
        return tag
      })
    }
    // Company and trust names.
    out = out.replace(ENTITY, (m, words: string) => {
      const named = words.trim().split(/\s+/).filter((w) => !isVocab(w))
      return named.length === 0 ? m : this.placeholderFor(m)
    })
    // The person in a loan's own wording, in any case.
    const shaped = [LOAN_DASH_NAME, LOAN_FROM_NAME].find((re) => re.test(out.trim()))
    if (shaped) {
      const [, lead, name] = shaped.exec(out.trim())!
      if (name.split(/\s+/).every((w) => !isVocab(w))) out = `${lead}${this.placeholderFor(name)}`
    } else if (NAME_LOAN_ACCOUNT.test(out.trim())) {
      const [, name, tail] = NAME_LOAN_ACCOUNT.exec(out.trim())!
      if (name.split(/\s+/).every((w) => !isVocab(w))) out = `${this.placeholderFor(name)}${tail}`
    } else {
      const account = personAccount(out)
      if (account && !account.name.includes('[') && account.name.split(/\s+/).every((w) => !isVocab(w))) {
        out = out.replace(account.name, this.placeholderFor(account.name))
      }
    }
    // Two or more capitalised non-accounting words in a row: a name.
    out = out.replace(/\b[A-Z][A-Za-z'’-]*(?:\s+[A-Z][A-Za-z'’-]*)+/g, (run) => {
      const words = run.split(/\s+/)
      const spans: string[] = []
      let current: string[] = []
      const flush = () => {
        if (current.length >= 2) spans.push(current.join(' '))
        current = []
      }
      for (const w of words) {
        if (!isVocab(w)) current.push(w)
        else flush()
      }
      flush()
      let masked = run
      for (const span of spans) masked = masked.replace(span, this.placeholderFor(span))
      return masked
    })
    // A distinctive word of a name on our records, on its own ("Loan - Doyle").
    const words = this.knownWords()
    out = out.replace(/(?<![[A-Za-z])[A-Za-z'’-]{3,}(?![A-Za-z\]])/g, (w) => {
      const tag = words.get(w.toLowerCase())
      return tag && !/^(client|director|beneficiary|related|company|person|number|address)$/i.test(w) ? tag : w
    })
    return out
  }

  /** Placeholders in Claude's answer back to the real names (our side only). */
  restore(text: string): string {
    return text.replace(PLACEHOLDER, (tag) => this.real.get(tag) ?? tag)
  }
}

/** A masked line naming someone not on our records: never auto-chosen. */
export const namesUnknownPlaceholder = (masked: string) => /\[person \d+\]/.test(masked)
