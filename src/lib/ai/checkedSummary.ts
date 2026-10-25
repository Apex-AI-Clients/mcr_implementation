import { askClaude } from './openrouterClient'
import { promptFigures, unsupportedFigures } from './summaryFigures'
import { bannedWordsIn, withoutBannedSentences } from './wording'

/**
 * Server-only. A summary from Claude that has passed the checks every summary
 * must pass:
 *   - every dollar figure it states is one of the prompt's dollar figures, or
 *     the difference between two of them (summaryFigures.ts);
 *   - none of the banned words (wording.ts).
 * A summary that fails is written again once, with what was wrong named. If
 * its figures still do not check out, the fallback (a summary without
 * figures) is used; if only a banned word remains, those sentences are taken out.
 */
export async function writeCheckedSummary(input: {
  prompt: string
  label: string
  maxTokens: number
  /** A summary without figures, used when the model's figures do not check out twice. */
  withoutFigures: () => string
}): Promise<{ text: string; model: string }> {
  const { prompt, label, maxTokens } = input
  const inputs = promptFigures(prompt)
  const ask = (content: string) => askClaude({ purpose: 'summary', prompt: content, maxTokens, label })

  const first = await ask(prompt)
  const stray = unsupportedFigures(first.text, inputs)
  const banned = bannedWordsIn(first.text)
  if (stray.length === 0 && banned.length === 0) return { text: first.text, model: first.model }

  const problems = [
    stray.length
      ? `stated ${stray.join(', ')}, which ${stray.length === 1 ? 'is' : 'are'} not in the figures above or the difference between two of them`
      : null,
    banned.length ? `used ${banned.map((w) => `"${w}"`).join(', ')}, which you must never use` : null,
  ].filter(Boolean)
  const second = await ask(`${prompt}\n\nYour previous summary ${problems.join(', and ')}. Write it again using only those figures.`)
  if (unsupportedFigures(second.text, inputs).length > 0) {
    return { text: input.withoutFigures(), model: `${second.model} (figures withheld)` }
  }
  return bannedWordsIn(second.text).length === 0
    ? { text: second.text, model: second.model }
    : { text: withoutBannedSentences(second.text), model: second.model }
}
