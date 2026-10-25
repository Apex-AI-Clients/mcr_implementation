import { it } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { readPrintedStatements } from '@/lib/printed/readPdf'
import { verifyStatements } from '@/lib/printed/verify'
import { buildPrintedComparison, type ComparisonDocument, type PrintedComparison } from '@/lib/printed/compare'
import type { PrintedRead } from '@/lib/printed/types'
import { PDF_DIR, PRINTED_DIR, readExpected, readManifest, type ExpectedDocument } from './regression'

/**
 * `npm run printed:check` — reads every regression PDF with the current
 * reader and compares it with <alias>/<documentId>.expected.json, row by row:
 * statement, title, columns and periods, then every row's page, section path,
 * label, style and amounts. Every printed total must verify (or be one of
 * the PDF's own errors listed in the expected file). Local only: the PDFs and
 * expected files live in /verified-figures/ (gitignored).
 *
 * A failure names the page and the printed line, so a new layout is one
 * small reader change plus its expected file. A PDF with no expected file
 * gets a <documentId>.draft.json to check by hand. PRINTED_ALIAS=client-f
 * checks one client.
 */

const MAX_DIFFS = 12
const fmt = (v: unknown) => JSON.stringify(v)

function compare(read: PrintedRead, expected: ExpectedDocument): string[] {
  const diffs: string[] = []
  const add = (d: string) => diffs.length < MAX_DIFFS && diffs.push(d)
  for (const issue of read.issues) add(`reader: ${issue.message}${issue.text ? ` — line: "${issue.text}"` : ''}`)
  if (read.statements.length !== expected.statements.length) {
    add(`statements: read ${read.statements.map((s) => `${s.title} p${s.pages.join(',')}`).join(' | ')}; expected ${expected.statements.map((s) => `${s.title} p${s.pages.join(',')}`).join(' | ')}`)
  }
  expected.statements.forEach((exp, si) => {
    const got = read.statements[si]
    if (!got) return
    const where = `${exp.title} (p${exp.pages.join(',')})`
    if (got.kind !== exp.kind || got.title !== exp.title || fmt(got.pages) !== fmt(exp.pages)) add(`${where}: read as ${got.kind} "${got.title}" p${got.pages.join(',')}`)
    exp.columns.forEach((col, ci) => {
      const g = got.columns[ci]
      const pick = (c: typeof col | undefined) => c && { header: c.header, periodStart: c.periodStart, periodEnd: c.periodEnd, kind: c.kind, financialYear: c.financialYear }
      if (fmt(pick(g)) !== fmt(pick(col))) add(`${where}: column ${ci + 1} read ${fmt(pick(g))}, expected ${fmt(pick(col))}`)
    })
    const n = Math.max(exp.rows.length, got.rows.length)
    for (let r = 0; r < n; r++) {
      const e = exp.rows[r]
      const g = got.rows[r]
      if (!e) { add(`${where}: extra row read on p${g.page}: "${g.text}"`); break }
      if (!g) { add(`${where}: row not read on p${e.page}: "${e.label}" ${fmt(e.amounts)}`); break }
      const same = g.page === e.page && fmt(g.path) === fmt(e.path) && g.label === e.label && g.style === e.style && fmt(g.amounts) === fmt(e.amounts)
      if (!same) {
        add(`${where} p${g.page} row ${r + 1}: printed line "${g.text}"\n      read     ${g.style} ${fmt(g.path)} "${g.label}" ${fmt(g.amounts)}\n      expected ${e.style} ${fmt(e.path)} "${e.label}" ${fmt(e.amounts)}`)
        // One misread line shifts the rest: report the first of a run only.
        if (g.label !== e.label) break
      }
    }
  })
  const failures = verifyStatements(read.statements).filter((c) => c.status === 'mismatch' || c.status === 'wrong_column')
  const known = new Set(expected.pdfErrors)
  for (const f of failures) {
    const st = read.statements[f.statement]
    const id = `${st.title}|${f.label}|${st.columns[f.column].header}`
    if (!known.has(id)) add(`total does not verify: ${st.title} p${st.pages.join(',')}: ${f.message}\n      terms: ${f.terms.join(' + ')}`)
  }
  return diffs
}

it('reads every regression PDF exactly as printed', async () => {
  const only = process.env.PRINTED_ALIAS?.trim()
  const lines: string[] = []
  let failed = 0
  for (const [alias, entry] of Object.entries(readManifest())) {
    if (only && alias !== only) continue
    lines.push(`── ${alias} ──`)
    for (const doc of entry.documents) {
      const expected = readExpected(alias, doc.documentId)
      const bytes = new Uint8Array(readFileSync(path.join(PDF_DIR, alias, doc.file)))
      const started = performance.now()
      const read = await readPrintedStatements(bytes)
      const ms = Math.round(performance.now() - started)
      const checks = verifyStatements(read.statements)
      const rows = read.statements.reduce((n, s) => n + s.rows.length, 0)
      const periods = read.statements.map((s) => s.columns.map((c) => (c.kind === 'annual' ? `FY${c.financialYear}` : `CP→${c.periodEnd}`)).join('/')).join(' ')
      const summary = `${doc.documentId.slice(0, 8)}  ${ms}ms  ${read.pageCount}pp  ${rows} rows  ${checks.length} totals (${checks.filter((c) => c.status === 'rounding').length} to rounding)  ${periods}`
      if (!expected) {
        // A starting point only: check every row against the PDF, then save it as .expected.json.
        const draft: ExpectedDocument = {
          documentId: doc.documentId,
          status: 'unverified',
          checkedBy: 'Not checked: drafted from the reader. Check every row against the PDF before saving as .expected.json.',
          statements: read.statements.map((s) => ({ ...s, rows: s.rows.map(({ page, path: p, label, style, amounts }) => ({ page, path: p, label, style, amounts })) })),
          pdfErrors: [],
        }
        writeFileSync(path.join(PRINTED_DIR, alias, `${doc.documentId}.draft.json`), JSON.stringify(draft, null, 1))
        lines.push(`  NO EXPECTED FILE (draft written)  ${summary}`)
        for (const issue of read.issues) lines.push(`    reader: ${issue.message}${issue.text ? ` — line: "${issue.text}"` : ''}`)
        failed++
        continue
      }
      const diffs = compare(read, expected)
      lines.push(`  ${diffs.length ? 'FAIL' : 'pass'} (${expected.status})  ${summary}`)
      for (const d of diffs) lines.push(`    ${d}`)
      if (diffs.length) failed++
    }
  }
  // Straight to stdout: vitest shows console output only for failing tests.
  process.stdout.write(`${lines.join('\n')}\n`)
  if (failed) throw new Error(`${failed} document(s) differ from their expected as-printed rows`)
})

/**
 * Every figure each report prints for a year shown in the comparison is in
 * that year's column: as the figure, or as a "restated" note when the year's
 * own report prints another. Returns what is missing, with page and line.
 */
function comparisonGaps(docs: ComparisonDocument[], comparison: PrintedComparison): string[] {
  const gaps: string[] = []
  for (const doc of docs) {
    for (const st of doc.read?.statements ?? []) {
      st.columns.forEach((col, ci) => {
        const ci2 = comparison.columns.findIndex((c) => (col.kind === 'annual' ? c.kind === 'annual' && c.financialYear === col.financialYear : c.kind === 'current_period' && c.periodEnd === col.periodEnd))
        if (ci2 < 0) return
        const table = comparison.tables.find((t) => t.kind === st.kind)
        for (const row of st.rows) {
          const v = row.amounts[ci]
          if (row.style === 'heading' || v === null) continue
          const shown = table?.rows.some((r) => {
            const cell = r.cells[ci2]
            // The column's own source: this exact printed line.
            if (cell.source?.documentId === doc.documentId) return cell.value === v && cell.source.page === row.page && cell.source.text === row.text
            // Another report printing the same year: the same figure on the same line, or a "restated" note.
            const sameLine = r.label === row.label && r.path.join('>') === row.path.join('>')
            return (sameLine && cell.value === v) || cell.restated.some((rs) => rs.value === v && rs.source.documentId === doc.documentId && rs.source.page === row.page && rs.source.text === row.text)
          })
          if (!shown) gaps.push(`${col.header} p${row.page}: "${row.text}" is not in the comparison`)
        }
      })
    }
  }
  return gaps
}

it('shows every printed figure in the comparison, years in order', async () => {
  const only = process.env.PRINTED_ALIAS?.trim()
  const lines: string[] = []
  let failed = 0
  for (const [alias, entry] of Object.entries(readManifest())) {
    if (only && alias !== only) continue
    const docs: ComparisonDocument[] = []
    for (const doc of entry.documents) {
      const read = await readPrintedStatements(new Uint8Array(readFileSync(path.join(PDF_DIR, alias, doc.file))))
      docs.push({ documentId: doc.documentId, filename: doc.documentId.slice(0, 8), uploadedAt: '', read })
    }
    const started = performance.now()
    const comparison = buildPrintedComparison(docs)
    const ms = Math.round(performance.now() - started)
    // The default view, and with "Show earlier years from comparative columns".
    const gaps = [...comparisonGaps(docs, comparison), ...comparisonGaps(docs, buildPrintedComparison(docs, { comparativeYears: true })).map((g) => `(with earlier years) ${g}`)]
    const ends = comparison.columns.map((c) => c.periodEnd)
    const ordered = ends.every((e, i) => i === 0 || e > ends[i - 1])
    const restated = comparison.tables.flatMap((t) => t.rows.flatMap((r) => r.cells.filter((c) => c.restated.length))).length
    const unused = comparison.documents.filter((d) => !d.used).length
    lines.push(
      `  ${gaps.length || !ordered ? 'FAIL' : 'pass'}  ${alias}  ${ms}ms  ${comparison.columns.map((c) => c.key).join(' ')}  ${comparison.tables.map((t) => `${t.kind === 'profit_and_loss' ? 'P&L' : 'BS'} ${t.rows.length} rows`).join(', ')}  ${restated} restated  ${comparison.failures.length} totals failing  ${unused} files not used`,
    )
    if (!ordered) lines.push(`    columns not in date order: ${ends.join(', ')}`)
    for (const g of gaps.slice(0, MAX_DIFFS)) lines.push(`    ${g}`)
    for (const f of comparison.failures) lines.push(`    total: ${f.column} ${f.message}`)
    if (gaps.length || !ordered) failed++
  }
  process.stdout.write(['── comparison ──', ...lines, ''].join('\n'))
  if (failed) throw new Error(`${failed} client comparison(s) leave out printed figures or misorder years`)
})
