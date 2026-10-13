/**
 * Turns a preview plus the corrections staff ticked into the arguments of
 * sbr_apply_case_import (migration 0028).
 *
 * Details added (business type, number of creditors filled where empty) go in
 * as corrections whose previous value is null, so "Undo this upload" clears
 * them again. A case gets one entry per upload (the table is unique on
 * upload + case), so a ticked correction and a details fill on the same case
 * are merged.
 */
import type { Json } from '@/types/database'
import type { CaseRecord, ImportPreview } from './types'

export interface ImportMeta {
  uploadedBy: string
  uploadedByUserId: string | null
  fileName: string
}

export interface ApplyCorrection {
  case_id: string
  expected: Partial<CaseRecord>
  values: Partial<CaseRecord>
}

export interface ApplyPayload {
  p_import: {
    uploaded_by: string
    uploaded_by_user_id: string | null
    file_name: string
    counts: ImportHistoryCounts
  }
  p_new_cases: CaseRecord[]
  p_corrections: ApplyCorrection[]
}

/** What the upload history shows for one import. */
export interface ImportHistoryCounts {
  added: number
  corrected: number
  details_added: number
  already_have: number
  corrections_not_applied: number
  rejected: number
}

/** A ticked key the preview does not offer as a correction. */
export class UnknownCorrectionError extends Error {}

export function buildApplyPayload(
  preview: ImportPreview,
  ticked: ReadonlySet<string>,
  meta: ImportMeta,
): ApplyPayload {
  const offered = new Map(preview.corrections.map((c) => [c.key, c]))
  for (const key of ticked) {
    if (!offered.has(key)) throw new UnknownCorrectionError(`Not a correction in this upload: ${key}`)
  }

  // A ticked correction of a new case in this file replaces that new case.
  const replaceNew = new Map<string, CaseRecord>()
  const byCase = new Map<string, ApplyCorrection>()
  for (const c of preview.corrections) {
    if (!ticked.has(c.key)) continue
    if (c.caseId === null) replaceNew.set(c.key, c.values as CaseRecord)
    else byCase.set(c.caseId, { case_id: c.caseId, expected: { ...c.expected }, values: { ...c.values } })
  }

  for (const d of preview.detailsAdded) {
    const entry = byCase.get(d.caseId) ?? { case_id: d.caseId, expected: {}, values: {} }
    for (const column of Object.keys(d.values) as (keyof typeof d.values)[]) {
      entry.values[column] = d.values[column] as never
      // Filled only where the case has none.
      entry.expected[column] = null as never
    }
    byCase.set(d.caseId, entry)
  }

  const newCases = preview.added.map((n) => replaceNew.get(n.key) ?? n.record)

  const corrected = preview.corrections.filter((c) => c.caseId !== null && ticked.has(c.key)).length
  return {
    p_import: {
      uploaded_by: meta.uploadedBy,
      uploaded_by_user_id: meta.uploadedByUserId,
      file_name: meta.fileName,
      counts: {
        added: newCases.length,
        corrected,
        details_added: preview.detailsAdded.length,
        already_have: preview.alreadyHave.length,
        corrections_not_applied: preview.corrections.length - ticked.size,
        rejected: preview.rejected.length,
      },
    },
    p_new_cases: newCases,
    p_corrections: [...byCase.values()],
  }
}

/** The RPC takes jsonb; the payload is plain JSON by construction. */
export function toRpcArgs(payload: ApplyPayload) {
  return {
    p_import: payload.p_import as unknown as Json,
    p_new_cases: payload.p_new_cases as unknown as Json,
    p_corrections: payload.p_corrections as unknown as Json,
  }
}
