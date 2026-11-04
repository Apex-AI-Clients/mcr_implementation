import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { requireStaffUser } from '@/lib/auth/staff'
import { READER_VERSION } from '@/lib/printed/store'
import { scanJobAlive, SCAN_JOB_MAX_AGE_MS } from '@/lib/scan/job'

/** GET — the client's scanned-page readings in progress, for the page to show and poll. */

interface Params {
  params: Promise<{ id: string }>
}

export async function GET(_req: NextRequest, { params }: Params) {
  const staff = await requireStaffUser()
  if (!staff) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id: clientId } = await params
  const supabase = getSupabaseServerClient()
  const { data, error } = await supabase
    .from('scan_read_jobs')
    .select('id, document_id, status, stage, done, total, message, created_at')
    .eq('client_id', clientId)
    .eq('reader_version', READER_VERSION)
    .gte('created_at', new Date(Date.now() - SCAN_JOB_MAX_AGE_MS).toISOString())
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ jobs: [] })
  const jobs = (data ?? [])
    .map((j) => ({ id: j.id, documentId: j.document_id, status: j.status, stage: j.stage, done: j.done, total: j.total, message: j.message, createdAt: j.created_at }))
    .filter((j) => scanJobAlive({ ...j, status: j.status as 'running' }))
  return NextResponse.json({ jobs })
}
