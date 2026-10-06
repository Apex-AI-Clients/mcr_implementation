import type { LineSection } from './types'

/**
 * Printed line labels -> canonical keys, decided in code. Pure.
 *
 * The model maps every line, but not always the same way in every file: one
 * year's "Rental Bond" becomes property, plant & equipment, the next year's
 * becomes "other". This dictionary is applied over the model's key, so a
 * label it knows always lands in the same place. Labels it does not know keep
 * the model's mapping.
 */

/** Spellings seen in real statements, put right before matching. */
const MISSPELLINGS: Array<[RegExp, string]> = [
  [/\bassests?\b/g, 'assets'],
  [/\bliabilites\b/g, 'liabilities'],
  [/\bliabilties\b/g, 'liabilities'],
  [/\bmaintainance\b/g, 'maintenance'],
  [/\bmaintenence\b/g, 'maintenance'],
  [/\brecievables?\b/g, 'receivable'],
  [/\breceivables\b/g, 'receivable'],
  [/\bpayables\b/g, 'payable'],
  [/\bequipments\b/g, 'equipment'],
  [/\bfitings\b/g, 'fittings'],
  [/\bdepreciaton\b/g, 'depreciation'],
  [/\bdeverlopment\b/g, 'development'],
]

/**
 * A label in comparable form: lowercase, "&" as "and", no punctuation, known
 * misspellings fixed, spaces collapsed. "Furniture & Fittings" and
 * "furniture and fittings." compare equal.
 */
export function normaliseLabel(label: string): string {
  let s = label
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  for (const [pattern, fix] of MISSPELLINGS) s = s.replace(pattern, fix)
  return s
}

const ASSET_SECTIONS: LineSection[] = ['currentAssets', 'nonCurrentAssets']
const LIABILITY_SECTIONS: LineSection[] = ['currentLiabilities', 'nonCurrentLiabilities']

// ─── Loans ────────────────────────────────────────────────────────────────────

/** A lender's name or form: the loan is owed to a finance business. */
const LENDER_MARKERS =
  /\b(bank|banking|finance|financial|capital|credit|pty|ltd|limited|leasing|lease|funding|lending|lender|ondesk|getcapital|westpac|nab|anz|cba|commonwealth|macquarie|st george|stgeorge|bendigo|suncorp|amex|pepper|latitude|prospa|moula|ato|insurance|premium|mortgage|chattel|hire purchase)\b/

/** An asset the loan financed. "van" is handled separately (it is also a name). */
const ASSET_WORDS =
  /\b(truck|trucks|ute|utes|car|cars|excavator|excavators|plant|equipment|vehicle|vehicles|machinery|forklift|trailer|bobcat|tractor|boat|crane|loader|motorbike|motorcycle)\b/

/** Vehicle and equipment makes and models seen on finance lines. */
const VEHICLE_BRANDS =
  /\b(vw|volkswagen|audi|toyota|hino|isuzu|ford|holden|mazda|nissan|mitsubishi|mercedes|benz|bmw|landcruiser|land cruiser|hilux|t cross|tcross|ranger|navara|triton|prado|kia|hyundai|subaru|volvo|kenworth|iveco|fuso|kubota|caterpillar|cat|komatsu|tesla|jeep|lexus|porsche|suzuki|honda|renault|peugeot|skoda|ldv|ram|dmax|d max)\b/

/** "van" as a vehicle: not followed by another name-like word ("Van Nguyen" is a name). */
const VAN_VEHICLE = /\bvan\b(?!\s+(?!loans?\b)[a-z]{2,})/

const LOAN_WORDS = /\b(loans?|less|to|from|account|a c|payable|receivable|owing|the)\b/g

export type LoanClass = 'director' | 'lender_asset' | 'lender' | 'unconfirmed'

/**
 * Who a loan line is owed to, from its label. Pure. Null when the label is
 * not a loan, or is a year-suffixed loan ("Loan 2020"), which the extraction
 * prompt already classifies.
 *
 *   director      the label names a director on file (every token of a
 *                 one-word name, or two or more of a longer name, in any
 *                 order), or says "director" / "shareholder" outright
 *   lender_asset  vehicle or equipment finance: an asset word or a make
 *                 ("Loan - VW", "Loan - Hino Truck", "Loan - Audi")
 *   lender        a finance business ("Business Loan - Ondesk", "Loan - Westpac")
 *   unconfirmed   anything else — never assumed to be a director's
 */
export function classifyLoan(rawLabel: string, directors: readonly string[] = []): LoanClass | null {
  const label = normaliseLabel(rawLabel)
  if (!/\bloans?\b/.test(label)) return null
  if (/^loans? 20\d{2}$/.test(label)) return null

  const tokens = label.replace(LOAN_WORDS, ' ').split(' ').filter((t) => t.length >= 2)
  for (const director of directors) {
    const name = normaliseLabel(director).split(' ').filter((t) => t.length >= 2)
    if (name.length === 0) continue
    const shared = name.filter((t) => tokens.includes(t)).length
    if (name.length === 1 ? shared === 1 : shared >= 2) return 'director'
  }
  if (/\b(director|directors|shareholder|shareholders)\b/.test(label)) return 'director'
  if (ASSET_WORDS.test(label) || VEHICLE_BRANDS.test(label) || VAN_VEHICLE.test(label)) return 'lender_asset'
  if (LENDER_MARKERS.test(label)) return 'lender'
  return 'unconfirmed'
}

export function isLiabilitySection(section: LineSection): boolean {
  return LIABILITY_SECTIONS.includes(section)
}

interface DictionaryEntry {
  pattern: RegExp
  /** Only on lines printed under these sections; any section when absent. */
  sections?: LineSection[]
  key: string
}

/**
 * Known labels. Order matters: the first match wins. Each key is
 * "section.key"; `other` keys name the bucket entry ("nonCurrentAssets.other.Deposits").
 */
const DICTIONARY: DictionaryEntry[] = [
  // Inventory: never direct costs.
  { pattern: /^(less )?opening (stock|inventory)( on hand)?$|^stock on hand at (the )?(beginning|start)/, sections: ['cogs'], key: 'cogs.openingStock' },
  { pattern: /^(less )?closing (stock|inventory)( on hand)?$|^stock on hand at (the )?end/, sections: ['cogs'], key: 'cogs.closingStock' },
  // Stock held at balance date is a current asset.
  { pattern: /^(inventor(y|ies)|stock on hand|trading stock|closing stock|stock)( at cost)?$/, sections: ASSET_SECTIONS, key: 'currentAssets.inventories' },

  // Expense labels seen in real statements, kept in one place every year.
  { pattern: /^(mv|m v|motor vehicle)( expenses?| costs?| running costs?)$/, sections: ['expenses'], key: 'expenses.motorVehicle' },
  { pattern: /^(business|general|public liability) insurance$/, sections: ['expenses'], key: 'expenses.insurance' },
  { pattern: /^(work ?cover|workers compensation)( insurance)?$/, sections: ['expenses'], key: 'expenses.insurance' },
  { pattern: /^(licen[cs]es?|registrations?)( and | )?(licen[cs]es?|registrations?)?$/, sections: ['expenses'], key: 'expenses.generalExpenses' },
  { pattern: /^(rent(al)? )?outgoings$/, sections: ['expenses'], key: 'expenses.rent' },
  { pattern: /^(merchant|eftpos) (fees?|charges?)$|^bank (charges|fees)( and merchant fees)?$/, sections: ['expenses'], key: 'expenses.bankFees' },
  { pattern: /^(waste( and)? cleaning|cleaning( and waste)?|waste (removal|disposal))$/, sections: ['expenses'], key: 'expenses.generalExpenses' },
  { pattern: /^asic (fees?|charges?|annual review fees?|lodgement fees?)$/, sections: ['expenses'], key: 'expenses.generalExpenses' },
  { pattern: /^gst( account| clearing| payable| control| collected)?$/, sections: ['currentLiabilities', 'nonCurrentLiabilities'], key: 'currentLiabilities.gstPayable' },

  // Amortisation is folded into depreciation, every year and column.
  { pattern: /^(less )?amorti[sz]ation\b|^depreciation and amorti[sz]ation$/, sections: ['expenses'], key: 'expenses.depreciation' },

  // Bonds and deposits: never property, plant & equipment.
  { pattern: /^((rental|rent|lease|security|shop|premises) )?(bond|bonds|deposit|deposits)( (paid|held|rent|lodged))?$|^bond rent$/, sections: ASSET_SECTIONS, key: 'nonCurrentAssets.other.Deposits' },

  // Capitalised borrowing costs: an asset, not property, plant & equipment.
  { pattern: /^(capitali[sz]ed )?borrowing costs?( capitali[sz]ed)?( at cost)?$/, sections: ASSET_SECTIONS, key: 'nonCurrentAssets.other.Borrowing costs' },

  // Fittings and equipment.
  {
    pattern: /^(less accumulated depreciation )?(shop fittings?|fixtures and fittings|furniture and fittings|furniture fixtures and fittings|plant and equipment|office equipment|office furniture and equipment|motor vehicles?|computer equipment|leasehold improvements)( at cost| at written down value| wdv| net)?$/,
    sections: ASSET_SECTIONS,
    key: 'nonCurrentAssets.propertyPlantEquipment',
  },

  // Appropriations: below the profit line.
  { pattern: /\bdistributions? (to|paid to) beneficiar|\bbeneficiar(y|ies) distributions?\b/, key: 'appropriations.distributions' },
  { pattern: /^dividends? (paid|provided|declared)\b/, key: 'appropriations.dividends' },
  // A profit figure AFTER prior-year losses is a subtotal, not a result to
  // keep: "ignore.*" keys are dropped (and clear a total the model put them in).
  { pattern: /\bafter deducting (prior years? )?loss|\bprofit after prior years? loss|\bafter prior years? loss/, key: 'ignore.profitAfterLosses' },
  // The loss amount itself.
  { pattern: /^(less )?prior years? loss(es)?( applied| recouped| deducted)?$|\blosses? brought forward\b|\bcarried forward loss/, key: 'appropriations.priorYearLossesApplied' },
]

/** The key this label always maps to, or null when the dictionary does not know it. */
export function dictionaryKey(rawLabel: string, section: LineSection): string | null {
  const label = normaliseLabel(rawLabel)
  for (const entry of DICTIONARY) {
    if (entry.sections && !entry.sections.includes(section)) continue
    if (entry.pattern.test(label)) return entry.key
  }
  return null
}

/** An income tax EXPENSE line (not a payable on the balance sheet). */
export function isIncomeTaxExpenseLabel(rawLabel: string): boolean {
  const label = normaliseLabel(rawLabel)
  if (/\bpayable\b|\bprovision for income tax payable\b/.test(label)) return false
  return /^(less )?(income tax( expense)?|tax expense|provision for (income )?tax|company tax)( expense)?\b/.test(label)
}

/** "Less prior year loss", "... AFTER DEDUCTING LOSS", losses brought forward. */
export function isPriorYearLossLabel(rawLabel: string): boolean {
  return /\bprior years? loss|\bafter deducting loss|\blosses? brought forward\b|\bcarried forward loss/.test(
    normaliseLabel(rawLabel),
  )
}
