/**
 * SYNTHETIC combined company statements — FY22, FY23, FY24, FY25.
 *
 * An invented company with invented figures, shaped like a real four-year run
 * of combined annual statements: the same quirks, none of a real client's
 * data. Each year adds up (gross profit plus interest and other revenue, less
 * expenses, is profit; assets less liabilities is net assets), and the story
 * the headlines tell is kept: sales growing, a small loss in the latest year
 * after two larger ones, net assets negative throughout, the ATO payables
 * block roughly in line with revenue while the ATO account line alone almost
 * triples, and director loans receivable growing from $0 to over 40% of assets.
 *
 * Treatments applied (matching the extractor's behaviour):
 *   • Director-loan receivables (e.g. "Loan 2020", "Loan - 2023") are mapped
 *     to nonCurrentAssets.directorRelatedLoansReceivable regardless of where
 *     the statement placed them. FY23 had them under Current Assets; we relocate.
 *   • "Less Unexpired Interest" lines are netted into their parent chattel /
 *     equipment-finance line. Stored figures are NET.
 *   • Negative-valued "Loan 20XX" lines under Non-Current Liabilities (FY22
 *     only) are recorded LITERALLY under nonCurrentLiabilities.other, not
 *     relocated to assets. FY22 director loans receivable = $0.
 */

import type { ExtractedFinancialStatement } from '../../types'

// ─── FY22 — year ended 30 June 2022 ──────────────────────────────────────────
export const COMPANY_FY22: ExtractedFinancialStatement = {
  financialYear: 2022,
  periodEndDate: '2022-06-30',
  sourceFilename: 'SYNTH_Company_FY22.pdf',
  sourceColumn: 'primary',
  incomeStatement: {
    income: {
      sales: 352410,
      interestIncome: 1280,
      otherRevenue: null,
    },
    cogs: {
      purchases: 81350,
      directCosts: null, // FY22 column shows "-"
    },
    expenses: {
      depreciation: 18600,
      motorVehicle: 28380,
      travelAndAccommodation: 1570,
      advertising: 125,
      bankFees: 195,
      consultingAndAccounting: 3240,
      entertainment: 1230,
      freightAndCourier: 58,
      generalExpenses: 37,
      hireOfPlantAndEquipment: 4120,
      insurance: 1750,
      interestExpense: 8550,
      officeExpenses: 849,
      printingAndStationery: 138,
      protectiveClothing: 807,
      subcontractors: 111094,
      subscriptions: 847,
      superannuation: 5320,
      telephoneAndInternet: 1220,
      tolls: 100,
      tools: 2700,
      wagesAndSalaries: 62300,
      directorFees: 6240,
    },
    totals: {
      totalIncome: 352410,
      totalCogs: 81350,
      grossProfit: 271060,
      totalExpenses: 259470,
      profitBeforeTax: 12870,
      netProfitAfterTax: 12870,
    },
  },
  balanceSheet: {
    currentAssets: {
      bankAccounts: 22610,
      accountsReceivable: 31450,
    },
    nonCurrentAssets: {
      propertyPlantEquipment: 165300,
      directorRelatedLoansReceivable: 0, // $0 on the asset side (FY22 had loans only as negative liabilities).
    },
    currentLiabilities: {
      gstPayable: 2410,
      taxation: -840, // printed "(840)" — a negative current liability
      superannuationPayable: 27950,
      atoLiability: 70080,
      paygWithholdingPayable: null,
    },
    nonCurrentLiabilities: {
      // Negative-valued "Loan 20XX" lines preserved literally. Treated as
      // miscellaneous non-current liabilities, not relocated to assets.
      other: -30150, // Loan 2019 (-7,890) + Loan 2020 (-22,260)
      // Chattel Mortgage - Truck 35,100 - 0 unexpired = 35,100
      // Loan - Mini Excavator 80,200 - 17,650 unexpired = 62,550
      // Loan - Tipper Truck 92,600 - 21,850 unexpired = 70,750
      chattelMortgages: 168400,
      // Vehicle Finance 20,150 - 1,310 unexpired = 18,840
      loansAndFinance: 18840,
    },
    equity: {
      retainedEarnings: -37330,
    },
    totals: {
      totalCurrentAssets: 54060,
      totalNonCurrentAssets: 165300,
      totalAssets: 219360,
      totalCurrentLiabilities: 99600,
      totalNonCurrentLiabilities: 157090,
      totalLiabilities: 256690,
      netAssets: -37330,
      totalEquity: -37330,
    },
  },
  rawExtraction: [],
  warnings: [],
}

// ─── FY23 — year ended 30 June 2023 ──────────────────────────────────────────
// This statement placed director-loan receivables ("Loan 2020", "Loan - 2023")
// under Current Assets. The extractor's "relocate to Non-Current Assets" rule
// applies; reflected here.
export const COMPANY_FY23: ExtractedFinancialStatement = {
  financialYear: 2023,
  periodEndDate: '2023-06-30',
  sourceFilename: 'SYNTH_Company_FY23.pdf',
  sourceColumn: 'primary',
  incomeStatement: {
    income: {
      sales: 728600,
      interestIncome: 540,
      otherRevenue: 96300,
    },
    cogs: {
      purchases: 268150,
    },
    expenses: {
      depreciation: 53200,
      motorVehicle: 49370,
      travelAndAccommodation: 1380,
      advertising: 65,
      bankFees: 166,
      consultingAndAccounting: 3410,
      entertainment: 5270,
      freightAndCourier: 24,
      generalExpenses: 3520,
      hireOfPlantAndEquipment: 10770,
      insurance: 990,
      interestExpense: 35090,
      lightPowerHeating: 78,
      officeExpenses: 887,
      printingAndStationery: 105,
      protectiveClothing: 7400,
      rent: 2180,
      subcontractors: 253628,
      subscriptions: 1450,
      superannuation: 9090,
      telephoneAndInternet: 1840,
      tolls: 107,
      tools: 5820,
      wagesAndSalaries: 96610,
      donations: 1130,
      directorFees: 16050,
    },
    totals: {
      totalIncome: 728600,
      totalCogs: 268150,
      grossProfit: 460450,
      totalExpenses: 559630,
      profitBeforeTax: -2340,
      netProfitAfterTax: -2340,
    },
  },
  balanceSheet: {
    currentAssets: {
      bankAccounts: 19880,
      accountsReceivable: 48170,
    },
    nonCurrentAssets: {
      propertyPlantEquipment: 247900,
      directorRelatedLoansReceivable: 61450, // Loan 2020 (15,620) + Loan - 2023 (45,830)
    },
    currentLiabilities: {
      gstPayable: 3220,
      superannuationPayable: 30940,
      atoLiability: 89350,
      // Vehicle Loan (40,880) less Unexpired Interest (7,870) = 33,010 — vehicle
      // finance under Current Liabilities goes to "other" per schema.
      other: 33010,
    },
    nonCurrentLiabilities: {
      // Chattel Mortgage 4WD 188,400 - 44,900 unexpired = 143,500
      // Loan - Mini Excavator 64,300 - 10,850 unexpired = 53,450
      // Loan - Tipper Truck 77,200 - 13,600 unexpired = 63,600
      chattelMortgages: 260550,
    },
    equity: {
      retainedEarnings: -39670,
    },
    totals: {
      totalCurrentAssets: 68050, // After relocating dir loans out
      totalNonCurrentAssets: 309350, // PP&E + relocated dir loans
      totalAssets: 377400,
      totalCurrentLiabilities: 156520,
      totalNonCurrentLiabilities: 260550,
      totalLiabilities: 417070,
      netAssets: -39670,
      totalEquity: -39670,
    },
  },
  rawExtraction: [],
  warnings: [],
}

// ─── FY24 — year ended 30 June 2024 ──────────────────────────────────────────
export const COMPANY_FY24: ExtractedFinancialStatement = {
  financialYear: 2024,
  periodEndDate: '2024-06-30',
  sourceFilename: 'SYNTH_Company_FY24.pdf',
  sourceColumn: 'primary',
  incomeStatement: {
    income: {
      sales: 781900,
      interestIncome: 2870,
      otherRevenue: null,
    },
    cogs: {
      purchases: 290400,
    },
    expenses: {
      depreciation: 74470,
      motorVehicle: 27480,
      travelAndAccommodation: 15260,
      advertising: 153,
      bankFees: 945,
      consultingAndAccounting: 3370,
      entertainment: 7270,
      generalExpenses: 9970,
      hireOfPlantAndEquipment: 10790,
      insurance: 360,
      interestExpense: 45860,
      lightPowerHeating: 92,
      officeExpenses: 7110,
      protectiveClothing: 3040,
      repairsAndMaintenance: 764,
      subcontractors: 181938,
      subscriptions: 1350,
      superannuation: 7980,
      telephoneAndInternet: 1450,
      tools: 15610,
      wagesAndSalaries: 86940,
      donations: 171,
      directorFees: 22600,
      finesNonDeductible: 657,
    },
    totals: {
      totalIncome: 781900,
      totalCogs: 290400,
      grossProfit: 491500,
      totalExpenses: 525630,
      profitBeforeTax: -31260,
      netProfitAfterTax: -31260,
    },
  },
  balanceSheet: {
    currentAssets: {
      bankAccounts: 17070,
      accountsReceivable: null,
    },
    nonCurrentAssets: {
      propertyPlantEquipment: 198300,
      directorRelatedLoansReceivable: 131860, // Loan 2020 (11,870) + Loan - 2023 (31,450) + Loan - 2024 (88,540)
    },
    currentLiabilities: {
      gstPayable: null,
      superannuationPayable: 34220,
      atoLiability: 141600,
      // Vehicle Loan 33,250 - Unexpired Interest 6,140 = 27,110
      other: 27110,
    },
    nonCurrentLiabilities: {
      // Chattel Mortgage 4WD 152,800 - 27,900 = 124,900
      // Loan - Mini Excavator 47,600 - 5,620 = 41,980
      // Loan - Tipper Truck 56,100 - 7,750 = 48,350
      chattelMortgages: 215230,
    },
    equity: {
      retainedEarnings: -70930,
    },
    totals: {
      totalCurrentAssets: 17070,
      totalNonCurrentAssets: 330160,
      totalAssets: 347230,
      totalCurrentLiabilities: 202930,
      totalNonCurrentLiabilities: 215230,
      totalLiabilities: 418160,
      netAssets: -70930,
      totalEquity: -70930,
    },
  },
  rawExtraction: [],
  warnings: [],
}

// ─── FY25 — year ended 30 June 2025 ──────────────────────────────────────────
// Three of four director loans now marked "(Quarantined)" — the prompt
// preserves the marker in rawExtraction for the UI flag.
export const COMPANY_FY25: ExtractedFinancialStatement = {
  financialYear: 2025,
  periodEndDate: '2025-06-30',
  sourceFilename: 'SYNTH_Company_FY25.pdf',
  sourceColumn: 'primary',
  incomeStatement: {
    income: {
      sales: 869300,
      interestIncome: null,
      otherRevenue: 610,
    },
    cogs: {
      purchases: 293800,
    },
    expenses: {
      depreciation: 47280,
      motorVehicle: 40120,
      travelAndAccommodation: 2440,
      advertising: 2560,
      bankFees: 547,
      consultingAndAccounting: 3530,
      entertainment: 7570,
      generalExpenses: 19810,
      hireOfPlantAndEquipment: 4750,
      insurance: 5160,
      interestExpense: 36590,
      lightPowerHeating: 353,
      officeExpenses: 3410,
      printingAndStationery: 1270,
      protectiveClothing: 5980,
      rent: 6780,
      repairsAndMaintenance: 2800,
      subcontractors: 241367,
      subscriptions: 437,
      superannuation: 9330,
      telephoneAndInternet: 798,
      tolls: 26,
      tools: 13300,
      wagesAndSalaries: 119840,
      donations: 271,
      trainingAndDevelopment: 61, // printed misspelt "Deverlopment" — prompt typo tolerance handles this
    },
    totals: {
      totalIncome: 869300,
      totalCogs: 293800,
      grossProfit: 575500,
      totalExpenses: 576380,
      profitBeforeTax: -270,
      netProfitAfterTax: -270,
    },
  },
  balanceSheet: {
    currentAssets: {
      bankAccounts: null, // FY25: business account became a Current Liability overdraft
      accountsReceivable: 64640,
    },
    nonCurrentAssets: {
      propertyPlantEquipment: 146500,
      // 11,870 + 31,450 + 88,540 + 24,100
      directorRelatedLoansReceivable: 155960,
    },
    currentLiabilities: {
      bankOverdraft: 4510,
      gstPayable: 6180,
      superannuationPayable: 33700,
      atoLiability: 204390,
    },
    nonCurrentLiabilities: {
      // Vehicle Loan 23,700 - 4,480 = 19,220
      // Chattel Mortgage 4WD 124,300 - 14,850 = 109,450
      // Loan - Mini Excavator 31,200 - 1,790 = 29,410
      // Loan - Tipper Truck 34,900 - 3,460 = 31,440
      chattelMortgages: 189520,
    },
    equity: {
      retainedEarnings: -71200,
    },
    totals: {
      totalCurrentAssets: 64640,
      totalNonCurrentAssets: 302460,
      totalAssets: 367100,
      totalCurrentLiabilities: 248780,
      totalNonCurrentLiabilities: 189520,
      totalLiabilities: 438300,
      netAssets: -71200,
      totalEquity: -71200,
    },
  },
  rawExtraction: [],
  warnings: [],
}

export const COMPANY_ALL = [COMPANY_FY22, COMPANY_FY23, COMPANY_FY24, COMPANY_FY25]
