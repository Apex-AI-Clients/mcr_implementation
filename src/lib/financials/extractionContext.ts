import type { PrepassClassification } from './classifyPages'
import type { PageSelection } from './pageSelection'
import type { ResolvedYears } from './resolveYear'

/**
 * The document-specific block appended to FINANCIALS_EXTRACTION_PROMPT.
 *
 * Everything in it comes from our own text pre-pass of this file, so it is
 * stated as fact: which statements the file holds, which pages they are on
 * (when the file could not be trimmed), and which years the headings name.
 * The base prompt is left exactly as it was — the combined path depends on it.
 */

function pageList(pages: number[]): string {
  if (pages.length === 1) return `page ${pages[0]}`
  return `pages ${pages.slice(0, -1).join(', ')} and ${pages[pages.length - 1]}`
}

export function buildExtractionContext(input: {
  sourceFilename: string
  classification: Pick<PrepassClassification, 'kind' | 'comparativeYears'>
  years: ResolvedYears
  selection: PageSelection
}): string {
  const { sourceFilename, classification, years, selection } = input
  const lines: string[] = [
    '',
    '== DOCUMENT CONTEXT (from a text pre-pass of this exact file — treat as fact) ==',
    `SOURCE FILENAME: "${sourceFilename}"`,
  ]

  switch (classification.kind) {
    case 'combined':
      lines.push('CONTENTS: this document contains BOTH an Income Statement (Profit and Loss) and a Balance Sheet.')
      break
    case 'pnl_only':
      lines.push(
        'CONTENTS: this document contains an Income Statement (Profit and Loss) ONLY. It has NO Balance Sheet.',
        'Set balanceSheetPresent to false on every entry and leave every balanceSheet value null.',
      )
      break
    case 'bs_only':
      lines.push(
        'CONTENTS: this document contains a Balance Sheet ONLY. It has NO Income Statement.',
        'Set incomeStatementPresent to false on every entry and leave every incomeStatement value null.',
      )
      break
    default:
      lines.push('CONTENTS: not determined by the pre-pass. Decide from the headings which statements are present.')
  }

  if (selection.mode === 'named_pages_whole_file') {
    const is = selection.statementPages.income_statement
    const bs = selection.statementPages.balance_sheet
    const where = [
      ...(is.length ? [`the Income Statement is on ${pageList(is)}`] : []),
      ...(bs.length ? [`the Balance Sheet is on ${pageList(bs)}`] : []),
    ].join(' and ')
    lines.push(
      `PAGES: ${where} (physical page numbers in this file, counting the first page as 1).`,
      'Read figures ONLY from those pages. Ignore every other page entirely — the cover letter, contents, notes, appropriation statement, declarations, depreciation schedule, and above all any Company or Trust Tax Return, whose figures differ from the financial statements.',
    )
  } else if (selection.mode === 'statement_pages') {
    lines.push('PAGES: this file has been cut down to the statement pages only. Every page in it is a statement page.')
  }

  if (years.source === 'heading') {
    if (years.annualYears.length > 0) {
      const primary = years.annualYears.join(' / ')
      const comparatives = classification.comparativeYears.filter((y) => !years.annualYears.includes(y))
      lines.push(
        `YEARS: the statement headings name the year ended 30 June ${primary}. The PRIMARY column's financialYear MUST be ${primary}.` +
          (comparatives.length > 0
            ? ` The column headers also show ${comparatives.join(', ')}: that is the COMPARATIVE column.`
            : ' Return a comparative entry only if the PDF prints a prior-year column.'),
      )
    }
    if (years.currentPeriodYear !== null) {
      lines.push(
        `YEARS: the headings name a partial period ending in FY${years.currentPeriodYear}. Return it as sourceColumn "current_period" with financialYear ${years.currentPeriodYear}.`,
      )
    }
  } else if (years.source === 'filename' && years.filename) {
    lines.push(
      `YEARS: the headings could not be read; the filename suggests PRIMARY financial year ${years.filename.year}. Use ${years.filename.year} unless the PDF heading clearly says otherwise; if it does, trust the heading and add a warning of kind "unmapped_line_item" explaining the mismatch.`,
    )
  } else {
    lines.push('YEARS: no year hint is available — derive financialYear ONLY from the PDF heading.')
  }

  lines.push(
    'PRESENCE: on every entry set incomeStatementPresent and balanceSheetPresent to say whether that statement actually appears in this document for that column. Never fill a statement that is not there from notes, worksheets or a tax return.',
  )

  return lines.join('\n') + '\n'
}
