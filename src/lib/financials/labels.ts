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

/** Words that make a loan a third party's, not a person's. */
const LENDER_WORDS =
  /\b(bank|finance|financial|westpac|nab|anz|cba|commonwealth|macquarie|st george|stgeorge|bendigo|suncorp|amex|pepper|latitude|ato|tax|insurance|premium|chattel|mortgage|hire purchase|lease|equipment|vehicle|car|truck|ute|van|excavator|machinery|plant|business|credit|card|overdraft|line of credit|government|council)\b/

/**
 * A loan the label ties to a person: "Loan - Jane Citizen", "Loan J Smith",
 * "Director Loan", "Shareholder loan", "Loan 2020". Not a bank or an asset
 * finance loan.
 */
export function isPersonLoanLabel(normalised: string): boolean {
  if (!/\bloans?\b/.test(normalised)) return false
  if (LENDER_WORDS.test(normalised)) return false
  if (/\b(director|directors|shareholder|shareholders|owner|related party|beneficiary)\b/.test(normalised)) return true
  // Year-suffixed, no counterparty: "loan 2020", "loan 2023".
  if (/^loans? (20\d{2})$/.test(normalised)) return true
  // "loan <name>" / "<name> loan": one or two words that are not loan words.
  const rest = normalised.replace(/\bloans?\b/, '').replace(/\b(to|from|account|a c)\b/g, '').trim()
  return /^[a-z]+( [a-z]+){0,2}$/.test(rest) && rest.length >= 2
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
  { pattern: /^(less )?opening (stock|inventory)( on hand)?$|^stock on hand at (the )?(beginning|start)/, key: 'cogs.openingStock' },
  { pattern: /^(less )?closing (stock|inventory)( on hand)?$|^stock on hand at (the )?end/, key: 'cogs.closingStock' },

  // Bonds and deposits: never property, plant & equipment.
  { pattern: /^((rental|rent|lease|security|shop|premises) )?(bond|bonds|deposit|deposits)( (paid|held|rent|lodged))?$|^bond rent$/, sections: ASSET_SECTIONS, key: 'nonCurrentAssets.other.Deposits' },

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
  if (LIABILITY_SECTIONS.includes(section) && isPersonLoanLabel(label)) {
    return 'nonCurrentLiabilities.directorRelatedLoansPayable'
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
