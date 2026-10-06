import { describe, it, expect } from 'vitest'
import {
  classifyLoan,
  dictionaryKey,
  isIncomeTaxExpenseLabel,
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
    ['Inventories', 'currentAssets', 'currentAssets.inventories'],
    ['Stock on hand', 'currentAssets', 'currentAssets.inventories'],
    ['Closing Stock', 'currentAssets', 'currentAssets.inventories'], // under assets it is the stock held
    ['Borrowing Cost', 'nonCurrentAssets', 'nonCurrentAssets.other.Borrowing costs'],
    ['Borrowing Costs', 'currentAssets', 'nonCurrentAssets.other.Borrowing costs'],
    ['Amortisation', 'expenses', 'expenses.depreciation'],
    ['MV Expense', 'expenses', 'expenses.motorVehicle'],
    ['Business Insurance', 'expenses', 'expenses.insurance'],
    ['Work Cover', 'expenses', 'expenses.insurance'],
    ['WorkCover', 'expenses', 'expenses.insurance'],
    ['License/Registration', 'expenses', 'expenses.generalExpenses'],
    ['Outgoings', 'expenses', 'expenses.rent'],
    ['Merchant Fee', 'expenses', 'expenses.bankFees'],
    ['Bank Charges', 'expenses', 'expenses.bankFees'],
    ['Waste cleaning', 'expenses', 'expenses.generalExpenses'],
    ['ASIC fees', 'expenses', 'expenses.generalExpenses'],
    ['GST account', 'currentLiabilities', 'currentLiabilities.gstPayable'],
    ['Amortisation of borrowing costs', 'expenses', 'expenses.depreciation'],
    ['Depreciation & Amortisation', 'expenses', 'expenses.depreciation'],
    ['Less Closing Stock', 'cogs', 'cogs.closingStock'],
    ['Distribution to Beneficiaries', 'appropriation', 'appropriations.distributions'],
    ['Less Prior Year Loss', 'appropriation', 'appropriations.priorYearLossesApplied'],
    ['NET TRADING PROFIT/(LOSS) AFTER DEDUCTING LOSS', 'incomeTotals', 'ignore.profitAfterLosses'],
    ['Profit after prior year losses', 'incomeTotals', 'ignore.profitAfterLosses'],
  ] as const)('%s under %s -> %s', (label, section, key) => {
    expect(dictionaryKey(label, section)).toBe(key)
  })

  it.each([
    ['Loan - Westpac', 'nonCurrentLiabilities'],
    ['Loan - Hino Truck', 'nonCurrentLiabilities'],
    ['Loan - Jane Citizen', 'nonCurrentLiabilities'], // loans are classified by classifyLoan, not the dictionary
    ['Chattel Mortgage - Ute', 'nonCurrentLiabilities'],
    ['Bond', 'currentLiabilities'], // a bond HELD is a liability, not a deposit asset
    ['Sales', 'income'],
    ['Rent', 'expenses'],
  ] as const)('leaves %s under %s to the model', (label, section) => {
    expect(dictionaryKey(label, section)).toBeNull()
  })
})

describe('classifyLoan', () => {
  // Names below are invented. The shapes are the real ones.
  const DIRECTORS = ['Anh Bao Citizen']

  it.each([
    // PARKCON-style vehicle and equipment finance.
    ['Loan - VW', 'lender_asset'],
    ['Loan - Hino Truck', 'lender_asset'],
    ['Loan - Mini Excavator', 'lender_asset'],
    ['Loan - Audi', 'lender_asset'],
    ['Loan - T Cross', 'lender_asset'],
    ['Loan - Van', 'lender_asset'],
    // Finance businesses ("Name Loan - Name" with a lender word).
    ['Business Loan - Ondesk', 'lender'],
    ['Car Loan - Getcapital', 'lender_asset'],
    ['Loan - Getcapital', 'lender'],
    ['Loan - Sample Finance Pty Ltd', 'lender'],
    ['Loan - Westpac', 'lender'],
  ] as const)('%s -> %s', (label, expected) => {
    expect(classifyLoan(label, DIRECTORS)).toBe(expected)
  })

  it('makes "Loan - <three names>" director-related only when it matches a director on file', () => {
    expect(classifyLoan('Loan - Anh Bao Citizen', DIRECTORS)).toBe('director')
    // Any order, any case, a middle name missing.
    expect(classifyLoan('Loan - CITIZEN Anh', DIRECTORS)).toBe('director')
    // No matching director: never assumed.
    expect(classifyLoan('Loan - Minh Van Sample', DIRECTORS)).toBe('unconfirmed')
    expect(classifyLoan('Loan - Anh Bao Citizen', [])).toBe('unconfirmed')
  })

  it('does not read "Van" in a name as a vehicle', () => {
    expect(classifyLoan('Loan - Van Nguyen', [])).toBe('unconfirmed')
    expect(classifyLoan('Loan - Van Nguyen', ['Van Nguyen'])).toBe('director')
  })

  it('takes an explicit "director" or "shareholder" at its word', () => {
    expect(classifyLoan('Director Loan', [])).toBe('director')
    expect(classifyLoan('Shareholder Loan Account', [])).toBe('director')
  })

  it('leaves non-loans and year-suffixed loans to the extraction rules', () => {
    expect(classifyLoan('Sales', [])).toBeNull()
    expect(classifyLoan('Loan 2020', [])).toBeNull()
  })
})

describe('label tests', () => {
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
