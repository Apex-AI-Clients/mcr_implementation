import { z } from 'zod'
import type { BandedLine } from './ocrLines'

/**
 * Claude's transcription of a scanned statement page (SCAN_PAGE_PROMPT) ->
 * the same positioned lines the as-printed reader reads, so both readings go
 * through exactly the same code (periods, sections, totals). Pure.
 *
 * The JSON is checked against a strict schema; an answer that does not fit
 * is no reading at all (never repaired by guessing).
 *
 * Laid out on an A4 page in points: the title and title block at the left,
 * the column headers and figures right-aligned on fixed column edges, labels
 * indented 12pt per level, so the reader's sections come from the indent as
 * printed.
 */

export const ScanPageAnswer = z
  .object({
    title: z.string().nullable(),
    title_block: z.array(z.string()),
    columns: z.array(z.string()),
    rows: z.array(
      z
        .object({
          label: z.string(),
          indent: z.number().int().min(0).max(4),
          amounts: z.array(z.string().nullable()),
          top: z.number().min(0).max(1).nullable().optional(),
        })
        .strict(),
    ),
  })
  .strict()

export type ScanPageAnswer = z.infer<typeof ScanPageAnswer>

export class ScanAnswerError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ScanAnswerError'
  }
}

/** Parses Claude's answer. Throws ScanAnswerError when it is not the schema. */
export function parseScanAnswer(text: string): ScanPageAnswer {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  let json: unknown
  try {
    json = JSON.parse(trimmed)
  } catch {
    throw new ScanAnswerError('The second reading was not JSON.')
  }
  const parsed = ScanPageAnswer.safeParse(json)
  if (!parsed.success) throw new ScanAnswerError(`The second reading did not fit the schema: ${parsed.error.issues[0]?.message ?? 'invalid'}.`)
  for (const row of parsed.data.rows) {
    if (row.amounts.length !== parsed.data.columns.length) throw new ScanAnswerError(`"${row.label}" has ${row.amounts.length} amounts for ${parsed.data.columns.length} columns.`)
  }
  return parsed.data
}

const PAGE_RIGHT = 555
const COLUMN_STEP = 85
const LEFT = 57
const INDENT = 12
const CHAR = 5

export function answerToLines(answer: ScanPageAnswer): BandedLine[] {
  if (!answer.title) return []
  const n = answer.columns.length
  const rights = answer.columns.map((_, i) => PAGE_RIGHT - (n - 1 - i) * COLUMN_STEP)
  const at = (x: number, text: string) => ({ x, right: x + text.length * CHAR, text })
  const right = (r: number, text: string) => ({ x: r - text.length * CHAR, right: r, text })
  const lines: BandedLine[] = []
  const plain = (text: string, band: [number, number]) => lines.push({ text, cells: [at(LEFT, text)], band })
  plain(answer.title, [0, 0])
  for (const t of answer.title_block) plain(t, [0, 0])
  lines.push({ text: answer.columns.join(' '), cells: answer.columns.map((h, i) => right(rights[i], h)), band: [0, 0] })
  for (const row of answer.rows) {
    const cells = [
      ...(row.label.trim() ? [at(LEFT + row.indent * INDENT, row.label.trim())] : []),
      ...row.amounts.flatMap((a, i) => (a === null || a.trim() === '' ? [] : [right(rights[i], a.trim())])),
    ]
    if (cells.length === 0) continue
    const top = row.top ?? null
    lines.push({ text: cells.map((c) => c.text).join(' '), cells, band: top === null ? [0, 0] : [Math.max(0, top - 0.008), Math.min(1, top + 0.012)] })
  }
  return lines
}
