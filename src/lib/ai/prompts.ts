export const CLAUDE_MODEL = 'claude-sonnet-4-6'

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
