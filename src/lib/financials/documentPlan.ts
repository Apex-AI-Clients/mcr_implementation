import type { FinancialsPrepass } from './prepass'
import type { ExtractionWarning } from './types'

/**
 * Whether a financials document goes to the model at all, from its pre-pass.
 * Pure.
 *
 * Only positive evidence stops it: a trust deed, licence or company extract
 * (not_financial), or a tax return with no statements (tax_return_only). Their
 * figures must never be stored as statements. Anything the pre-pass could not
 * read goes to the model exactly as it did before, with a warning saying the
 * pages could not be checked.
 */

export interface DocumentPlan {
  extract: boolean
  warnings: ExtractionWarning[]
}

export function planDocument(prepass: FinancialsPrepass): DocumentPlan {
  const { classification, failure } = prepass

  if (classification.kind === 'not_financial') {
    return {
      extract: false,
      warnings: [
        {
          kind: 'document_kind',
          message:
            'This file does not look like financial statements (it reads as a trust deed, licence or company extract). Nothing was extracted from it.',
        },
      ],
    }
  }
  if (classification.kind === 'tax_return_only') {
    return {
      extract: false,
      warnings: [
        {
          kind: 'document_kind',
          message:
            'This file holds a tax return but no Income Statement or Balance Sheet. Tax return figures are not used, so nothing was extracted from it.',
        },
      ],
    }
  }

  const reason: Record<NonNullable<typeof failure>, string> = {
    password_protected: 'The PDF needs a password to open, so its pages could not be checked first.',
    no_text_layer: 'The PDF has no text layer (it may be a scan), so its pages could not be checked first.',
    unreadable: 'The PDF could not be read on our side, so its pages could not be checked first.',
    too_long: 'The PDF is too long to check page by page first.',
  }
  return {
    extract: true,
    warnings: failure ? [{ kind: 'page_selection', message: `${reason[failure]} The whole file was sent.` }] : [],
  }
}

// ─── Columns the headings promise ─────────────────────────────────────────────

export interface ExpectedColumn {
  financialYear: number
  sourceColumn: 'primary' | 'comparative' | 'current_period'
}

/**
 * The columns this document's own text shows: each annual heading year as a
 * primary column, a column-header year one before it as the comparative, and
 * a current-period heading. Nothing for a document the pre-pass could not read.
 */
export function expectedColumns(prepass: FinancialsPrepass): ExpectedColumn[] {
  const c = prepass.classification
  if (c.kind === 'unknown' || c.kind === 'not_financial' || c.kind === 'tax_return_only') return []
  const out: ExpectedColumn[] = c.headingYears.map((y) => ({ financialYear: y, sourceColumn: 'primary' as const }))
  for (const y of c.comparativeYears) {
    if (c.headingYears.includes(y + 1)) out.push({ financialYear: y, sourceColumn: 'comparative' })
  }
  if (c.currentPeriodYear !== null) out.push({ financialYear: c.currentPeriodYear, sourceColumn: 'current_period' })
  return out
}

/** Expected columns the extraction did not return. */
export function missingColumns(
  expected: ExpectedColumn[],
  returned: Array<{ financialYear: number; sourceColumn: string }>,
): ExpectedColumn[] {
  return expected.filter(
    (e) => !returned.some((r) => r.financialYear === e.financialYear && r.sourceColumn === e.sourceColumn),
  )
}
