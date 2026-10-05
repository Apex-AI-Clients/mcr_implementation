import { parseFilenameYear, type FilenameYear } from './filenameYear'
import type { PrepassClassification } from './classifyPages'

/**
 * The financial year(s) a document reports, for the extraction guardrail.
 *
 * Headings decide. The filename is used only when no heading named a year, and
 * a filename that names a different year from the headings is reported as a
 * conflict — the headings still win.
 */

export interface ResolvedYears {
  /** Annual FYs to tell the model the primary column(s) must be. Ascending. */
  annualYears: number[]
  /** FY of the current-period statement, when the document is one. */
  currentPeriodYear: number | null
  source: 'heading' | 'filename' | 'none'
  filename: FilenameYear | null
  /** The filename names a year the headings do not. Headings win. */
  conflict: { filenameYear: number; headingYears: number[] } | null
}

export function resolveDocumentYears(
  prepass: Pick<PrepassClassification, 'headingYears' | 'currentPeriodYear'>,
  sourceFilename: string,
  now: Date = new Date(),
): ResolvedYears {
  const filename = parseFilenameYear(sourceFilename, now)
  const headingYears = prepass.headingYears
  const currentPeriodYear = prepass.currentPeriodYear

  if (headingYears.length > 0 || currentPeriodYear !== null) {
    const named = [...headingYears, ...(currentPeriodYear !== null ? [currentPeriodYear] : [])]
    const conflict =
      filename !== null && !named.includes(filename.year)
        ? { filenameYear: filename.year, headingYears: named }
        : null
    return { annualYears: headingYears, currentPeriodYear, source: 'heading', filename, conflict }
  }

  if (filename) {
    return {
      annualYears: [filename.year],
      currentPeriodYear: null,
      source: 'filename',
      filename,
      conflict: null,
    }
  }

  return { annualYears: [], currentPeriodYear: null, source: 'none', filename: null, conflict: null }
}
