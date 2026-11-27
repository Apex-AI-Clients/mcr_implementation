/**
 * Every prompt sent to Claude (openrouterClient.ts). No financial statement
 * is ever sent to a model: the figures in these prompts are the printed
 * figures staff confirmed, read by code (src/lib/printed).
 */

export const LABEL_SUGGESTION_PROMPT_TEMPLATE = `
You help match printed lines in an Australian business's financial statements to a few standard meanings. You see only each line's printed label and the headings it sits under. There are no figures.

For each meaning below, choose the line (or lines) that most likely is it, or none.
- Choose a line only when its label clearly matches the meaning. When unsure, choose none: staff will choose it themselves.
- A meaning marked "one line" takes at most one line. A meaning marked "several lines" may take several (they are added up).

MEANINGS:
{meanings}

PRINTED LINES (id, statement › headings › label):
{lines}

Respond with a single JSON object and nothing else, mapping each meaning key to a list of line ids, e.g. {"loan_payable": [12], "ato_debt": []}.
`.trim()

/**
 * The key-figure choice (item 9b; src/lib/ai/keyFigureChoice.ts): Claude
 * chooses the printed lines for the key figures. Labels and headings only,
 * names masked by role (maskLabels.ts), long digit strings and addresses
 * masked, no amounts, no file names. Our rules check every answer
 * (printed/keyFigureChoice.ts): an answer they do not agree with, or that
 * names a [person n], is only ever offered to staff as a possible line.
 */
export const KEY_FIGURE_CHOICE_PROMPT_TEMPLATE = `
You choose which printed lines of an Australian business's financial statements are each of a few key figures. You see each line's label and the section headings it sits under: no amounts.

Names are replaced: [client] is the business itself (or its trust), [director n] a director, [beneficiary n] a beneficiary of the trust, [related company n] a related company (such as the trustee company), [person n] someone else. The same placeholder is always the same person. [number] and [address] are masked.

KEY FIGURES:
{meanings}

LINES (id: statement › headings › label; "(total)" marks a printed total or subtotal):
{lines}

For every key figure, answer with exactly one of:
- {"lines": [ids], "reason": "..."}: the line, or lines, that are this figure. A figure marked "one line" takes exactly one.
- {"notPrinted": true, "reason": "..."}: no line is this figure.
- {"unclear": true, "lines": [ids you considered], "reason": "..."}: you cannot tell. Use this whenever you are not sure: staff will decide.
"reason" is one short plain-English sentence a bookkeeper would understand, using the labels as printed (with their placeholders).

Respond with ONE JSON object and nothing else, keyed by the figure keys above, e.g. {"net_profit": {"lines": [41], "reason": "The net profit line the profit and loss prints."}}. No markdown, no code fence.
`.trim()

export const LODGEMENT_SUMMARY_PROMPT_TEMPLATE = `
You are summarising an Australian ATO lodgement compliance analysis for a Small Business Restructure (SBR) practitioner. Write a clear, factual summary that a non-technical staff member can read in 20 seconds.

WRITING RULES:
- 3 to 5 sentences. Hard maximum: 90 words total.
- Use plain English. No jargon. No bullet points. No markdown.
- Cover three things in order: (1) compliance overview — how many BAS lodgements were late and over what period, (2) director penalty notices — use the figures exactly as given below and say where each comes from, (3) the ATO account — its lines and the ATO's balance, as given below.
- Never call anything a payment unless its line says "Payments". Amendments and remissions are reductions, not payments.
- Every dollar figure you write must be one of the figures below, or the difference between two of them.
- Do NOT recommend a course of action. Do NOT mention the SBR scheme by name.
- {bannedWordsInstruction}

FIGURES TO SUMMARISE (every one checked: the ATO account against the ATO's own running balance, the notices against their own arithmetic):
- Statement period: {periodStart} to {periodEnd}
- Total BAS lodgements filed late: {numberOfLateLodgements}
- Cumulative days late across all lodgements: {cumulativeDaysLate}
{dpnSection}
{accountSection}

Respond with the summary text only. No preamble, no headers, no quotes.
`.trim()

export const INCOME_TAX_SUMMARY_PROMPT_TEMPLATE = `
You are summarising an Australian company's ATO income tax account for a restructuring practitioner. Write a clear, factual summary that a non-technical staff member can read in 20 seconds.

WRITING RULES:
- 3 to 5 sentences. Hard maximum: 90 words total.
- Plain English. No jargon. No bullet points. No markdown.
- Cover, in order: (1) the balance owing and its date, (2) each assessment: its period, amount, when payment was due, and how long it has been unpaid, (3) payments received, (4) interest (GIC) charged and remitted.
- Never call anything a payment unless it is in "Payments received". Remissions and amendments are reductions, not payments.
- The export has no lodgement due dates: never say a return was lodged late.
- Do not mention director penalty notices.
- Every dollar figure you write must be one of the figures below, or the difference between two of them.
- Do NOT recommend a course of action. Do NOT mention the SBR scheme by name.
- {bannedWordsInstruction}

FIGURES TO SUMMARISE:
- Balance owing: {balance}
- Assessments (oldest first):
{assessments}
- Payments received: {payments}
- Interest (GIC): \${gicCharged} charged, \${gicRemitted} remitted or amended, \${gicNet} net

Respond with the summary text only. No preamble, no headers, no quotes.
`.trim()

export const SUPER_GUARANTEE_SUMMARY_PROMPT_TEMPLATE = `
You are summarising an Australian employer's ATO superannuation guarantee account for a restructuring practitioner. Write a clear, factual summary that a non-technical staff member can read in 20 seconds.

WRITING RULES:
- 3 to 5 sentences. Hard maximum: 90 words total.
- Plain English. No jargon. No bullet points. No markdown.
- Cover, in order: (1) the balance owing and its date, (2) the superannuation guarantee charge: how many quarters, the shortfall, nominal interest and administration fees, and how many quarters the ATO raised by audit or by default assessment, (3) Part 7 penalties charged and remitted, (4) interest (GIC) and payments received.
- Call a quarter's own statement an "SGC statement". Never say who lodged it: the account does not show that. Never write "lodged by the company".
- Never call anything a payment unless it is in "Payments received". Remissions and amendments are reductions, not payments.
- Do not mention director penalty notices.
- Every dollar figure you write must be one of the figures below, or the difference between two of them.
- Do NOT recommend a course of action. Do NOT mention the SBR scheme by name.
- {bannedWordsInstruction}

FIGURES TO SUMMARISE:
- Balance owing: {balance}
- Quarters with a superannuation guarantee charge: {quarters} ({firstQuarter} to {lastQuarter})
- SG shortfall: \${shortfall}; nominal interest: \${nominalInterest}; administration fees: \${adminFee}; together: \${sgTotal}
- Quarters with an ATO audit: {auditQuarters}; with an ATO default assessment: {defaultQuarters}; with a client amendment: {clientQuarters}
- Part 7 penalty: \${part7Charged} charged, \${part7Remitted} remitted, \${part7Net} net
- Interest (GIC): \${gicCharged} charged, \${gicNet} net
- Payments received: {payments}

Respond with the summary text only. No preamble, no headers, no quotes.
`.trim()

/**
 * The reading of a SCANNED statement page (src/lib/scan): the page image
 * only, transcribed, never interpreted. Each line names the section headings
 * it sits under, so the statement's structure never depends on reading
 * indents. {context} says which sections are still open from the page before
 * (a statement continued overleaf). The answer is checked against a strict
 * schema (scan/claudeReader.ts) and every printed total is checked to add up.
 */
export const SCAN_PAGE_PROMPT = `
You are transcribing one scanned page of an Australian accountant's financial statements. Transcribe exactly what is printed. Do not calculate, correct, round, rename, reorder or interpret anything.

If the page is not a profit and loss, trading statement, income statement, balance sheet or statement of financial position, answer {"title": null, "title_block": [], "columns": [], "rows": []}.

{context}

Otherwise answer with ONE JSON object and nothing else:
{
  "title": the statement title exactly as printed (e.g. "Profit & Loss Statement"); if the page continues a statement without printing its title, the title of the statement it continues,
  "title_block": the other lines printed with the title, top to bottom, exactly as printed (entity name, "For the year ended 30 June 2023", "As at 30 June 2023"),
  "columns": the headers of the amount columns, left to right, exactly as printed (e.g. ["2023", "2022"]); leave out a "Note"/"Notes" column and lines that only print "$",
  "rows": every printed line of the statement below the column headers, top to bottom, each as
    {"label": the label exactly as printed ("" if the line prints figures only),
     "section": the section headings this line sits under, outermost first, each exactly as printed (e.g. ["Liabilities", "Current Liabilities", "Chattel Mortgages - Current"]); [] for a line under no heading. A heading's own section is the headings above it. A total line ("Total Current Liabilities") sits in the section it totals.
     "amounts": one entry per column: the figure exactly as printed as a string ("1,580,706", "(4,168)", "-"), or null where nothing is printed,
     "top": where the line sits on the page, as a fraction of the page height from the top (0.0 to 1.0), to two decimals}
}

Rules:
- Include section headings (amounts all null), every line, every subtotal and total, in printed order.
- Results such as "Gross Profit", "Net Profit", "Net Assets", "Profit / (Loss) Before Distribution" sit under no heading ([]) unless printed inside one.
- Keep minus signs, brackets and "-" exactly as printed. Never add or drop digits, commas or cents.
- Leave out the page footer, page numbers, the accountant's notes and signatures.
- Output the JSON object only: no markdown, no code fence, no commentary.
`.trim()

/**
 * A window of an ATO account export that no known rule matches to the ATO's
 * own running balance (src/lib/ica/propose.ts). Claude proposes which rows
 * count; the proposal is used ONLY if the ATO's balance then matches to the
 * cent. The rows are anonymised: no client, ABN, TFN or file name; long
 * digit strings in descriptions masked. Approved verbally by Gabby, 16 Nov
 * 2026 (CLAUDE.md rule 12).
 */
export const ICA_WINDOW_PROMPT = `
You are reading rows from an Australian Taxation Office (ATO) account statement. Each row has a processed date, an effective date, a description, a debit (adds to the amount owed), a credit (reduces it) and sometimes the ATO's running balance after the row ("DR" = owed to the ATO, "CR" = in credit).

The ATO prints some amounts twice: a total row and rows that break it down (a payment and its allocations; a "General interest charge" total over the interest rows it sums; an activity statement row and its "- GST" / "- PAYG Withholding" sub-lines). Counting both counts the money twice. Other rows are separate amounts and all count.

The rows below are between two printed balances that the counted rows must connect exactly:
- balance before these rows: {before}
- balance after these rows must be: {after}
- within the rows, every printed balance should follow from the counted rows before it, as far as the ATO's printing order allows.

ROWS (id, processed, effective, description, debit, credit, balance):
{rows}

Decide which rows count so the balance changes by exactly {needed}. Answer with ONE JSON object and nothing else:
{"count": [ids of rows that count], "skip": [ids of rows that do not count], "explanation": "one or two sentences: which rows are totals of which, and why"}
Every id must be in exactly one list. Do not invent rows or amounts. Output the JSON object only: no markdown, no code fence.
`.trim()
