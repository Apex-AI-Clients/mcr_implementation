/**
 * PARKCON canonical fixtures — FY22, FY23, FY24, FY25.
 *
 * Anchored to the four real PARKCON PTY LTD Annual Financial Statement PDFs
 * (samples in sample pdf/). Headline figures (Sales, PBT, Total Income, Total
 * COGS, Total Expenses, the four ATO-related current liabilities, director-
 * loan receivables, Net Assets) are taken VERBATIM from the published reports.
 * Per-line expense splits are approximate — only the totals matter for the
 * comparison engine's headlines, ratios, and severity rules.
 *
 * Treatments applied (matching the extractor's behaviour):
 *   • Director-loan receivables (e.g. "Loan 2020", "Loan - 2023") are mapped
 *     to nonCurrentAssets.directorRelatedLoansReceivable regardless of where
 *     the PDF placed them. FY23 had them under Current Assets; we relocate.
 *   • "Less Unexpired Interest" lines are netted into their parent chattel /
 *     equipment-finance line. Stored figures are NET.
 *   • Negative-valued "Loan 20XX" lines under Non-Current Liabilities (FY22
 *     only) are recorded LITERALLY under nonCurrentLiabilities.other, not
 *     relocated to assets. Per spec narrative, FY22 dir-loans receivable = $0.
 *
 * If any PDF is reissued or re-extracted, replace these values verbatim.
 */

import type { ExtractedFinancialStatement } from '../../types'

// ─── FY22 — year ended 30 June 2022 ──────────────────────────────────────────
// Source: sample pdf/f5930747-b9ff-4561-a259-b4cf8edeb3ce.pdf
export const PARKCON_FY22: ExtractedFinancialStatement = {
  financialYear: 2022,
  periodEndDate: '2022-06-30',
  sourceFilename: 'PARKCON_FY22.pdf',
  sourceColumn: 'primary',
  incomeStatement: {
    income: {
      sales: 340856,
      interestIncome: 1746,
      otherRevenue: null,
    },
    cogs: {
      purchases: 78887,
      directCosts: null, // FY22 column shows "-"
    },
    expenses: {
      depreciation: 16462,
      motorVehicle: 31185,
      travelAndAccommodation: 1468,
      advertising: 134,
      bankFees: 176,
      consultingAndAccounting: 3636,
      entertainment: 1186,
      freightAndCourier: 60,
      generalExpenses: 33,
      hireOfPlantAndEquipment: 4506,
      insurance: 1640,
      interestExpense: 9190,
      officeExpenses: 765,
      printingAndStationery: 155,
      protectiveClothing: 776,
      subcontractors: 90123,
      subscriptions: 750,
      superannuation: 5850,
      telephoneAndInternet: 1142,
      tolls: 108,
      tools: 2431,
      wagesAndSalaries: 70000,
      directorFees: 6000,
    },
    totals: {
      totalIncome: 340856,
      totalCogs: 78887,
      grossProfit: 261969,
      totalExpenses: 247775,
      profitBeforeTax: 15940,
      netProfitAfterTax: 15940,
    },
  },
  balanceSheet: {
    currentAssets: {
      bankAccounts: 24042,
      accountsReceivable: 29330,
    },
    nonCurrentAssets: {
      propertyPlantEquipment: 159050,
      directorRelatedLoansReceivable: 0, // Spec narrative: $0 on the asset side (FY22 had loans only as negative liabilities).
    },
    currentLiabilities: {
      gstPayable: 2634,
      taxation: -916, // PDF shows "(916)" — a negative current liability
      superannuationPayable: 29098,
      atoLiability: 65432,
      paygWithholdingPayable: null,
    },
    nonCurrentLiabilities: {
      // Negative-valued "Loan 20XX" lines preserved literally per the
      // "Literal" treatment chosen in PDF review. Treated as miscellaneous
      // non-current liabilities, not relocated to assets.
      other: -29289, // Loan 2019 (-7,325) + Loan 2020 (-21,964)
      // Chattel Mortgage - Truck 33,635 - 0 unexpired = 33,635
      // Loan - Mini Excavator 82,789 - 18,192 unexpired = 64,597
      // Loan - Hino Truck 97,135 - 21,781 unexpired = 75,354
      chattelMortgages: 173586,
      // VW Finance 19,326 - 1,244 unexpired = 18,082
      loansAndFinance: 18082,
    },
    equity: {
      retainedEarnings: -46206,
    },
    totals: {
      totalCurrentAssets: 53372,
      totalNonCurrentAssets: 159050,
      totalAssets: 212422,
      totalCurrentLiabilities: 96249,
      totalNonCurrentLiabilities: 162378,
      totalLiabilities: 258627,
      netAssets: -46206,
      totalEquity: -46206,
    },
  },
  rawExtraction: [],
  warnings: [],
}

// ─── FY23 — year ended 30 June 2023 ──────────────────────────────────────────
// Source: sample pdf/3aa7217a-d2fb-4149-a837-b3085baaa50f.pdf
// Note: this PDF placed director-loan receivables ("Loan 2020", "Loan - 2023")
// under Current Assets. The extractor's "relocate to Non-Current Assets" rule
// applies; reflected here.
export const PARKCON_FY23: ExtractedFinancialStatement = {
  financialYear: 2023,
  periodEndDate: '2023-06-30',
  sourceFilename: 'PARKCON_FY23.pdf',
  sourceColumn: 'primary',
  incomeStatement: {
    income: {
      sales: 740148,
      interestIncome: 682,
      otherRevenue: 101120,
    },
    cogs: {
      purchases: 272799,
    },
    expenses: {
      depreciation: 58467,
      motorVehicle: 46138,
      travelAndAccommodation: 1489,
      advertising: 59,
      bankFees: 186,
      consultingAndAccounting: 3278,
      entertainment: 5485,
      freightAndCourier: 21,
      generalExpenses: 3859,
      hireOfPlantAndEquipment: 10061,
      insurance: 1060,
      interestExpense: 31615,
      lightPowerHeating: 88,
      officeExpenses: 853,
      printingAndStationery: 109,
      protectiveClothing: 6550,
      rent: 2400,
      subcontractors: 278856,
      subscriptions: 1560,
      superannuation: 8190,
      telephoneAndInternet: 2069,
      tolls: 103,
      tools: 6060,
      wagesAndSalaries: 85500,
      donations: 1245,
      directorFees: 15000,
    },
    totals: {
      totalIncome: 740148,
      totalCogs: 272799,
      grossProfit: 467349,
      totalExpenses: 570301,
      profitBeforeTax: -1152,
      netProfitAfterTax: -1152,
    },
  },
  balanceSheet: {
    currentAssets: {
      bankAccounts: 20730,
      accountsReceivable: 33023,
    },
    nonCurrentAssets: {
      propertyPlantEquipment: 260305,
      directorRelatedLoansReceivable: 58281, // Loan 2020 (14,971) + Loan - 2023 (43,310)
    },
    currentLiabilities: {
      gstPayable: 3003,
      superannuationPayable: 31788,
      atoLiability: 86817,
      // Loan - VW (39,765) less Unexpired Interest (7,481) = 32,284 — vehicle
      // finance under Current Liabilities goes to "other" per schema.
      other: 32284,
    },
    nonCurrentLiabilities: {
      // Chattel Mortgage Landcruiser 192,139 - 46,029 unexpired = 146,110
      // Loan - Mini Excavator 65,950 - 11,226 unexpired = 54,724
      // Loan - Hino Truck 78,965 - 13,997 unexpired = 64,968
      chattelMortgages: 265802,
    },
    equity: {
      retainedEarnings: -47357,
    },
    totals: {
      totalCurrentAssets: 53753, // After relocating dir loans out
      totalNonCurrentAssets: 318586, // PP&E + relocated dir loans
      totalAssets: 372339,
      totalCurrentLiabilities: 153894,
      totalNonCurrentLiabilities: 265802,
      totalLiabilities: 419696,
      netAssets: -47357,
      totalEquity: -47357,
    },
  },
  rawExtraction: [],
  warnings: [],
}

// ─── FY24 — year ended 30 June 2024 ──────────────────────────────────────────
// Source: sample pdf/e729e70a-b068-458f-bd17-47b8a6d61a0f.pdf
export const PARKCON_FY24: ExtractedFinancialStatement = {
  financialYear: 2024,
  periodEndDate: '2024-06-30',
  sourceFilename: 'PARKCON_FY24.pdf',
  sourceColumn: 'primary',
  incomeStatement: {
    income: {
      sales: 760405,
      interestIncome: 3166,
      otherRevenue: null,
    },
    cogs: {
      purchases: 282640,
    },
    expenses: {
      depreciation: 69599,
      motorVehicle: 29552,
      travelAndAccommodation: 13750,
      advertising: 172,
      bankFees: 909,
      consultingAndAccounting: 3510,
      entertainment: 6437,
      generalExpenses: 10956,
      hireOfPlantAndEquipment: 10085,
      insurance: 387,
      interestExpense: 41311,
      lightPowerHeating: 103,
      officeExpenses: 6832,
      protectiveClothing: 3171,
      repairsAndMaintenance: 676,
      subcontractors: 185139,
      subscriptions: 1260,
      superannuation: 8580,
      telephoneAndInternet: 1302,
      tools: 17536,
      wagesAndSalaries: 83600,
      donations: 178,
      directorFees: 20000,
      finesNonDeductible: 722,
    },
    totals: {
      totalIncome: 760405,
      totalCogs: 282640,
      grossProfit: 477765,
      totalExpenses: 515767,
      profitBeforeTax: -34836,
      netProfitAfterTax: -34836,
    },
  },
  balanceSheet: {
    currentAssets: {
      bankAccounts: 17837,
      accountsReceivable: null,
    },
    nonCurrentAssets: {
      propertyPlantEquipment: 190707,
      directorRelatedLoansReceivable: 125228, // Loan 2020 (11,228) + Loan - 2023 (30,218) + Loan - 2024 (83,782)
    },
    currentLiabilities: {
      gstPayable: null,
      superannuationPayable: 33068,
      atoLiability: 136028,
      // Loan - VW 32,091 - Unexpired Interest 5,906 = 26,185
      other: 26185,
    },
    nonCurrentLiabilities: {
      // Chattel Mortgage Landcruiser 156,283 - 28,552 = 127,731
      // Loan - Mini Excavator 49,112 - 5,794 = 43,318
      // Loan - Hino Truck 57,562 - 7,927 = 49,635
      chattelMortgages: 220684,
    },
    equity: {
      retainedEarnings: -82193,
    },
    totals: {
      totalCurrentAssets: 17837,
      totalNonCurrentAssets: 315935,
      totalAssets: 333772,
      totalCurrentLiabilities: 195282,
      totalNonCurrentLiabilities: 220684,
      totalLiabilities: 415966,
      netAssets: -82193,
      totalEquity: -82193,
    },
  },
  rawExtraction: [],
  warnings: [],
}

// ─── FY25 — year ended 30 June 2025 ──────────────────────────────────────────
// Source: sample pdf/9f7fc2a1-ecb8-4337-a7de-ff920891c482.pdf
// Three of four director loans now marked "(Quarantined)" — the prompt
// preserves the marker in rawExtraction for the UI flag.
export const PARKCON_FY25: ExtractedFinancialStatement = {
  financialYear: 2025,
  periodEndDate: '2025-06-30',
  sourceFilename: 'PARKCON_FY25.pdf',
  sourceColumn: 'primary',
  incomeStatement: {
    income: {
      sales: 851021,
      interestIncome: null,
      otherRevenue: 568,
    },
    cogs: {
      purchases: 286505,
    },
    expenses: {
      depreciation: 50835,
      motorVehicle: 36145,
      travelAndAccommodation: 2739,
      advertising: 2459,
      bankFees: 570,
      consultingAndAccounting: 3128,
      entertainment: 8321,
      generalExpenses: 18513,
      hireOfPlantAndEquipment: 5112,
      insurance: 4647,
      interestExpense: 41113,
      lightPowerHeating: 339,
      officeExpenses: 3553,
      printingAndStationery: 1123,
      protectiveClothing: 6570,
      rent: 6335,
      repairsAndMaintenance: 3009,
      subcontractors: 233484,
      subscriptions: 491,
      superannuation: 8970,
      telephoneAndInternet: 831,
      tolls: 23,
      tools: 14619,
      wagesAndSalaries: 112000,
      donations: 291,
      trainingAndDevelopment: 55, // PDF spells it "Deverlopment" — prompt typo tolerance handles this
    },
    totals: {
      totalIncome: 851021,
      totalCogs: 286505,
      grossProfit: 564516,
      totalExpenses: 565274,
      profitBeforeTax: -190,
      netProfitAfterTax: -190,
    },
  },
  balanceSheet: {
    currentAssets: {
      bankAccounts: null, // FY25: business account became a Current Liability overdraft
      accountsReceivable: 65607,
    },
    nonCurrentAssets: {
      propertyPlantEquipment: 139871,
      // 11,228 + 30,218 + 83,782 + 23,084
      directorRelatedLoansReceivable: 148312,
    },
    currentLiabilities: {
      bankOverdraft: 4268,
      gstPayable: 5964,
      superannuationPayable: 32438,
      atoLiability: 200422,
    },
    nonCurrentLiabilities: {
      // Loan - VW 22,983 - 4,331 = 18,652
      // Chattel Mortgage Landcruiser 127,147 - 15,228 = 111,919
      // Loan - Mini Excavator 32,088 - 1,896 = 30,192
      // Loan - Hino Truck 35,890 - 3,571 = 32,319
      chattelMortgages: 193082,
    },
    equity: {
      retainedEarnings: -82383,
    },
    totals: {
      totalCurrentAssets: 65607,
      totalNonCurrentAssets: 288185,
      totalAssets: 353792,
      totalCurrentLiabilities: 243093,
      totalNonCurrentLiabilities: 193082,
      totalLiabilities: 436175,
      netAssets: -82383,
      totalEquity: -82383,
    },
  },
  rawExtraction: [],
  warnings: [],
}

export const PARKCON_ALL = [PARKCON_FY22, PARKCON_FY23, PARKCON_FY24, PARKCON_FY25]
