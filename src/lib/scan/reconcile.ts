import type { PrintedAmount, PrintedRead, PrintedRow, PrintedStatement, ScanCell, ScanCellStatus } from '@/lib/printed/types'
import type { BandedLine } from './ocrLines'

/**
 * Two independent readings of a scanned PDF -> one read, figure by figure
 * (restored 18 Nov 2026, Gabby: a scanned figure is proven only when both
 * readers agree and the totals add up). Pure.
 *
 *   The frame is Claude's reading: it names the section headings of every
 *   line (SCAN_PAGE_PROMPT), so its structure is the statement's. Each of its
 *   lines is matched to Tesseract's line of the same label (allowing for an OCR
 *   slip of a letter or two), in printed order, and each figure compared:
 *
 *   agree     both print the same figure (to the cent, or both nil)
 *   disagree  they differ, or Tesseract has no such line: staff choose
 *   single    no second reading of the page (Tesseract could not read it): staff choose
 *
 * The figure shown is Claude's until staff choose. Text-layer pages are the
 * same in both readings and taken as they are. A line only Tesseract read
 * (Claude has no such line) is listed as a disagreement too: nothing either
 * reader saw is dropped.
 */

export interface ReconcileInput {
  /** Claude's reading: the frame. */
  claude: PrintedRead
  /** Tesseract's reading of the same pages; null when there is none at all. */
  ocr: PrintedRead | null
  /** 1-based pages that are scans. */
  scannedPages: Set<number>
  /** Scanned statement pages Tesseract could not read: single readings. */
  ocrMissing?: Set<number>
  /** Each scanned page's lines, with their bands, per reading (for the crop). */
  claudeLines: Map<number, BandedLine[]>
  ocrLines: Map<number, BandedLine[]>
}

const OCR_LETTERS: Record<string, string> = { '0': 'o', '1': 'l', '5': 's', '|': 'l' }
export const normLabel = (s: string) =>
  s
    .toLowerCase()
    .replace(/[015|]/g, (c) => OCR_LETTERS[c] ?? c)
    .replace(/[^a-z0-9]/g, '')

function similar(a: string, b: string): boolean {
  if (a === b) return true
  const len = Math.max(a.length, b.length)
  if (len < 6) return false
  return levenshtein(a, b) <= Math.max(1, Math.floor(len * 0.12))
}

function levenshtein(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]
    prev[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1))
      diag = tmp
    }
  }
  return prev[b.length]
}

/** Longest common subsequence of rows by similar label and same kind of row (heading or figures). */
export function align(a: PrintedRow[], b: PrintedRow[]): [PrintedRow | null, PrintedRow | null][] {
  const key = (r: PrintedRow) => normLabel(r.label)
  const figures = (r: PrintedRow) => r.style !== 'heading'
  const same = (x: PrintedRow, y: PrintedRow) => figures(x) === figures(y) && similar(key(x), key(y))
  const n = a.length
  const m = b.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = same(a[i], b[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
  const out: [PrintedRow | null, PrintedRow | null][] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (same(a[i], b[j])) out.push([a[i++], b[j++]])
    else if (dp[i + 1][j] >= dp[i][j + 1]) out.push([a[i++], null])
    else out.push([null, b[j++]])
  }
  while (i < n) out.push([a[i++], null])
  while (j < m) out.push([null, b[j++]])
  return out
}

export const sameAmount = (x: PrintedAmount | undefined, y: PrintedAmount | undefined) =>
  typeof x === 'number' && typeof y === 'number' ? Math.abs(x - y) < 0.005 : x === y

function bandOf(row: PrintedRow, lines: Map<number, BandedLine[]>): [number, number] | null {
  const line = lines.get(row.page)?.find((l) => l.text === row.text)
  return line && line.band[1] > 0 ? line.band : null
}

const onScan = (st: PrintedStatement, scanned: Set<number>) => st.pages.some((p) => scanned.has(p))

export function reconcileReads({ claude, ocr, scannedPages, ocrMissing = new Set(), claudeLines, ocrLines }: ReconcileInput): PrintedRead {
  const usedOcr = new Set<PrintedStatement>()
  const keyCount = new Map<string, number>()
  const keyFor = (kind: string, row: PrintedRow) => {
    const base = `${kind}|${row.page}|${row.path.map(normLabel).join('>')}|${normLabel(row.label)}`
    const n = keyCount.get(base) ?? 0
    keyCount.set(base, n + 1)
    return `${base}|${n}`
  }
  const counterpart = (st: PrintedStatement) =>
    ocr?.statements.find((o) => !usedOcr.has(o) && o.kind === st.kind && o.pages.some((p) => st.pages.includes(p))) ?? null

  const statements: PrintedStatement[] = claude.statements.map((st) => {
    if (!onScan(st, scannedPages)) return st
    const other = counterpart(st)
    if (other) usedOcr.add(other)
    const columnsAgree =
      !!other && other.columns.length === st.columns.length && other.columns.every((c, i) => c.periodEnd === st.columns[i].periodEnd && c.kind === st.columns[i].kind)
    if (!other || !columnsAgree) {
      const missing: ScanCellStatus = !ocr || st.pages.filter((p) => scannedPages.has(p)).every((p) => ocrMissing.has(p)) ? 'single' : 'disagree'
      return withScan(st, st.rows.map((r) => [r, null]), missing, keyFor, claudeLines, ocrLines)
    }
    return withScan(st, align(st.rows, other.rows), 'disagree', keyFor, claudeLines, ocrLines)
  })
  return { ...claude, statements }
}

function withScan(
  frame: PrintedStatement,
  pairs: [PrintedRow | null, PrintedRow | null][],
  missing: ScanCellStatus,
  keyFor: (kind: string, row: PrintedRow) => string,
  claudeLines: Map<number, BandedLine[]>,
  ocrLines: Map<number, BandedLine[]>,
): PrintedStatement {
  const columns = frame.columns.length
  const rows: PrintedRow[] = []
  for (const [c, o] of pairs) {
    // A line only Tesseract read keeps its place, under the heading Claude's row before it sits under.
    const base: PrintedRow = c ?? { ...o!, path: rows.length ? rows[rows.length - 1].path : o!.path }
    if (base.style === 'heading') {
      rows.push({ ...base, scan: undefined })
      continue
    }
    const cells: ScanCell[] = Array.from({ length: columns }, (_, i) => {
      const cv = c ? c.amounts[i] : undefined
      const ov = o ? o.amounts[i] : undefined
      if (c && o) return { status: sameAmount(cv, ov) ? 'agree' : 'disagree', claude: cv, ocr: ov }
      return { status: c ? missing : 'disagree', ...(c ? { claude: cv } : {}), ...(o ? { ocr: ov } : {}) }
    })
    const amounts = cells.map((cell) => (cell.claude !== undefined ? cell.claude : (cell.ocr ?? null)))
    const band = (c && bandOf(c, claudeLines)) ?? (o && bandOf(o, ocrLines)) ?? null
    rows.push({ ...base, amounts, scan: { key: keyFor(frame.kind, base), band, cells } })
  }
  const numbers = rows.flatMap((r) => r.amounts.filter((a): a is number => typeof a === 'number'))
  return { ...frame, rows, wholeDollars: numbers.every((v) => Number.isInteger(v)) }
}
