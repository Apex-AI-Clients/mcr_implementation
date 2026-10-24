import type { getSupabaseServerClient } from '@/lib/supabase/server'
import { DOCUMENT_CATEGORIES, FINANCIAL_STATEMENT_CATEGORIES } from '@/lib/constants'
import { readDirectors } from '@/lib/clients/companyDetails'
import { describeFinancialFiles, failureOf } from '@/lib/financials/financialFiles'
import { exportsLocked, hardCheckFailures } from '@/lib/financials/hardChecks'
import { findLiveComparisonJob } from '@/lib/financials/jobLiveness'
import { periodOverrideOf } from '@/lib/financials/periodOverride'
import { lastReadAt } from '@/lib/financials/readState'
import { loadStoredSlots } from '@/lib/financials/storedStatements'
import type { FinancialDocumentKind, FinancialsComparison, StoredStatementSlot } from '@/lib/financials/types'
import { decideWork } from '@/lib/analysis/autoRun'
import { findActivityStatementCsv } from '@/lib/analysis/lodgementStore'
import { buildDpnPanel, sydneyToday } from '@/lib/dpn/view'
import { computeReadiness, type Readiness } from './readiness'

/**
 * Server-only. Everything computeReadiness needs, read for one client.
 *
 * Reads only what is stored, except in one case: when the newest CSV in the
 * account category has no analysis, it is opened to see whether it is an
 * activity statement export (found by content, not filename).
 */

type ServerClient = ReturnType<typeof getSupabaseServerClient>

export async function loadReadiness(supabase: ServerClient, clientId: string): Promise<Readiness> {
  const [
    { data: client },
    { data: docs },
    slots,
    { data: extractions },
    { data: comparison },
    { data: analyses },
    { data: noticeRows },
    { data: company },
    { data: figuresChecked },
    liveJob,
  ] = await Promise.all([
    supabase
      .from('clients')
      .select('no_dpn_confirmed_at, no_dpn_confirmed_by, no_dpn_cleared_note')
      .eq('id', clientId)
      .maybeSingle(),
    supabase
      .from('documents')
      .select('id, doc_category, original_filename, uploaded_at, file_type, fs_override_kind, fs_override_fy, fs_override_by, fs_override_at')
      .eq('client_id', clientId)
      .order('uploaded_at', { ascending: false }),
    loadStoredSlots(supabase, clientId).catch(() => [] as StoredStatementSlot[]),
    supabase.from('financial_document_extractions').select('document_id, kind, extracted_at, warnings').eq('client_id', clientId),
    supabase.from('financial_comparisons').select('generated_at, stale_since, computed').eq('client_id', clientId).maybeSingle(),
    supabase
      .from('lodgement_analyses')
      .select('id, document_id, analysed_at')
      .eq('client_id', clientId)
      .order('analysed_at', { ascending: false }),
    supabase.from('director_penalty_notices').select('*').eq('client_id', clientId),
    supabase.from('company_details').select('acn_number, directors').eq('client_id', clientId).maybeSingle(),
    supabase
      .from('sbr_readiness_reviews')
      .select('fingerprint, reviewed_by, reviewed_at')
      .eq('client_id', clientId)
      .eq('item', 'financials')
      .maybeSingle(),
    findLiveComparisonJob(supabase, clientId).catch(() => null),
  ])

  const all = docs ?? []
  const isFinancial = (c: string) => (FINANCIAL_STATEMENT_CATEGORIES as readonly string[]).includes(c)

  // ── Financial statements ────────────────────────────────────────────────
  const financialDocs = all.filter((d) => isFinancial(d.doc_category)).reverse()
  // A file read before migration 0026 has no extraction record but supplies
  // statements: that counts as read (readState.ts).
  const extractedAt = lastReadAt(extractions ?? [], slots)

  const work = decideWork({
    dpnDocumentIds: [],
    readNoticeDocumentIds: new Set(),
    activityStatementDocumentId: null,
    analysedDocumentIds: new Set(),
    financialDocuments: financialDocs.map((d) => ({ id: d.id, overrideAt: d.fs_override_at })),
    extractedAt,
    comparison: { exists: comparison !== null, staleSince: comparison?.stale_since ?? null },
  })
  const files = describeFinancialFiles({
    documents: financialDocs.map((d) => ({
      id: d.id,
      filename: d.original_filename,
      override: periodOverrideOf(d),
      overrideBy: d.fs_override_by,
      overrideAt: d.fs_override_at,
    })),
    slots,
    extractions: (extractions ?? []).map((e) => ({
      documentId: e.document_id,
      kind: e.kind as FinancialDocumentKind,
      extractedAt: e.extracted_at,
      failure: failureOf(e.warnings),
    })),
  })

  // A failed hard check nobody has ticked: the same rule as the export lock.
  const failures = hardCheckFailures((comparison?.computed as unknown as FinancialsComparison | null)?.checks)
  const unreviewedFailures = exportsLocked(
    failures,
    comparison?.generated_at ?? null,
    figuresChecked ? { fingerprint: figuresChecked.fingerprint, by: figuresChecked.reviewed_by, at: figuresChecked.reviewed_at } : null,
  )
    ? failures.length
    : 0

  // ── ATO activity statement ──────────────────────────────────────────────
  const csvs = all.filter(
    (d) =>
      d.doc_category === DOCUMENT_CATEGORIES.INTEGRATED_CLIENT_ACCOUNT &&
      (d.file_type === 'text/csv' || d.original_filename.toLowerCase().endsWith('.csv')),
  )
  const latest = analyses?.[0] ?? null
  let lodgementOutOfDate = false
  let noExportFound = false
  // Settled without opening anything when the newest CSV is the one analysed.
  if (csvs.length > 0 && csvs[0].id !== latest?.document_id) {
    const found = await findActivityStatementCsv(supabase, clientId).catch(() => null)
    if (found) lodgementOutOfDate = !(analyses ?? []).some((a) => a.document_id === found.doc.id)
    else noExportFound = !latest
  }

  // ── Director penalty notices ────────────────────────────────────────────
  const panel = buildDpnPanel({
    documents: all
      .filter((d) => d.doc_category === DOCUMENT_CATEGORIES.DIRECTOR_PENALTY_NOTICES)
      .map((d) => ({ id: d.id, originalFilename: d.original_filename })),
    noticeRows: noticeRows ?? [],
    client: client ?? { no_dpn_confirmed_at: null, no_dpn_confirmed_by: null, no_dpn_cleared_note: null },
    file: { acn: company?.acn_number ?? null, directors: readDirectors(company?.directors) },
    todayIso: sydneyToday(),
  })

  return computeReadiness({
    clientId,
    jobRunning: liveJob !== null,
    financials: {
      files,
      comparison: comparison ? { generatedAt: comparison.generated_at, staleSince: comparison.stale_since } : null,
      // Files never read, or a comparison made stale by a change. A file
      // whose read failed is recorded as read-and-failed, and a comparison
      // that could not be built at all is Failed: neither is waiting work.
      outOfDate: work.extract.length > 0 || comparison?.stale_since != null,
      unreviewedFailures,
    },
    lodgement: {
      csvCount: csvs.length,
      analysis: latest ? { id: latest.id, analysedAt: latest.analysed_at } : null,
      outOfDate: lodgementOutOfDate,
      noExportFound,
    },
    dpn: { notices: panel.notices, noneIssued: panel.noneIssued },
  })
}
