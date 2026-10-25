import type { getSupabaseServerClient } from '@/lib/supabase/server'
import { DOCUMENT_CATEGORIES, FINANCIAL_STATEMENT_CATEGORIES } from '@/lib/constants'
import { readAndStoreNotice } from '@/lib/dpn/store'
import { analyseAndStoreLodgement, findActivityStatementCsv, type ActivityStatementFile } from './lodgementStore'
import { findLiveComparisonJob, type ExtractError } from '@/lib/financials/jobLiveness'
import { READER_VERSION, readAndStore, type FinancialDocumentRow } from '@/lib/printed/store'

/**
 * Server-only. A client's analyses, run automatically when a document is
 * uploaded or deleted, so that by the time staff open the SBR pages
 * everything is already worked out.
 *
 * Only non-AI work runs here: reading director penalty notices, the
 * lodgement arithmetic, and reading the financial statement PDFs as printed
 * (src/lib/printed, no model). The AI summaries are written when staff open
 * those pages (OpenRouter's retention of ATO data is not yet confirmed —
 * README). The AI statement reader is off (Stage 2b): the comparison is built
 * from the printed reads when its page opens.
 *
 * One job per client (migration 0027): it shares financial_comparison_jobs
 * with the comparison page, so the page shows and follows it, and a second
 * trigger while one runs does not start another. The running job checks for
 * new work before it finishes, so a file uploaded or deleted meanwhile is
 * still picked up.
 */

type ServerClient = ReturnType<typeof getSupabaseServerClient>

// ─── What is out of date ──────────────────────────────────────────────────────

export interface AnalysisSnapshot {
  /** Director penalty notice PDFs, and those already read (or entered). */
  dpnDocumentIds: string[]
  readNoticeDocumentIds: ReadonlySet<string>
  /** The newest activity statement export, and the documents with an analysis. */
  activityStatementDocumentId: string | null
  analysedDocumentIds: ReadonlySet<string>
  /** Financial statement files, each with when its override was set. */
  financialDocuments: { id: string; overrideAt: string | null }[]
  /** When each financial statement file was last extracted. */
  extractedAt: ReadonlyMap<string, string>
  /** The stored comparison: absent, current, or stale since a file changed. */
  comparison: { exists: boolean; staleSince: string | null }
}

export interface AnalysisWork {
  /** DPN files to read. */
  dpn: string[]
  /** Whether to analyse the activity statement export. */
  lodgement: boolean
  /** Financial statement files to extract: never read, or overridden since. */
  extract: string[]
  /** Whether to rebuild the comparison. */
  compare: boolean
}

/** What this run has already tried, so a step that fails is not retried in a loop. */
export interface Attempted {
  dpn: Set<string>
  extract: Set<string>
  lodgement: boolean
  compare: boolean
}

export function newAttempted(): Attempted {
  return { dpn: new Set(), extract: new Set(), lodgement: false, compare: false }
}

/** What is out of date, leaving out anything this run already tried. Pure. */
export function decideWork(s: AnalysisSnapshot, attempted: Attempted = newAttempted()): AnalysisWork {
  const dpn = s.dpnDocumentIds.filter((id) => !s.readNoticeDocumentIds.has(id) && !attempted.dpn.has(id))

  const lodgement =
    !attempted.lodgement &&
    s.activityStatementDocumentId !== null &&
    !s.analysedDocumentIds.has(s.activityStatementDocumentId)

  const extract = s.financialDocuments
    .filter((doc) => {
      if (attempted.extract.has(doc.id)) return false
      const at = s.extractedAt.get(doc.id)
      return !at || (doc.overrideAt !== null && doc.overrideAt > at)
    })
    .map((doc) => doc.id)

  const anyExtracted = s.financialDocuments.some((doc) => s.extractedAt.has(doc.id))
  const compare =
    !attempted.compare &&
    s.financialDocuments.length > 0 &&
    (extract.length > 0 || s.comparison.staleSince !== null || (!s.comparison.exists && anyExtracted))

  return { dpn, lodgement, extract, compare }
}

export function hasWork(work: AnalysisWork): boolean {
  return work.dpn.length > 0 || work.lodgement || work.extract.length > 0 || work.compare
}

/** The snapshot, read from the database (and the activity statement found by content). */
async function loadSnapshot(
  supabase: ServerClient,
  clientId: string,
): Promise<{ snapshot: AnalysisSnapshot; activityStatement: ActivityStatementFile | null }> {
  const [{ data: docs }, { data: notices }, { data: analyses }, { data: reads }] = await Promise.all([
    supabase
      .from('documents')
      .select('id, doc_category, fs_override_at')
      .eq('client_id', clientId),
    supabase.from('director_penalty_notices').select('document_id').eq('client_id', clientId),
    supabase.from('lodgement_analyses').select('document_id').eq('client_id', clientId),
    // Before migration 0033 there is no table: every PDF reads as unread, and is read (but not kept).
    supabase.from('printed_reads').select('document_id, reader_version, read_at').eq('client_id', clientId),
  ])

  const all = docs ?? []
  const hasAccountFiles = all.some((d) => d.doc_category === DOCUMENT_CATEGORIES.INTEGRATED_CLIENT_ACCOUNT)
  const activityStatement = hasAccountFiles ? await findActivityStatementCsv(supabase, clientId) : null

  return {
    activityStatement,
    snapshot: {
      dpnDocumentIds: all.filter((d) => d.doc_category === DOCUMENT_CATEGORIES.DIRECTOR_PENALTY_NOTICES).map((d) => d.id),
      readNoticeDocumentIds: new Set((notices ?? []).map((n) => n.document_id)),
      activityStatementDocumentId: activityStatement?.doc.id ?? null,
      analysedDocumentIds: new Set((analyses ?? []).map((a) => a.document_id)),
      financialDocuments: all
        .filter((d) => (FINANCIAL_STATEMENT_CATEGORIES as readonly string[]).includes(d.doc_category))
        .map((d) => ({ id: d.id, overrideAt: d.fs_override_at })),
      // Read by the current printed reader (a newer reader reads again).
      extractedAt: new Map((reads ?? []).filter((r) => r.reader_version === READER_VERSION).map((r) => [r.document_id, r.read_at])),
      // Nothing to build or keep: the comparison is built from the reads when its page opens.
      comparison: { exists: true, staleSince: null },
    },
  }
}

// ─── Running it ───────────────────────────────────────────────────────────────

/** Passes over the work before giving the rest to the next trigger. */
const MAX_PASSES = 4

export interface AutoRunSummary {
  /** What the run tried, so the follow-up check only acts on work that is new. */
  attempted: Attempted
  dpnRead: number
  lodgementAnalysed: boolean
  extracted: number
  compared: boolean
  errors: ExtractError[]
  notes: string[]
}

/**
 * Do whatever is out of date, cheapest first, and look again until nothing
 * is (or this run has tried it all). Never throws: the job row says how it
 * went.
 */
export async function runAutoAnalysis(params: {
  jobId: string
  clientId: string
  supabase: ServerClient
}): Promise<AutoRunSummary> {
  const { jobId, clientId, supabase } = params
  const attempted = newAttempted()
  const summary: AutoRunSummary = {
    attempted,
    dpnRead: 0,
    lodgementAnalysed: false,
    extracted: 0,
    compared: false,
    errors: [],
    notes: [],
  }
  const stamp = () => new Date().toISOString()

  await supabase
    .from('financial_comparison_jobs')
    .update({ status: 'processing', started_at: stamp(), updated_at: stamp() })
    .eq('id', jobId)

  try {
    for (let pass = 0; pass < MAX_PASSES; pass++) {
      const { snapshot, activityStatement } = await loadSnapshot(supabase, clientId)
      const work = decideWork(snapshot, attempted)
      if (!hasWork(work)) break
      console.log(
        `[auto-run] job=${jobId} pass=${pass + 1} dpn=${work.dpn.length} lodgement=${work.lodgement} extract=${work.extract.length} compare=${work.compare}`,
      )

      // 1. Director penalty notices: in memory, no AI, about a second each.
      if (work.dpn.length > 0) {
        const { data: dpnDocs } = await supabase
          .from('documents')
          .select('id, client_id, file_path')
          .in('id', work.dpn)
        for (const doc of dpnDocs ?? []) {
          attempted.dpn.add(doc.id)
          const outcome = await readAndStoreNotice(supabase, doc)
          if (outcome.kind === 'stored') summary.dpnRead++
        }
      }

      // 2. Lodgement arithmetic. No AI summary here.
      if (work.lodgement && activityStatement) {
        attempted.lodgement = true
        const outcome = await analyseAndStoreLodgement(supabase, clientId, activityStatement, { aiSummary: false })
        if (outcome.ok) summary.lodgementAnalysed = true
        else summary.notes.push(`Lodgement analysis: ${outcome.error}`)
      }

      // 3. Financial statements: each new PDF read as printed (well under a
      // second each, no model). The comparison is built when its page opens.
      if (work.extract.length > 0) {
        work.extract.forEach((id) => attempted.extract.add(id))
        const { data: rows } = await supabase
          .from('documents')
          .select('id, original_filename, uploaded_at, file_path')
          .in('id', work.extract)
        for (const doc of (rows ?? []) as FinancialDocumentRow[]) {
          const { read } = await readAndStore(supabase, clientId, doc)
          if (read.status === 'read') summary.extracted++
          else summary.notes.push(`${doc.original_filename}: ${read.issues.map((i) => i.message).join(' ') || read.status}`)
        }
      }
    }

    await supabase
      .from('financial_comparison_jobs')
      .update({
        status: 'done',
        // No stored comparison any more: it is built from the printed reads when its page opens.
        result: null,
        extract_errors: summary.errors as unknown as Record<string, unknown>[],
        error: null,
        updated_at: stamp(),
        finished_at: stamp(),
      })
      .eq('id', jobId)
    console.log(
      `[auto-run] DONE job=${jobId} dpn=${summary.dpnRead} lodgement=${summary.lodgementAnalysed} extracted=${summary.extracted} compared=${summary.compared} errors=${summary.errors.length}`,
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[auto-run] FAILED job=${jobId}: ${message}`)
    await supabase
      .from('financial_comparison_jobs')
      .update({ status: 'failed', error: message, updated_at: stamp(), finished_at: stamp() })
      .eq('id', jobId)
  }
  return summary
}

/** Something that runs work after the response: Next's after(), or a test's stand-in. */
export type Scheduler = (task: () => Promise<unknown>) => void

/**
 * Start a run for this client unless one is already going, which will pick
 * the new work up before it finishes. Returns the job that is (or will be)
 * doing it.
 *
 * When the run ends, it looks once more: a file that arrived between its last
 * pass and its finishing gets a run of its own.
 */
export async function scheduleClientAnalysis(
  supabase: ServerClient,
  clientId: string,
  schedule: Scheduler,
): Promise<{ jobId: string | null; started: boolean }> {
  const live = await findLiveComparisonJob(supabase, clientId)
  if (live) return { jobId: live.id, started: false }

  const { data: job, error } = await supabase
    .from('financial_comparison_jobs')
    .insert({ client_id: clientId, status: 'pending', mode: 'full' })
    .select('id')
    .single()
  if (error?.code === '23505') {
    // Another trigger won the race; its run will see this work.
    const running = await findLiveComparisonJob(supabase, clientId)
    return { jobId: running?.id ?? null, started: false }
  }
  if (error || !job) {
    console.error('[auto-run] could not create a job', error?.code)
    return { jobId: null, started: false }
  }

  schedule(async () => {
    const { attempted } = await runAutoAnalysis({ jobId: job.id, clientId, supabase })
    // Work that arrived after the run's last pass. Not work it already tried
    // and failed (an unreadable file): retrying that here would loop.
    const { snapshot } = await loadSnapshot(supabase, clientId)
    if (hasWork(decideWork(snapshot, attempted))) {
      // Awaited: this runs inside the request's after(), which ends when this
      // callback does.
      let followUp: Promise<unknown> | null = null
      await scheduleClientAnalysis(supabase, clientId, (task) => {
        followUp = task()
      })
      if (followUp) await followUp
    }
  })
  return { jobId: job.id, started: true }
}

/** Whether a change to a document in this category calls for a run. */
export function categoryTriggersAnalysis(category: string): boolean {
  return (
    category === DOCUMENT_CATEGORIES.DIRECTOR_PENALTY_NOTICES ||
    category === DOCUMENT_CATEGORIES.INTEGRATED_CLIENT_ACCOUNT ||
    (FINANCIAL_STATEMENT_CATEGORIES as readonly string[]).includes(category)
  )
}

