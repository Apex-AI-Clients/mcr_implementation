/**
 * Which composition line a row belongs to, from its description ONLY when the
 * description is the ATO's known wording for that line (every pattern below
 * was taken from real ATO exports, 17 Nov 2026). Anything else is not
 * guessed: it becomes its own line under its exact ATO description
 * (compose.ts), never merged into a named line, never hidden, never called
 * "unexplained".
 *
 * Gabby's layout:
 *   Balance brought forward
 *   + tax lodged (GST, PAYG withholding, each other tax its own line)
 *   + interest (GIC) − remitted
 *   + penalties − remitted
 *   = ATO debt
 *   − payments − government credits − other credits + refunds paid out
 *   = the ATO's balance
 */

export type Section = 'tax' | 'interest' | 'penalties' | 'payments' | 'credits' | 'refunds' | 'other'

export interface LineIdentity {
  /** Stable key: a named line's key, or "ato:" + the ATO wording. */
  key: string
  /** A named line's name, or the ATO's own wording. */
  label: string
  section: Section
  /** True for a line named by us from known wording; false when the label is the ATO's description itself. */
  named: boolean
}

const named = (key: string, label: string, section: Section): LineIdentity => ({ key, label, section, named: true })

/** Strips "for the period …" so one line holds every period of the same wording. */
export function wordingOf(description: string): string {
  return description
    .replace(/^'/, '')
    .replace(/\s+for (the )?period\b.*$/i, '')
    .replace(/\s+calculated from \d.*$/i, '')
    .trim()
}

/** A tax line of the ATO's own wording ("Fuel Tax Credit", "Tax return Companies - Income Tax"). */
const taxLine = (wording: string): LineIdentity => ({ key: `tax:${wording.toLowerCase()}`, label: wording, section: 'tax', named: false })

const KNOWN: [RegExp, (d: string) => LineIdentity][] = [
  // Tax lodged: the sub-lines of a statement, and tax raised without one.
  [/^- GST$/i, () => named('gst', 'GST lodged', 'tax')],
  [/^- PAYG Withholding$/i, () => named('paygw', 'PAYG withholding lodged', 'tax')],
  [/^PAYG Withholding \(STP Reported\) for period ending /i, () => named('paygw', 'PAYG withholding lodged', 'tax')],
  // Any other sub-line is a tax type of its own, in the ATO's words ("Fuel Tax Credit", "PAYG Instalments").
  [/^- \S/, (d) => taxLine(d.replace(/^- /, '').trim())],
  // A statement row whose amount is not split into sub-lines, in its own words.
  [/^(Original|Client initiated amended|ATO initiated amended|Tax Office audit amended|Default) (Activity Statement|SGC Statement)\b/i, (d) => taxLine(wordingOf(d))],
  [/^SGC Statement \(Liability\) - /i, (d) => taxLine(wordingOf(d))],
  [/^Tax return .+ - Income Tax for the period/i, (d) => taxLine(wordingOf(d))],

  // Interest: charged (and amended), and remitted.
  [/^Remission of general interest charge( concessional)?$/i, () => named('gicRemitted', 'General interest charge remitted', 'interest')],
  [/^(Concessional )?general interest charge \(GIC\) remission adjustment due to GIC amendment$/i, () => named('gicRemitted', 'General interest charge remitted', 'interest')],
  [/^Concessional general interest charge$/i, () => named('gicRemitted', 'General interest charge remitted', 'interest')],
  [/^(Amended )?general interest charge( \(GIC\))?( calculated from \d.*)?$/i, () => named('gic', 'General interest charge (GIC)', 'interest')],

  // Penalties: charged, and remitted.
  [/^Remission of penalty for failure to lodge /i, () => named('penaltiesRemitted', 'Penalties remitted', 'penalties')],
  [/^SG Part \d+ penalty - remission$/i, () => named('penaltiesRemitted', 'Penalties remitted', 'penalties')],
  [/^Penalty for failure to lodge /i, () => named('penalties', 'Penalties', 'penalties')],
  [/^SG Part \d+ penalty$/i, () => named('penalties', 'Penalties', 'penalties')],

  // Money in and out.
  [/^Payment( received)?$/i, () => named('payments', 'Payments', 'payments')],
  [/^Original Cash Flow Boost \d* ?Payment for the period/i, () => named('governmentCredits', 'Government credits', 'credits')],
  [/^Credit transfer(red)? (received|in) from /i, () => named('creditTransfers', 'Credits transferred in', 'credits')],
  [/^(EFT refund( for .+)?|Refund)$/i, () => named('refunds', 'Refunds paid out', 'refunds')],
  [/^EFT refund for .+ for the period /i, () => named('refunds', 'Refunds paid out', 'refunds')],
]

/** The line a description belongs to; for wording not known here, its own line in the ATO's words. */
export function lineOf(description: string): LineIdentity {
  const d = description.replace(/^'/, '').trim()
  for (const [pattern, line] of KNOWN) if (pattern.test(d)) return line(d)
  const wording = wordingOf(d) || d
  return { key: `ato:${wording.toLowerCase()}`, label: wording, section: 'other', named: false }
}

/** "- GST", "- PAYG Withholding": a sub-line that splits the statement row above it. */
export const isSubLine = (description: string) => /^- \S/.test(description.replace(/^'/, '').trim())

export const isPaymentTotal = (d: string) => /^payment( received)?$/i.test(d.trim())
export const isRefund = (d: string) => /^(eft refund\b.*|refund)$/i.test(d.trim())
export const isInterest = (d: string) => /general interest charge|\bgic\b/i.test(d)
/** The plain "General interest charge" row the ATO prints over interest rows it sums. */
export const isInterestSummary = (d: string) => /^general interest charge$/i.test(d.trim())

/** A statement the ATO raised itself (an audit or ATO-initiated amendment): its amounts were not lodged by the client. */
export const isAtoRaisedStatement = (d: string) => /^(Tax Office audit amended|ATO initiated amended) /i.test(d.replace(/^'/, '').trim())

/**
 * The line a sub-line counts in, given its statement row. A sub-line of a
 * statement the client lodged is GST / PAYG withholding / its own tax type;
 * a sub-line of a statement the ATO raised (audit, ATO-initiated amendment)
 * is never put under "lodged": it is its own line in the ATO's words,
 * "Tax Office audit amended Activity Statement: GST".
 */
export function subLineOf(statementDescription: string, subDescription: string): LineIdentity {
  const own = lineOf(subDescription)
  if (!isAtoRaisedStatement(statementDescription)) return own
  const statement = wordingOf(statementDescription)
  const sub = subDescription.replace(/^'/, '').replace(/^- /, '').trim()
  return { key: `tax:${statement.toLowerCase()}:${sub.toLowerCase()}`, label: `${statement}: ${sub}`, section: 'tax', named: false }
}
