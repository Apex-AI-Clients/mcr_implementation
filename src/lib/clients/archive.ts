import type { Database } from '@/types/database'

/**
 * Archiving client files (migration 0024).
 *
 * A client file never leaves the SBR client list by being destroyed any more.
 * It is archived — hidden from the client list, the dashboard and intake, but
 * kept whole — and from the Archive it is either made a client again or
 * deleted permanently.
 *
 * Two things archive a file:
 *
 *   'client_deleted'  "Archive client" on the client page
 *   'lead_deleted'    the lead it was converted from was deleted
 */

export const ARCHIVE_REASONS = ['client_deleted', 'lead_deleted'] as const
export type ArchiveReason = (typeof ARCHIVE_REASONS)[number]

/** How the Archive says why a file is there. */
export const ARCHIVE_REASON_LABELS: Record<ArchiveReason, string> = {
  client_deleted: 'Archived from the client file',
  lead_deleted: 'Its lead was deleted',
}

/** A stored reason read for display; anything unknown says nothing rather than guess. */
export function archiveReasonLabel(reason: string | null | undefined): string | null {
  return reason && reason in ARCHIVE_REASON_LABELS
    ? ARCHIVE_REASON_LABELS[reason as ArchiveReason]
    : null
}

type ClientUpdate = Database['public']['Tables']['clients']['Update']

/** The columns that archive a file. The database requires the time and reason together. */
export function archiveUpdate(reason: ArchiveReason, by: string, at: Date = new Date()): ClientUpdate {
  return {
    archived_at: at.toISOString(),
    archived_by: by,
    archived_reason: reason,
    updated_at: at.toISOString(),
  }
}

/** The columns that make an archived file a client again. */
export function restoreUpdate(at: Date = new Date()): ClientUpdate {
  return {
    archived_at: null,
    archived_by: null,
    archived_reason: null,
    updated_at: at.toISOString(),
  }
}

/** Where a client file is viewed: the client page, or its Archive page. */
export function clientHref(client: { id: string; archivedAt?: string | null }): string {
  return client.archivedAt ? `/sbr/archive/${client.id}` : `/clients/${client.id}`
}
