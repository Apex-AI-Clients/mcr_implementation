import type { PrintedAmount, PrintedRead, PrintedRow, PrintedStatement, ScanCell, ScanCellStatus } from '@/lib/printed/types'
import type { BandedLine } from './ocrLines'

/**
 * Two independent readings of the same PDF -> one read, figure by figure.
 * Pure.
 *
 *   Both readings went through the same as-printed reader: text-layer pages
 *   are identical in both and are taken as they are. On scanned pages each
 *   statement is matched by kind and page, and its rows by label (allowing
 *   for an OCR slip of a letter or two), in printed order.
 *
 *   agree     both print the same figure (to the cent, or both nil)
 *   disagree  they differ, or one reading has the line and the other not:
 *             the figure shown is the second reading's until staff choose
 *   single    no second reading (Claude unavailable or over the cap)
 *
 * The labels, sections and styles come from the second reading where both
 * have the line (Claude reads words better; Tesseract is the check on the
 * figures); a line only one reading has keeps that reading's.
 */

export interface ReconcileInput {
  ocr: PrintedRead
  /** Null: no second reading. */
  claude: PrintedRead | null
  /** 1-based pages that are scans. */
  scannedPages: Set<number>
  /** Scanned statement pages the second reading did not read (unavailable, failed, over the cap): single readings. */
  secondMissing?: Set<number>
  /** Each scanned page's lines, with their bands, per reading (for the crop). */
  ocrLines: Map<number, BandedLine[]>
  claudeLines: Map<number, BandedLine[]>
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
function align(a: PrintedRow[], b: PrintedRow[]): [PrintedRow | null, PrintedRow | null][] {
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

const sameAmount = (x: PrintedAmount | undefined, y: PrintedAmount | undefined) =>
  typeof x === 'number' && typeof y === 'number' ? Math.abs(x - y) < 0.005 : x === y

function bandOf(row: PrintedRow, lines: Map<number, BandedLine[]>): [number, number] | null {
  const line = lines.get(row.page)?.find((l) => l.text === row.text)
  return line && line.band[1] > 0 ? line.band : null
}

function onScan(st: PrintedStatement, scanned: Set<number>) {
  return st.pages.some((p) => scanned.has(p))
}

export function reconcileReads({ ocr, claude, scannedPages, secondMissing = new Set(), ocrLines, claudeLines }: ReconcileInput): PrintedRead {
  const statements: PrintedStatement[] = []
  const usedClaude = new Set<PrintedStatement>()
  const keyCount = new Map<string, number>()
  const keyFor = (kind: string, row: PrintedRow) => {
    const base = `${kind}|${row.page}|${row.path.map(normLabel).join('>')}|${normLabel(row.label)}`
    const n = keyCount.get(base) ?? 0
    keyCount.set(base, n + 1)
    return `${base}|${n}`
  }

  const counterpart = (st: PrintedStatement) =>
    claude?.statements.find((c) => !usedClaude.has(c) && c.kind === st.kind && c.pages.some((p) => st.pages.includes(p))) ?? null

  for (const st of ocr.statements) {
    if (!onScan(st, scannedPages)) {
      statements.push(st)
      // The same text-layer statement in the second pass: not a second reading.
      const twin = counterpart(st)
      if (twin) usedClaude.add(twin)
      continue
    }
    const other = counterpart(st)
    const columnsAgree =
      !!other && other.columns.length === st.columns.length && other.columns.every((c, i) => c.periodEnd === st.columns[i].periodEnd && c.kind === st.columns[i].kind)
    if (other) usedClaude.add(other)
    if (!claude || !other || !columnsAgree) {
      const status: ScanCellStatus = !claude || st.pages.filter((p) => scannedPages.has(p)).every((p) => secondMissing.has(p)) ? 'single' : 'disagree'
      statements.push(withScan(st, st.rows.map((r) => [r, null]), status, keyFor, ocrLines, claudeLines))
      continue
    }
    // Both readings: the second reading's statement is the frame.
    statements.push(withScan({ ...other, pages: [...new Set([...st.pages, ...other.pages])].sort((a, b) => a - b) }, align(st.rows, other.rows), 'disagree', keyFor, ocrLines, claudeLines))
  }
  // A scanned statement only the second reading found: every figure is one reading against none.
  for (const st of claude?.statements ?? []) {
    if (usedClaude.has(st) || !onScan(st, scannedPages)) continue
    statements.push(withScan(st, st.rows.map((r) => [null, r]), 'disagree', keyFor, ocrLines, claudeLines))
  }
  statements.sort((a, b) => a.pages[0] - b.pages[0])

  const issues = ocr.issues.filter((i) => i.page === null || !scannedPages.has(i.page))
  return {
    status: statements.length ? 'read' : ocr.status === 'no_text_layer' ? 'no_statements' : ocr.status,
    pageCount: ocr.pageCount,
    statements,
    issues,
  }
}

function withScan(
  frame: PrintedStatement,
  pairs: [PrintedRow | null, PrintedRow | null][],
  missing: ScanCellStatus,
  keyFor: (kind: string, row: PrintedRow) => string,
  ocrLines: Map<number, BandedLine[]>,
  claudeLines: Map<number, BandedLine[]>,
): PrintedStatement {
  const columns = frame.columns.length
  const rows: PrintedRow[] = pairs.map(([o, c]) => {
    const base = (c ?? o)!
    if (base.style === 'heading') return { ...base, scan: undefined }
    const cells: ScanCell[] = Array.from({ length: columns }, (_, i) => {
      const ov = o ? o.amounts[i] : undefined
      const cv = c ? c.amounts[i] : undefined
      if (o && c) return { status: sameAmount(ov, cv) ? 'agree' : 'disagree', ocr: ov, claude: cv }
      return { status: missing, ...(o ? { ocr: ov } : {}), ...(c ? { claude: cv } : {}) }
    })
    const amounts = cells.map((cell) => (cell.claude !== undefined ? cell.claude : (cell.ocr ?? null)))
    const band = (o && bandOf(o, ocrLines)) ?? (c && bandOf(c, claudeLines)) ?? null
    return { ...base, amounts, scan: { key: keyFor(frame.kind, base), band, cells } }
  })
  const numbers = rows.flatMap((r) => r.amounts.filter((a): a is number => typeof a === 'number'))
  return { ...frame, rows, wholeDollars: numbers.every((v) => Number.isInteger(v)) }
}
