/**
 * Server-only. Label-meaning suggestions from Claude Haiku
 * (openrouterClient.ts) for the key figures the dictionary (printed/dictionary.ts)
 * found no line for and staff have not confirmed. Shown as "Suggested by AI"
 * for staff to confirm: never used by a tile or the prediction until they do.
 *
 * Only the printed label and the headings above it are sent: no figure, no
 * PDF, no client name. Lines the dictionary already suggests or staff already
 * confirmed are known and not sent. An answer naming a line that was not
 * offered, or several lines for a one-line meaning, is dropped.
 */
import { askClaude } from './openrouterClient'
import { LABEL_SUGGESTION_PROMPT_TEMPLATE } from './prompts'
import { MEANINGS, MEANING, type Meaning } from '@/lib/printed/meanings'
import { STATEMENT_NAME } from '@/lib/printed/picker'
import type { ComparisonRow, PrintedComparison } from '@/lib/printed/compare'
import type { MappingEntry } from '@/lib/printed/mapping'
import type { Suggestions } from '@/lib/printed/dictionary'

export type AiSuggestions = Partial<Record<Meaning, string[]>>

/** The meanings to ask about: no dictionary suggestion, nothing confirmed. */
export function unknownMeanings(mapping: MappingEntry[], suggestions: Suggestions): Meaning[] {
  return MEANINGS.filter((m) => suggestions[m.key].length === 0 && !mapping.some((e) => e.meaning === m.key)).map((m) => m.key)
}

interface OfferedLine {
  id: number
  row: ComparisonRow
  statement: keyof typeof STATEMENT_NAME
}

/** The lines offered: printed lines and totals of the statements those meanings sit in, not already known. */
export function offeredLines(comparison: PrintedComparison, meanings: Meaning[], mapping: MappingEntry[], suggestions: Suggestions): OfferedLine[] {
  const known = new Set([...mapping.map((e) => e.rowKey), ...Object.values(suggestions).flat()])
  const statements = new Set(meanings.map((m) => MEANING[m].statement))
  let id = 0
  return comparison.tables
    .filter((t) => statements.has(t.kind))
    .flatMap((t) =>
      t.rows
        .filter((r) => r.style !== 'heading' && r.style !== 'ratio' && r.label.trim() !== '' && !known.has(r.key))
        .map((row) => ({ id: ++id, row, statement: t.kind })),
    )
}

export function labelSuggestionPrompt(meanings: Meaning[], lines: OfferedLine[]): string {
  const meaningText = meanings
    .map((m) => `- ${m} (${STATEMENT_NAME[MEANING[m].statement]}, ${MEANING[m].multiple ? 'several lines' : 'one line'}): ${MEANING[m].label}. ${MEANING[m].hint}`)
    .join('\n')
  const lineText = lines
    .map((l) => `${l.id}: ${[STATEMENT_NAME[l.statement], ...l.row.path.filter((p) => p.trim() !== ''), l.row.label.trim()].join(' › ')}`)
    .join('\n')
  return LABEL_SUGGESTION_PROMPT_TEMPLATE.replaceAll('{meanings}', meaningText).replaceAll('{lines}', lineText)
}

/** The model's answer, checked: only offered ids, in that meaning's statement, one for a one-line meaning. */
export function parseLabelSuggestions(text: string, meanings: Meaning[], lines: OfferedLine[]): AiSuggestions {
  const json = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return {}
  }
  if (!parsed || typeof parsed !== 'object') return {}
  const out: AiSuggestions = {}
  for (const m of meanings) {
    const ids = (parsed as Record<string, unknown>)[m]
    if (!Array.isArray(ids)) continue
    const rows = [...new Set(ids)]
      .map((id) => lines.find((l) => l.id === id && l.statement === MEANING[m].statement))
      .filter((l): l is OfferedLine => !!l)
      .map((l) => l.row.key)
    if (rows.length === 0 || (!MEANING[m].multiple && rows.length > 1)) continue
    out[m] = rows
  }
  return out
}

export async function suggestUnknownLabels(comparison: PrintedComparison, mapping: MappingEntry[], suggestions: Suggestions): Promise<AiSuggestions> {
  const meanings = unknownMeanings(mapping, suggestions)
  if (meanings.length === 0) return {}
  const lines = offeredLines(comparison, meanings, mapping, suggestions)
  if (lines.length === 0) return {}
  const answer = await askClaude({ purpose: 'labels', prompt: labelSuggestionPrompt(meanings, lines), maxTokens: 300, label: 'label-suggestions', timeoutMs: 30_000 })
  return parseLabelSuggestions(answer.text, meanings, lines)
}
