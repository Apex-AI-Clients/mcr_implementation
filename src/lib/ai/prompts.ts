/** OpenRouter model string for native PDF extraction. The leading "google/"
 *  is the OpenRouter prefix — required, not optional. */
export const OPENROUTER_EXTRACTION_MODEL = 'google/gemini-2.5-flash'

/** OpenRouter model string for narrative summaries. Same model — Gemini 2.5
 *  Flash handles both PDF + structured output and short prose generation
 *  well, no need to split tiers. */
export const OPENROUTER_NARRATIVE_MODEL = 'google/gemini-2.5-flash'

export const FINANCIALS_COMPARISON_SUMMARY_PROMPT_TEMPLATE = `
You are summarising a multi-year financial comparison for an Australian Small Business Restructure (SBR) practitioner. Write a clear, factual narrative that a non-technical staff member can scan in 30 seconds.

WRITING RULES:
- 4 to 6 sentences. Hard maximum: 140 words total.
- Plain English. No jargon. No markdown. No bullet points.
- Factual only. Do not invent figures or extrapolate beyond what the data shows.
- Do NOT recommend a course of action. Do NOT mention the SBR scheme by name.

WHAT TO COVER (use natural prose, not headers):
1. Revenue trajectory — direction and magnitude over the period.
2. Profitability — number of profitable years vs loss years, accumulated retained earnings position.
3. ATO debt trajectory — particularly whether it is growing FASTER than revenue (a critical SBR-suitability indicator). State the YoY trajectory explicitly.
4. Director / related-party loans receivable — note any material build-up, since this is the single strongest negative signal for ATO assessment.
5. Net asset position and what it implies for solvency.

If the latest ATO debt is more than 20% of latest revenue, flag this explicitly. If director loans receivable exceed 10% of total assets in the latest year, flag this explicitly.

FIGURES (multi-year — oldest to newest):
{yearByYearTable}

KEY DERIVED METRICS (latest year):
- ATO debt as % of revenue: {atoDebtPctRevenueLatest}
- Director loans as % of total assets: {directorLoansPctAssetsLatest}
- Net assets: \${netAssetsLatest}
- Cumulative net profit/(loss) over the {numYears} year period: \${cumulativeProfitLoss}

Respond with the summary paragraph only. No preamble, no headers, no quotes.
`.trim()

export const FINANCIALS_EXTRACTION_PROMPT = `
You are extracting structured data from an Australian SME's annual financial statement PDF (typically a Xero or MYOB report). The audience is an insolvency / Small Business Restructure practitioner who needs the figures classified into a strict canonical taxonomy.

CALL THE TOOL — DO NOT REPLY IN TEXT:
You MUST call the submit_extracted_financials tool with the structured data. Do not output a text reply. The tool's input_schema dictates the exact shape; the rules below dictate the SEMANTICS of which value goes under which canonical key.

KEY-NAMING CONVENTIONS:
- income, cogs, expenses, totals — keys under incomeStatement
- currentAssets, nonCurrentAssets, currentLiabilities, nonCurrentLiabilities, equity, totals — keys under balanceSheet
- Inside each, use the canonical key names listed in the sections below.
- For lines that don't fit any canonical key, bucket under that section's "other" key. Preserve the raw label in rawExtraction.

CANONICAL TOTALS KEYS:
- Income Statement totals: totalIncome, totalCogs, grossProfit, totalExpenses, profitBeforeTax, netProfitAfterTax
- Balance Sheet totals: totalCurrentAssets, totalNonCurrentAssets, totalAssets, totalCurrentLiabilities, totalNonCurrentLiabilities, totalLiabilities, netAssets, totalEquity

CANONICAL INCOME KEYS:
- income: sales, interestIncome, otherRevenue, other
- cogs: purchases, directCosts, other

CANONICAL BALANCE SHEET KEYS:
- currentAssets: bankAccounts, accountsReceivable, other
- nonCurrentAssets: propertyPlantEquipment, directorRelatedLoansReceivable, other
- currentLiabilities: bankOverdraft, gstPayable, paygWithholdingPayable, superannuationPayable, atoLiability, incomeTaxPayable, taxation, other
- nonCurrentLiabilities: chattelMortgages, loansAndFinance, directorRelatedLoansPayable, ownerDrawings, other
- equity: retainedEarnings, shareCapital, other

LABEL TYPO TOLERANCE:
- Minor spelling errors, capitalisation differences, punctuation variants, and missing hyphens in the PDF labels do NOT block mapping. Examples seen in real-world PDFs: "Training & Deverlopment" → trainingAndDevelopment; "Fines (non deductible)" → finesNonDeductible; "Motor vehicle" / "Motor Vehicle" → motorVehicle; "Wages and Salaries" / "Wages & Salaries" → wagesAndSalaries.
- Preserve the EXACT verbatim label in rawExtraction.rawLabel, but use the canonical key in the structured output.

CANONICAL EXPENSE KEYS (use these exact spellings; bucket anything not on this list as "other"):
  depreciation, motorVehicle, travelAndAccommodation, advertising, bankFees, consultingAndAccounting,
  entertainment, freightAndCourier, generalExpenses, hireOfPlantAndEquipment, insurance, interestExpense,
  lightPowerHeating, officeExpenses, printingAndStationery, protectiveClothing, rent, repairsAndMaintenance,
  subcontractors, subscriptions, superannuation, telephoneAndInternet, tolls, tools, wagesAndSalaries,
  donations, directorFees, finesNonDeductible, trainingAndDevelopment, other

WHERE TO LOOK IN THE PDF:
- Use ONLY the "Income Statement" and "Balance Sheet" sections of the Annual Financial Statements. Find them by their section heading — DO NOT anchor on a specific page number, because some PDFs begin with an accountant cover letter that shifts everything by a page or two.
- IGNORE: "Notes to the Financial Statements", "Appropriation Statement", "Directors Declaration", "Compilation Report", "Depreciation Schedule", and any appended "Company Tax Return" or worksheets. The tax return often shows DIFFERENT figures (e.g. excluding director-loan accounts from total assets) — those figures are not what we want.
- Some PDFs include the Company Tax Return bundled in (typically 10 extra pages at the end); some do not. Either case is fine — just use the AFS section.
- The two-column header on the Income Statement is years only (e.g. "2025  2024"). On the Balance Sheet it is dated (e.g. "30 JUN 2023  30 JUN 2022" or "30 JUNE 2024  30 JUNE 2023"). Accept BOTH "JUN" and "JUNE" date abbreviations.

DETECTING COLUMNS:
- Financial statements typically present two numerical columns headed by years (e.g. "2023  2022" on the income statement, or "30 JUN 2023  30 JUN 2022" on the balance sheet). Return ONE entry per column.
- The "primary" column is the year named in the heading ("For the year ended 30 June 2023" → primary financialYear: 2023). It is typically the LEFT-MOST numerical column.
- The "comparative" column is the year immediately prior (here: 2022). Map every line item to BOTH columns when both are present.
- If the PDF shows only one column (some templates strip comparatives, first-year companies have no prior), return one entry with sourceColumn: "primary".
- Never invent a comparative if the PDF doesn't show one.
- A blank value, "-", or "—" in one column with a number in the other means the line existed for one year only. Return the number for the year present, null for the year absent.

INCOME STATEMENT — "TOTAL INCOME" DISAMBIGUATION:
- Some templates show TWO subtotals labelled "Total Income". The FIRST occurrence (immediately after the Income section, before Cost of Goods Sold) is the true Total Income — use that for totals.totalIncome.
- The SECOND "Total Income" (after Cost of Goods Sold and Other Income, before Expenses) is a presentation subtotal equal to Sales − COGS + Other Income. Ignore this second value — do NOT overwrite totals.totalIncome with it.
- "Other Income" lines (Interest Income, Other Revenue, government stimulus) belong under income.interestIncome / income.otherRevenue even if the PDF places them in a separate "Other Income" block below COGS.

CURRENCY PARSING:
- Parentheses denote negative values: "(46,206)" → -46206. "(46,206.50)" → -46206.50.
- A plain dash "-", em-dash "—", or empty cell means the line was absent. Return null, not 0.
- Strip $, commas, and trailing decimals where appropriate. Preserve the sign.
- Numbers under a "Less: ..." sub-heading are stored as positive values (the "Less" is presentational).

DIRECTOR-LOAN CLASSIFICATION (load-bearing rule — gets this wrong and the SBR assessment is wrong):
- These are loans the company has made to (or owes) its directors/shareholders/owners. The ATO scrutinises them heavily.
- Discriminate by the label, NOT by which section the line sits under (small accountants frequently misplace director loans into Current Assets):
  • Labels like "Loan 2019", "Loan 2020", "Loan - 2023" (year-suffixed, no counterparty) → directorRelatedLoansReceivable (if under Assets) or directorRelatedLoansPayable (if under Liabilities). The year typically refers to when the loan was raised.
  • Labels containing "Director", "Shareholder", "Owner", "Owner Drawings", "Owner A", "Owner B" → director/related party.
  • Labels marked "(Quarantined)" — still classify as directorRelatedLoansReceivable. Preserve the word "Quarantined" in rawExtraction.rawLabel verbatim so the UI can flag it.
- DO NOT classify the following as director loans — these are chattel mortgages / equipment finance and belong under chattelMortgages or loansAndFinance:
  • "Loan - <Equipment Name>" where the equipment is a specific asset: "Loan - Hino Truck", "Loan - Mini Excavator", "Loan - VW", "Loan - Landcruiser". Bucket under chattelMortgages.
  • "Chattel Mortgage - <X>" → chattelMortgages.
  • "<X> Finance" (e.g. "VW Finance") → loansAndFinance.
- DO NOT classify as director loans either: any line that explicitly names a third-party bank or finance counterparty ("Loan to ABC Bank Pty Ltd", "Loan from Westpac", "Loan from CBA"). Bucket as "other" with the raw label preserved.
- If a director loan appears under Current Assets in the PDF (a common misclassification), still map it to nonCurrentAssets.directorRelatedLoansReceivable in your output — it belongs there economically regardless of the PDF's placement. Add a warning describing the relocation.

UNEXPIRED INTEREST NETTING:
- Lines named "Less Unexpired Interest - <Asset>", "Unexpired Interest", "Unearned Interest", or similar — these are presentation OFFSETS against a specific chattel-mortgage or equipment-finance principal line.
- Combine them into the parent line. The chattelMortgages / loansAndFinance value you return must be the NET figure (principal MINUS unexpired interest).
- Example: "Chattel Mortgage - Landcruiser Truck" 192,139 with "Less Unexpired Interest - Landcruiser Truck" (46,029) → net chattel mortgage contribution = 146,110. Then add to any other chattel mortgages on the books.
- Apply the same netting whether the principal and offset sit under Current Liabilities or Non-Current Liabilities. The current-vs-non-current split is preserved (the parent's section dictates where the net value lands).
- Preserve both the gross principal and the unexpired interest in rawExtraction so the netting is auditable.

CURRENT-LIABILITY EQUIPMENT FINANCE:
- A chattel-mortgage or vehicle-finance principal line that sits under Current Liabilities (the portion due within 12 months) — there is no canonical key for this under currentLiabilities. Bucket it under currentLiabilities.other with the raw label preserved verbatim. Net any Unexpired Interest sibling line before placing the value.

NEGATIVE-VALUED LOAN LINES UNDER NON-CURRENT LIABILITIES (FY22-style edge case):
- Some older balance sheets place director-loan accounts under Non-Current LIABILITIES with NEGATIVE values (e.g. "Loan 2019  (7,325)", "Loan 2020  (21,964)"). This is the same economic position as a positive asset, just displayed inversely.
- Record these literally as negative numbers under nonCurrentLiabilities.other with the raw label preserved verbatim. DO NOT relocate them to nonCurrentAssets.directorRelatedLoansReceivable, and DO NOT flip the sign. They will appear in the comparison view as a small negative item under "Other Non-Current Liabilities" — that is the desired behaviour.
- This rule applies ONLY when a "Loan 20XX" line shows a negative (parenthesised) value under Non-Current Liabilities. A positive "Loan 20XX" line under Non-Current Assets follows the normal director-loan classification rule above.

OTHER REVENUE:
- Map government stimulus (JobKeeper, Cash Flow Boost, Boosting Cash Flow for Employers), insurance recoveries, and one-off items to "otherRevenue".
- Always preserve the verbatim label in rawExtraction so downstream code can identify the specific item.

TOTALS:
- Always return the totals from the PDF even though they are calculable. These are the published totals; downstream reconciliation will compare them against the sum of returned line items.

RAW EXTRACTION SCOPE (critical — controls response size):
- rawExtraction is an OPTIONAL array. The default is an empty array. Only populate it when AUDIT VALUE OUTWEIGHS RESPONSE COST.
- ONLY include a rawExtraction entry when one of these is true and ONLY for that subset:
  • The line was bucketed under an "other" / uncategorised key — record so a human can audit the misclassification.
  • The line carried a "(Quarantined)" marker that the UI needs to preserve.
  • A director-loan or director-loan-payable line (positive or negative) — always record.
- DO NOT record routine lines under rawExtraction. Sales, Wages, Depreciation, Bank Fees, Total Assets, etc. all map cleanly and need no audit trail.
- DO NOT record "Unexpired Interest" netting pairs in rawExtraction. Instead, surface the gross principal in the line item's structured value (per the UNEXPIRED INTEREST NETTING rule); the netting is implicit and does not need a per-line audit entry.
- HARD CAP: 15 rawExtraction entries TOTAL across both columns of the PDF. If you would exceed 15, emit an empty array instead and add a single warning with kind "unmapped_line_item" describing the issue.
- The structured incomeStatement/balanceSheet output is the source of truth. rawExtraction is a debugging aid, not a complete log.

WARNINGS:
- Add a warnings entry for any line item that couldn't be confidently mapped (it goes in "other"; raw label preserved).
- Add a warning for any unparseable currency value.
- Do NOT fabricate. If the PDF doesn't show a particular total, set it to null and add a "missing_total" warning.

Call the submit_extracted_financials tool now with the structured extraction. Do not reply in text.
`.trim()

export const LODGEMENT_SUMMARY_PROMPT_TEMPLATE = `
You are summarising an Australian ATO lodgement compliance analysis for a Small Business Restructure (SBR) practitioner. Write a clear, factual summary that a non-technical staff member can read in 20 seconds.

WRITING RULES:
- 3 to 5 sentences. Hard maximum: 90 words total.
- Use plain English. No jargon. No bullet points. No markdown.
- Cover three things in order: (1) compliance overview — how many BAS lodgements were late and over what period, (2) DPN risk — the gross late debt, what was reversed, and the net at risk, (3) debt composition — the principal, interest, and penalty breakdown.
- If totalNetAtRisk is below $1,000, note that the DPN exposure appears to have been largely offset by reversals.
- If totalNetAtRisk is above $10,000, state it directly as a personal liability exposure for the director.
- Do NOT recommend a course of action. Do NOT mention the SBR scheme by name.

FIGURES TO SUMMARISE:
- Statement period: {periodStart} to {periodEnd}
- Total BAS lodgements filed late: {numberOfLateLodgements}
- Cumulative days late across all lodgements: {cumulativeDaysLate}
- Gross debt from lodgements filed >90 days late: \${totalGrossLate}
- Amount reversed by credits on those same late rows: \${totalReversed}
- Net DPN exposure remaining: \${totalNetAtRisk}
- Principal debt (net of amendments): \${principalNet}
- Interest / GIC (net of remissions): \${interestNet}
- Penalties (net): \${penaltyNet}
- Total payments received: \${paymentsReceived}

Respond with the summary text only. No preamble, no headers, no quotes.
`.trim()
