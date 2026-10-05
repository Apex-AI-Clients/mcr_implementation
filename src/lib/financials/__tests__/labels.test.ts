import { describe, it, expect } from 'vitest'
import {
  dictionaryKey,
  isIncomeTaxExpenseLabel,
  isPersonLoanLabel,
  isPriorYearLossLabel,
  normaliseLabel,
} from '../labels'

/** Label normalisation and the label -> key dictionary. Synthetic labels. */

describe('normaliseLabel', () => {
  it.each([
    ['Furniture & Fittings', 'furniture and fittings'],
    ['TOTAL CURRENT ASSESTS', 'total current assets'],
    ['Total Liabilites', 'total liabilities'],
    ['Repairs & Maintainance', 'repairs and maintenance'],
    ['  Bond   (Rent) ', 'bond rent'],
  ])('%s -> %s', (raw, normalised) => {
    expect(normaliseLabel(raw)).toBe(normalised)
  })
})

describe('dictionaryKey', () => {
  it.each([
    ['Shop Fittings', 'nonCurrentAssets', 'nonCurrentAssets.propertyPlantEquipment'],
    ['Fixtures & Fittings', 'nonCurrentAssets', 'nonCurrentAssets.propertyPlantEquipment'],
    ['Plant & Equipment at cost', 'nonCurrentAssets', 'nonCurrentAssets.propertyPlantEquipment'],
    ['Bond', 'currentAssets', 'nonCurrentAssets.other.Deposits'],
    ['Rental Bond', 'nonCurrentAssets', 'nonCurrentAssets.other.Deposits'],
    ['Bond Rent', 'nonCurrentAssets', 'nonCurrentAssets.other.Deposits'],
    ['Deposits', 'currentAssets', 'nonCurrentAssets.other.Deposits'],
    ['Opening Stock', 'cogs', 'cogs.openingStock'],
    ['Less Closing Stock', 'cogs', 'cogs.closingStock'],
    ['Distribution to Beneficiaries', 'appropriation', 'appropriations.distributions'],
    ['Less Prior Year Loss', 'appropriation', 'appropriations.priorYearLossesApplied'],
    ['NET TRADING PROFIT/(LOSS) AFTER DEDUCTING LOSS', 'incomeTotals', 'ignore.profitAfterLosses'],
    ['Profit after prior year losses', 'incomeTotals', 'ignore.profitAfterLosses'],
    ['Loan - Jane Citizen', 'nonCurrentLiabilities', 'nonCurrentLiabilities.directorRelatedLoansPayable'],
    ['Director Loan', 'currentLiabilities', 'nonCurrentLiabilities.directorRelatedLoansPayable'],
    ['Loan 2020', 'nonCurrentLiabilities', 'nonCurrentLiabilities.directorRelatedLoansPayable'],
  ] as const)('%s under %s -> %s', (label, section, key) => {
    expect(dictionaryKey(label, section)).toBe(key)
  })

  it.each([
    ['Loan - Westpac', 'nonCurrentLiabilities'],
    ['Loan - Hino Truck', 'nonCurrentLiabilities'],
    ['Chattel Mortgage - Ute', 'nonCurrentLiabilities'],
    ['Bond', 'currentLiabilities'], // a bond HELD is a liability, not a deposit asset
    ['Sales', 'income'],
    ['Rent', 'expenses'],
  ] as const)('leaves %s under %s to the model', (label, section) => {
    expect(dictionaryKey(label, section)).toBeNull()
  })
})

describe('label tests', () => {
  it('tells a person loan from a lender loan', () => {
    expect(isPersonLoanLabel(normaliseLabel('Loan J Smith'))).toBe(true)
    expect(isPersonLoanLabel(normaliseLabel('Shareholder Loan Account'))).toBe(true)
    expect(isPersonLoanLabel(normaliseLabel('Business Loan - ANZ'))).toBe(false)
    expect(isPersonLoanLabel(normaliseLabel('Premium Funding Loan'))).toBe(false)
  })

  it('knows an income tax expense line from a tax payable', () => {
    expect(isIncomeTaxExpenseLabel('Income Tax Expense')).toBe(true)
    expect(isIncomeTaxExpenseLabel('Less: Income tax')).toBe(true)
    expect(isIncomeTaxExpenseLabel('Income Tax Payable')).toBe(false)
  })

  it('recognises prior-year loss lines', () => {
    expect(isPriorYearLossLabel('Less Prior Year Loss')).toBe(true)
    expect(isPriorYearLossLabel('Profit after prior year losses')).toBe(true)
    expect(isPriorYearLossLabel('Net Profit')).toBe(false)
  })
})
