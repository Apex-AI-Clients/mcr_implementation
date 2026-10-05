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
