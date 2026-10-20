import { applyYearWindow } from './checks'
import { mergeAnnualYears, mergeCurrentPeriod, supersededCurrentPeriodYears } from './statementSelection'
import { describePeriod, type PeriodOverride } from './periodOverride'
import type { FinancialDocumentKind, StoredStatementSlot } from './types'

/**
 * Each financial statement file, and what became of it: the years read from
 * it, whether it is annual or a current period, and whether the comparison
 * uses it — and if not, why. Built from what is stored, so it is never stale.
 * Pure.
 */

export type FileUsage =
  /** Compared (annual), or the current period shown. */
  | 'used'
  /** Annual, but older than the four years compared: shown only. */
  | 'older'
  /** A current period for a year that already has its annual statement. */
  | 'superseded'
  /** A current period, but a later one is on file. */
  | 'later_current_on_file'
  /** Reads as a trust deed, licence or company extract. */
  | 'not_financial'
  /** A tax return with no statements. */
  | 'tax_return_only'
  /** Never extracted. */
  | 'not_read'
  /** Extracted, but nothing could be read from it. */
  | 'nothing_read'

export interface FinancialFileInput {
  id: string
  filename: string
  override: PeriodOverride | null
  overrideBy: string | null
  overrideAt: string | null
}

export interface FileExtractionInput {
  documentId: string
  kind: FinancialDocumentKind
  extractedAt: string
  /** Why the read failed, when it did ('extraction_failed'). */
  failure?: string | null
}

export interface FinancialFileRow {
  documentId: string
  filename: string
  /** Annual years this file supplies as its own (primary) column. */
  annualYears: number[]
  /** Years it supplies only as a prior-year (comparative) column. */
  comparativeYears: number[]
  /** FY of the current period it supplies, if any. */
  currentPeriodYear: number | null
  currentPeriodLabel: string | null
  usage: FileUsage
  /** Plain-English: what it was read as, and why it is or is not used. */
  note: string
  override: (PeriodOverride & { by: string | null; at: string | null }) | null
  /** Set after the file was last extracted: extract it again to apply. */
  overridePending: boolean
}

const join = (years: number[]) => years.map((y) => `FY${y}`).join(', ')

export function describeFinancialFiles(input: {
  documents: readonly FinancialFileInput[]
  slots: readonly StoredStatementSlot[]
  extractions: readonly FileExtractionInput[]
}): FinancialFileRow[] {
  const slots = [...input.slots]
  const { used } = applyYearWindow(mergeAnnualYears(slots))
  const comparedYears = new Set(used.map((m) => m.statement.financialYear))
  const superseded = supersededCurrentPeriodYears(slots)
  const currentYear = mergeCurrentPeriod(slots)?.statement.financialYear ?? null
  const extractionOf = new Map(input.extractions.map((e) => [e.documentId, e]))

  return input.documents.map((doc) => {
    const annual = new Set<number>()
    const comparative = new Set<number>()
    let currentPeriodYear: number | null = null
    let currentPeriodLabel: string | null = null
    for (const slot of slots) {
      const owns = slot.incomeStatement?.documentId === doc.id || slot.balanceSheet?.documentId === doc.id
      if (!owns) continue
      if (slot.sourceColumn === 'primary') annual.add(slot.financialYear)
      else if (slot.sourceColumn === 'comparative') comparative.add(slot.financialYear)
      else if (currentPeriodYear === null || slot.financialYear > currentPeriodYear) {
        currentPeriodYear = slot.financialYear
        currentPeriodLabel = slot.periodLabel
      }
    }
    const annualYears = [...annual].sort((a, b) => a - b)
    const comparativeYears = [...comparative].filter((y) => !annual.has(y)).sort((a, b) => a - b)
    const extraction = extractionOf.get(doc.id) ?? null

    let usage: FileUsage
    let note: string
    if (extraction?.kind === 'not_financial') {
      usage = 'not_financial'
      note = "Reads as a trust deed, licence or company extract, so nothing was taken from it."
    } else if (extraction?.kind === 'tax_return_only') {
      usage = 'tax_return_only'
      note = "A tax return with no Profit and Loss or Balance Sheet. Tax return figures aren't used."
    } else if (annualYears.length > 0) {
      const compared = annualYears.filter((y) => comparedYears.has(y))
      usage = compared.length > 0 ? 'used' : 'older'
      note =
        compared.length > 0
          ? `Annual, compared for ${join(compared)}.`
          : `Annual ${join(annualYears)}: older than the four years compared, so shown only.`
    } else if (currentPeriodYear !== null) {
      const y = currentPeriodYear
      if (superseded.has(y)) {
        usage = 'superseded'
        note = `Current period within FY${y}, but FY${y} already has its annual statement, so this file isn't used.`
      } else if (y === currentYear) {
        usage = 'used'
        note = `Used as the current period${currentPeriodLabel ? ` (${currentPeriodLabel})` : ''}.`
      } else {
        usage = 'later_current_on_file'
        note = `Current period within FY${y}, but a later current period is on file, so this one isn't used.`
      }
    } else if (comparativeYears.length > 0) {
      usage = 'used'
      note = `Supplies ${join(comparativeYears)} from its prior-year column.`
    } else if (extraction) {
      usage = 'nothing_read'
      note = extraction.failure
        ? `Could not be read: ${extraction.failure} Re-extract from the comparison page to try again.`
        : 'Nothing could be read from it. Check the file.'
    } else {
      usage = 'not_read'
      note = 'Not read yet. Run the comparison to read it.'
    }

    const override = doc.override ? { ...doc.override, by: doc.overrideBy, at: doc.overrideAt } : null
    const overridePending =
      override !== null && (!extraction || (override.at !== null && override.at > extraction.extractedAt))
    if (override && overridePending) {
      note = `Set to ${describePeriod(override)}. Read the file again to apply it. ${note}`
    }

    return {
      documentId: doc.id,
      filename: doc.filename,
      annualYears,
      comparativeYears,
      currentPeriodYear,
      currentPeriodLabel,
      usage,
      note,
      override,
      overridePending,
    }
  })
}

/** The financial years an override can name: ten back from the current FY, and the next one. */
export function overrideYearOptions(today: Date = new Date()): number[] {
  const fy = today.getMonth() >= 6 ? today.getFullYear() + 1 : today.getFullYear()
  return Array.from({ length: 12 }, (_, i) => fy + 1 - i)
}

/** Why a file's read failed, from its extraction record's warnings, or null. */
export function failureOf(warnings: unknown): string | null {
  if (!Array.isArray(warnings)) return null
  const failed = warnings.find(
    (w): w is { kind: string; message: string } =>
      typeof w === 'object' && w !== null && (w as { kind?: unknown }).kind === 'extraction_failed',
  )
  return failed ? String(failed.message) : null
}
