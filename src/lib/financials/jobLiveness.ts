/**
 * Whether a comparison job can still be running.
 *
 * The job runs inside the start request's function (Next.js after()), which
 * Vercel ends at maxDuration (800s) from the request. A job row still marked
 * 'pending' or 'processing' after that is dead: the instance was stopped
 * (a redeploy, a crash, the platform recycling it) before the job could mark
 * itself failed. Nothing else would ever close it, so the page would poll it
 * forever.
 */
import type { getSupabaseServerClient } from '@/lib/supabase/server'

type SupabaseClient = ReturnType<typeof getSupabaseServerClient>

/** maxDuration (800s) plus a margin for the row being written just before the run. */
export const JOB_MAX_AGE_MS = 14 * 60 * 1000

export const DEAD_JOB_MESSAGE =
  'The run stopped without finishing (the server ended it before it could report back). Please run it again.'

export function isJobDead(
  job: { status: string; created_at: string },
  now: number = Date.now(),
): boolean {
  if (job.status !== 'pending' && job.status !== 'processing') return false
  return now - new Date(job.created_at).getTime() > JOB_MAX_AGE_MS
}

/**
 * Mark a dead job failed. Only while it is still active, so a job that did
 * finish in the meantime keeps its result.
 */
export async function closeDeadJob(supabase: SupabaseClient, jobId: string): Promise<void> {
  const now = new Date().toISOString()
  const { error } = await supabase
    .from('financial_comparison_jobs')
    .update({ status: 'failed', error: DEAD_JOB_MESSAGE, updated_at: now, finished_at: now })
    .eq('id', jobId)
    .in('status', ['pending', 'processing'])
  if (error) console.error(`[comparison-job] could not close dead job=${jobId}: ${error.message}`)
  else console.warn(`[comparison-job] closed dead job=${jobId} (older than ${JOB_MAX_AGE_MS / 60_000} min, never finished)`)
}
