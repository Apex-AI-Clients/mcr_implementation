/**
 * Every prompt sent to Claude (openrouterClient.ts). No financial statement
 * is ever sent to a model: the figures in these prompts are the printed
 * figures staff confirmed, read by code (src/lib/printed).
 */

export const COMPARISON_SUMMARY_PROMPT_TEMPLATE = `
You are summarising a multi-year comparison of a business's financial statements for an Australian restructuring practitioner. Write a clear, factual summary that a non-technical staff member can read in 30 seconds.

WRITING RULES:
- 4 to 6 sentences. Hard maximum: 140 words total.
- Plain English. No jargon. No markdown. No bullet points.
- Every dollar figure you write must be one of the figures below, or the difference between two of them. Do not add figures together, do not average them, and do not work out percentages.
- Use only the figures below. If a figure is not listed for a year, do not mention it for that year.
- A "current period" is part of a year only: never compare it with a full year as if it were one.
- Do NOT recommend a course of action. Do NOT mention the SBR scheme by name.
- {bannedWordsInstruction}

WHAT TO COVER (natural prose, not headers), using only the figures given:
1. Revenue over the years: direction and size.
2. Net profit or loss each year.
3. ATO-related debt and income tax payable over the years, and whether ATO-related debt is growing while revenue falls or holds.
4. The loan accounts with the director or related parties: any build-up of money owed to the company, or owed by it.
5. Net assets: the figures only, with no conclusion about the business.

FIGURES, AS PRINTED IN THE STATEMENTS (oldest first):
{figuresTable}
{notPrinted}
Respond with the summary paragraph only. No preamble, no headers, no quotes.
`.trim()

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

export const LODGEMENT_SUMMARY_PROMPT_TEMPLATE = `
You are summarising an Australian ATO lodgement compliance analysis for a Small Business Restructure (SBR) practitioner. Write a clear, factual summary that a non-technical staff member can read in 20 seconds.

WRITING RULES:
- 3 to 5 sentences. Hard maximum: 90 words total.
- Use plain English. No jargon. No bullet points. No markdown.
- Cover three things in order: (1) compliance overview — how many BAS lodgements were late and over what period, (2) director penalty notices — use the DPN figures exactly as given below, and say where they come from, (3) debt composition — the principal, interest, penalty and ATO audit breakdown, and payments.
- Never call anything a payment unless it is in "Payments received". Amendments that reduce a debt are reductions, not payments.
- Every dollar figure you write must be one of the figures below, or the difference between two of them.
- Do NOT recommend a course of action. Do NOT mention the SBR scheme by name.
- {bannedWordsInstruction}

FIGURES TO SUMMARISE:
- Statement period: {periodStart} to {periodEnd}
- Total BAS lodgements filed late: {numberOfLateLodgements}
- Cumulative days late across all lodgements: {cumulativeDaysLate}
{dpnSection}
- Principal debt (net of amendments): \${principalNet}
- Interest / GIC (net of remissions): \${interestNet}
- Penalties (net): \${penaltyNet}
- ATO audit amendments (raised by the ATO): \${auditNet}
- Payments received: {paymentsReceived}

Respond with the summary text only. No preamble, no headers, no quotes.
`.trim()
