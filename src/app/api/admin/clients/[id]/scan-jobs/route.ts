import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { requireStaffUser } from '@/lib/auth/staff'
import { READER_VERSION } from '@/lib/printed/store'
import { scanJobAlive, SCAN_JOB_MAX_AGE_MS } from '@/lib/scan/jobState'

/**
 * GET — the client's scanned-page readings in progress, for the page to show
 * and poll; and, per document, a reading that stopped without finishing in the
 * last half hour (its latest), with the reason, so the page can say so rather
 * than wait.
 */

interface Params {
  params: Promise<{ id: string }>
}

/** A stopped reading is shown for this long after it stopped. */
const STOPPED_SHOWN_MS = 30 * 60 * 1000

export async function GET(_req: NextRequest, { params }: Params) {
  const staff = await requireStaffUser()
  if (!staff) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id: clientId } = await params
  const supabase = getSupabaseServerClient()
  const { data, error } = await supabase
    .from('scan_read_jobs')
    .select('id, document_id, status, stage, done, total, message, created_at, finished_at')
    .eq('client_id', clientId)
    .eq('reader_version', READER_VERSION)
    .gte('created_at', new Date(Date.now() - SCAN_JOB_MAX_AGE_MS - STOPPED_SHOWN_MS).toISOString())
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ jobs: [], stopped: [] })
  const rows = (data ?? []).map((j) => ({
    id: j.id,
    documentId: j.document_id,
    status: j.status as 'running' | 'done' | 'failed',
    stage: j.stage,
    done: j.done,
    total: j.total,
    message: j.message,
    createdAt: j.created_at,
    finishedAt: j.finished_at,
  }))
  const jobs = rows
    .filter((j) => scanJobAlive(j))
    .map((j) => ({ id: j.id, documentId: j.documentId, status: j.status, stage: j.stage, done: j.done, total: j.total, message: j.message, createdAt: j.createdAt }))
  // The latest reading of each document, when it stopped without finishing.
  const latest = new Map<string, (typeof rows)[number]>()
  for (const r of rows) if (!latest.has(r.documentId)) latest.set(r.documentId, r)
  const stopped = [...latest.values()]
    .filter((r) => r.status === 'failed' && r.finishedAt && Date.now() - Date.parse(r.finishedAt) < STOPPED_SHOWN_MS)
    .map((r) => ({ documentId: r.documentId, message: r.message ?? 'Stopped before it finished.', finishedAt: r.finishedAt as string }))
  return NextResponse.json({ jobs, stopped })
}
