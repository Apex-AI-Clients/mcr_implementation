import type { getSupabaseServerClient } from '@/lib/supabase/server'

/**
 * Server-only. The state of scanned-page readings (scan_read_jobs), for the
 * pages and routes that show or start them. Light: no reader in here.
 */

type ServerClient = ReturnType<typeof getSupabaseServerClient>

/** A job older than this that never finished is dead (maxDuration 800s, as jobLiveness.ts). */
export const SCAN_JOB_MAX_AGE_MS = 14 * 60 * 1000

export interface ScanJob {
  id: string
  status: 'running' | 'done' | 'failed'
  stage: string | null
  done: number
  total: number
  message: string | null
  createdAt: string
}

export async function latestScanJob(supabase: ServerClient, documentId: string, readerVersion: string): Promise<ScanJob | null> {
  const { data, error } = await supabase
    .from('scan_read_jobs')
    .select('id, status, stage, done, total, message, created_at')
    .eq('document_id', documentId)
    .eq('reader_version', readerVersion)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error || !data) return null
  return { id: data.id, status: data.status as ScanJob['status'], stage: data.stage, done: data.done, total: data.total, message: data.message, createdAt: data.created_at }
}

export const scanJobAlive = (job: ScanJob | null, now = Date.now()) => !!job && job.status === 'running' && now - Date.parse(job.createdAt) < SCAN_JOB_MAX_AGE_MS

