/**
 * Canonical taxonomy for Australian SME financial statements.
 *
 * Accountant-prepared PDFs use varying label spellings. The extractor maps each
 * raw label into one of these canonical keys. Items that cannot be mapped get
 * bucketed under each category's `other` slot but the raw label is preserved
 * in `raw_extraction` for audit.
 */

export const INCOME_STATEMENT_SCHEMA = {
  income: {
    sales: 'Sales',
    interestIncome: 'Interest Income',
    otherRevenue: 'Other Revenue',
    other: 'Other Income (uncategorised)',
  },
  cogs: {
    purchases: 'Purchases',
    directCosts: 'Direct Costs',
    other: 'Other COGS (uncategorised)',
  },
  expenses: {
    depreciation: 'Depreciation',
    motorVehicle: 'Motor Vehicle',
    travelAndAccommodation: 'Travel & Accommodation',
    advertising: 'Advertising',
    bankFees: 'Bank Fees',
    consultingAndAccounting: 'Consulting & Accounting',
    entertainment: 'Entertainment',
    freightAndCourier: 'Freight & Courier',
    generalExpenses: 'General Expenses',
    hireOfPlantAndEquipment: 'Hire of Plant & Equipment',
    insurance: 'Insurance',
    interestExpense: 'Interest Expense',
    lightPowerHeating: 'Light, Power, Heating',
    officeExpenses: 'Office Expenses',
    printingAndStationery: 'Printing & Stationery',
    protectiveClothing: 'Protective Clothing',
    rent: 'Rent',
    repairsAndMaintenance: 'Repairs & Maintenance',
    subcontractors: 'Subcontractors',
    subscriptions: 'Subscriptions',
    superannuation: 'Superannuation',
    telephoneAndInternet: 'Telephone & Internet',
    tolls: 'Tolls',
    tools: 'Tools',
    wagesAndSalaries: 'Wages & Salaries',
    donations: 'Donations',
    directorFees: 'Director Fees',
    finesNonDeductible: 'Fines (non-deductible)',
    trainingAndDevelopment: 'Training & Development',
    other: 'Other Expenses (uncategorised)',
  },
  totals: {
    totalIncome: 'Total Income',
    totalCogs: 'Total Cost of Goods Sold',
    grossProfit: 'Gross Profit',
    totalExpenses: 'Total Expenses',
    profitBeforeTax: 'Profit / (Loss) before Taxation',
    netProfitAfterTax: 'Net Profit After Tax',
  },
} as const

export const BALANCE_SHEET_SCHEMA = {
  currentAssets: {
    bankAccounts: 'Bank Accounts',
    accountsReceivable: 'Accounts Receivable',
    other: 'Other Current Assets (uncategorised)',
  },
  nonCurrentAssets: {
    propertyPlantEquipment: 'Property, Plant & Equipment (net)',
    // Director / related-party loans receivable — flagged separately because
    // this is the single strongest negative signal for ATO SBR assessment.
    directorRelatedLoansReceivable: 'Director/Related Party Loans Receivable',
    other: 'Other Non-Current Assets (uncategorised)',
  },
  currentLiabilities: {
    bankOverdraft: 'Bank Overdraft',
    gstPayable: 'GST Payable',
    paygWithholdingPayable: 'PAYG Withholding Payable',
    superannuationPayable: 'Superannuation Payable',
    atoLiability: 'ATO Liability (Activity Statement Account)',
    incomeTaxPayable: 'Income Tax Payable',
    taxation: 'Taxation',
    other: 'Other Current Liabilities (uncategorised)',
  },
  nonCurrentLiabilities: {
    chattelMortgages: 'Chattel Mortgages (net of unexpired interest)',
    loansAndFinance: 'Loans & Finance (net of unexpired interest)',
    directorRelatedLoansPayable: 'Director/Related Party Loans Payable',
    ownerDrawings: 'Owner Drawings',
    other: 'Other Non-Current Liabilities (uncategorised)',
  },
  equity: {
    retainedEarnings: 'Retained Earnings',
    shareCapital: 'Share Capital',
    other: 'Other Equity (uncategorised)',
  },
  totals: {
    totalCurrentAssets: 'Total Current Assets',
    totalNonCurrentAssets: 'Total Non-Current Assets',
    totalAssets: 'Total Assets',
    totalCurrentLiabilities: 'Total Current Liabilities',
    totalNonCurrentLiabilities: 'Total Non-Current Liabilities',
    totalLiabilities: 'Total Liabilities',
    netAssets: 'Net Assets',
    totalEquity: 'Total Equity',
  },
} as const

export type IncomeStatementCategory = Exclude<keyof typeof INCOME_STATEMENT_SCHEMA, 'totals'>
export type BalanceSheetCategory = Exclude<keyof typeof BALANCE_SHEET_SCHEMA, 'totals'>

export type IncomeStatementLineKey<C extends IncomeStatementCategory = IncomeStatementCategory> =
  keyof (typeof INCOME_STATEMENT_SCHEMA)[C]
export type BalanceSheetLineKey<C extends BalanceSheetCategory = BalanceSheetCategory> =
  keyof (typeof BALANCE_SHEET_SCHEMA)[C]

export type IncomeStatementTotalKey = keyof typeof INCOME_STATEMENT_SCHEMA.totals
export type BalanceSheetTotalKey = keyof typeof BALANCE_SHEET_SCHEMA.totals

/**
 * Aggregated ATO-related current liabilities. Used both in headline severity
 * computation and in the balance sheet comparison view where the four lines
 * are grouped behind a red highlight block.
 */
export const ATO_LIABILITY_KEYS = [
  'atoLiability',
  'gstPayable',
  'paygWithholdingPayable',
  'superannuationPayable',
] as const

export type AtoLiabilityKey = (typeof ATO_LIABILITY_KEYS)[number]
