import { z } from 'zod'
import type { PdfLine } from '@/lib/pdf/pageLines'

/**
 * Claude's reading of a scanned statement page (SCAN_PAGE_PROMPT) -> the same
 * positioned lines the as-printed reader reads, so a scan goes through exactly
 * the code a digital PDF does (periods, sections, totals). Pure.
 *
 * The JSON is checked against a strict schema; an answer that does not fit
 * is no reading at all (never repaired by guessing).
 *
 * Laid out on an A4 page in points: the title and title block at the left,
 * the column headers and figures right-aligned on fixed column edges, each
 * label indented 12pt per section heading it sits under. The structure comes
 * from the sections Claude names for each line, never from guessing indents.
 */

/** A line of a page, with where it sits on the page (fractions of its height), for the crop. */
export interface BandedLine extends PdfLine {
  band: [number, number]
}

export const ScanPageAnswer = z
  .object({
    title: z.string().nullable(),
    title_block: z.array(z.string()),
    columns: z.array(z.string()),
    rows: z.array(
      z
        .object({
          label: z.string(),
          section: z.array(z.string()).max(6),
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

function json(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try {
    return JSON.parse(trimmed)
  } catch {
    throw new ScanAnswerError('The reading was not JSON.')
  }
}

/** Parses Claude's transcription. Throws ScanAnswerError when it is not the schema. */
export function parseScanAnswer(text: string): ScanPageAnswer {
  const parsed = ScanPageAnswer.safeParse(json(text))
  if (!parsed.success) throw new ScanAnswerError(`The reading did not fit the schema: ${parsed.error.issues[0]?.message ?? 'invalid'}.`)
  for (const row of parsed.data.rows) {
    if (row.amounts.length !== parsed.data.columns.length) throw new ScanAnswerError(`"${row.label}" has ${row.amounts.length} amounts for ${parsed.data.columns.length} columns.`)
  }
  return parsed.data
}

/**
 * What a continuation page needs to know from the page before: the statement
 * and the sections still open where it stopped (the last line's sections,
 * less any its total closed).
 */
export function continuationContext(previous: ScanPageAnswer | null): string {
  if (!previous?.title || previous.rows.length === 0) return ''
  const last = previous.rows[previous.rows.length - 1]
  let open = last.section
  // A total closes the section it totals ("Total Current Liabilities" closes "Current Liabilities").
  if (/^total\b/i.test(last.label.trim()) && open.length) open = open.slice(0, -1)
  else if (last.amounts.every((a) => a === null) && last.label.trim()) open = [...open, last.label.trim()]
  return [
    `This page may continue "${previous.title}" from the page before.`,
    open.length
      ? `At the end of the page before, these sections were still open, outermost first: ${JSON.stringify(open)}. Lines at the top of this page that are printed under them (before any new heading) have those sections.`
      : 'At the end of the page before, no section was open.',
  ].join(' ')
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
      ...(row.label.trim() ? [at(LEFT + row.section.length * INDENT, row.label.trim())] : []),
      ...row.amounts.flatMap((a, i) => (a === null || a.trim() === '' ? [] : [right(rights[i], a.trim())])),
    ]
    if (cells.length === 0) continue
    const top = row.top ?? null
    lines.push({ text: cells.map((c) => c.text).join(' '), cells, band: top === null ? [0, 0] : [Math.max(0, top - 0.008), Math.min(1, top + 0.012)] })
  }
  return lines
}
