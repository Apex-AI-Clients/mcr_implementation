/**
 * Words no summary may use: legal conclusions about the client that the
 * figures cannot support and the practitioner has not drawn. One list for the
 * AI summaries (financial comparison, lodgement) and the prediction page's
 * rule-based points (financialPoints.ts).
 *
 * "solven…" covers solvent, solvency; "insolven…" covers insolvent,
 * insolvency.
 */
export const BANNED_WORDS = /\b(insolven\w*|solven\w*|fraud\w*|illegal\w*|breach\w*|phoenix\w*)\b/i

/** The banned words a text uses, lower case, each once. */
export function bannedWordsIn(text: string): string[] {
  const found = text.match(new RegExp(BANNED_WORDS.source, 'gi')) ?? []
  return [...new Set(found.map((w) => w.toLowerCase()))]
}

/** The instruction every summary prompt carries. */
export const BANNED_WORDS_INSTRUCTION =
  'Never use the words insolvent, insolvency, solvent, solvency, fraud, illegal, breach or phoenix, or any form of them: state the figures, not conclusions about the business.'

/**
 * The text with every sentence that uses a banned word taken out. The last
 * resort, after the model has been asked once to write it again.
 */
export function withoutBannedSentences(text: string): string {
  const sentences = text.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) ?? [text]
  return sentences
    .filter((s) => !BANNED_WORDS.test(s))
    .join('')
    .trim()
}
