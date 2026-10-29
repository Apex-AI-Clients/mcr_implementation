import type { Database } from '@/types/database'

/**
 * CVL client files (migration 0039): one case per file, with its status.
 *
 *   draft → forms_prepared → printed
 *
 * Each step records its date. A step back clears the dates after it (the
 * database refuses a status without its dates, or with later ones), so
 * reopening a printed file for changes says so plainly instead of keeping a
 * "printed" date that no longer describes the forms.
 */

export const CVL_STATUSES = ['draft', 'forms_prepared', 'printed'] as const
export type CvlStatus = (typeof CVL_STATUSES)[number]

export const CVL_STATUS_LABELS: Record<CvlStatus, string> = {
  draft: 'Draft',
  forms_prepared: 'Forms prepared',
  printed: 'Printed',
}

export type CvlOrigin = 'lead' | 'sbr_client'

export const CVL_ORIGIN_LABELS: Record<CvlOrigin, string> = {
  lead: 'From a lead',
  sbr_client: 'From SBR',
}

export interface CvlCase {
  id: string
  clientId: string
  origin: CvlOrigin
  status: CvlStatus
  formsPreparedAt: string | null
  printedAt: string | null
  sbrArchivedAt: string | null
  sbrArchivedBy: string | null
  createdBy: string
  createdAt: string
}

type CaseRow = Database['public']['Tables']['cvl_cases']['Row']
type CaseUpdate = Database['public']['Tables']['cvl_cases']['Update']

export function isCvlStatus(value: unknown): value is CvlStatus {
  return typeof value === 'string' && (CVL_STATUSES as readonly string[]).includes(value)
}

/** A stored status read safely: anything unknown reads as Draft rather than claim progress. */
export function readCvlStatus(value: string | null | undefined): CvlStatus {
  return isCvlStatus(value) ? value : 'draft'
}

export function toCvlCase(row: CaseRow): CvlCase {
  return {
    id: row.id,
    clientId: row.client_id,
    origin: row.origin === 'sbr_client' ? 'sbr_client' : 'lead',
    status: readCvlStatus(row.status),
    formsPreparedAt: row.forms_prepared_at,
    printedAt: row.printed_at,
    sbrArchivedAt: row.sbr_archived_at,
    sbrArchivedBy: row.sbr_archived_by,
    createdBy: row.created_by,
    createdAt: row.created_at,
  }
}

/**
 * The columns that move a case to `next`. Dates already set for steps that
 * stay done are kept; steps undone lose theirs; a new step is stamped `at`.
 * Moving to the status it already has changes nothing (null).
 */
export function statusUpdate(
  current: Pick<CvlCase, 'status' | 'formsPreparedAt' | 'printedAt'>,
  next: CvlStatus,
  at: Date = new Date(),
): CaseUpdate | null {
  if (current.status === next) return null
  const iso = at.toISOString()
  switch (next) {
    case 'draft':
      return { status: next, forms_prepared_at: null, printed_at: null }
    case 'forms_prepared':
      return { status: next, forms_prepared_at: current.formsPreparedAt ?? iso, printed_at: null }
    case 'printed':
      return { status: next, forms_prepared_at: current.formsPreparedAt ?? iso, printed_at: iso }
  }
}
