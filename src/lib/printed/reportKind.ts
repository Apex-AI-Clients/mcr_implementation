import type { PdfLine } from '@/lib/pdf/pageLines'
import type { PrintedStatement, ReportKind } from './types'

/**
 * What kind of report a PDF is, from what it prints (Gabby, 25 Nov 2026): never from its file
 * name, never from how many columns it has. Pure.
 *
 *   annual_statements  any accountant's marker: a contents page, notes to the financial
 *                      statements, a compilation (or audit) report, a directors' / trustees'
 *                      declaration, a "Notes" column beside the figures, or a statement titled
 *                      "Income Statement" / "Statement of Financial Position" (or another
 *                      accounting-standard title: "Statement of Profit or Loss",
 *                      "Statement of Comprehensive Income")
 *   export             none of them: statement title, entity and period, as Xero or MYOB print
 *                      a report, with one column or many
 */

const MARKERS: { name: string; rule: RegExp }[] = [
  { name: 'Contents page', rule: /^(table\s+of\s+)?contents$/i },
  { name: 'Notes to the financial statements', rule: /\bnotes\s+to\s+(and\s+forming\s+part\s+of\s+)?the\s+(financial\s+statements|accounts)\b|\baccompanying\s+notes\b/i },
  { name: 'Compilation report', rule: /\bcompilation\s+report\b|\bindependent\s+auditor'?s'?\s+report\b|\baudit\s+report\b/i },
  {
    name: "Directors' or trustees' declaration",
    rule: /\b(directors?|trustees?|partners?|members?|committee)['’]?s?['’]?\s+declaration\b|\bdeclaration\s+by\s+the\s+(directors?|trustees?|partners?)\b/i,
  },
]

const ACCOUNTANT_TITLE = /^(detailed\s+)?(income\s+statement|statement\s+of\s+financial\s+position|statement\s+of\s+profit\s+or\s+loss\b.*|statement\s+of\s+comprehensive\s+income)$/i

/** A marker is a heading-like line, not a long sentence that happens to mention one (but "accompanying notes" footers count). */
const MAX_WORDS = 16

export function reportKind(pages: PdfLine[][], statements: PrintedStatement[], notesColumn: boolean): ReportKind {
  const markers: string[] = []
  const seen = new Set<string>()
  const add = (name: string, page: number) => {
    if (seen.has(name)) return
    seen.add(name)
    markers.push(`${name} (page ${page})`)
  }
  pages.forEach((lines, i) => {
    for (const line of lines) {
      const text = line.text.replace(/\s+/g, ' ').trim()
      if (!text || text.split(' ').length > MAX_WORDS) continue
      for (const m of MARKERS) if (m.rule.test(text)) add(m.name, i + 1)
    }
  })
  for (const st of statements) if (ACCOUNTANT_TITLE.test(st.title.replace(/\s+/g, ' ').trim())) add(`Titled "${st.title.trim()}"`, st.pages[0])
  if (notesColumn) {
    const page = statements[0]?.pages[0] ?? 1
    add('A "Notes" column beside the figures', page)
  }
  return { kind: markers.length ? 'annual_statements' : 'export', markers }
}

/** Words that make a title-block line an entity's name. */
const ENTITY_WORDS = /\b(pty\.?|ltd\.?|limited|proprietary|trust|trustees?|atf|t\/as|trading\s+as|partnership|partners|superannuation\s+fund|super\s+fund|incorporated|inc\.?|co-?operative|association|unit\s+trust|family\s+trust)\b/i
const DATE_LINE = /\b(year|period|months?)\s+end(ed|ing)\b|\bas\s+(at|of)\b|\bfor\s+the\s+period\b|^abn\b|^acn\b/i

/**
 * The entity a statement's title block names: the first line (not the title, not the period) with
 * an entity's words ("Pty Ltd", "Trust", "ATF"). Null when none: never guessed from a bare name.
 */
export function entityOf(titleBlock: string[], title: string): string | null {
  for (const raw of titleBlock) {
    const text = raw.replace(/\s+/g, ' ').trim()
    if (!text || text === title.trim() || DATE_LINE.test(text) || text.split(' ').length > 14) continue
    if (ENTITY_WORDS.test(text)) return text
  }
  return null
}
