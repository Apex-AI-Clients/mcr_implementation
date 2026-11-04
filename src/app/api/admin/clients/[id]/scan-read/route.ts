import { after, NextRequest, NextResponse } from 'next/server'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { requireStaffUser } from '@/lib/auth/staff'
import { loadFinancialDocuments, loadStoredReads, READER_VERSION } from '@/lib/printed/store'
import { closeDeadScanJobs, latestScanJob, runScanJob, scanJobAlive } from '@/lib/scan/job'

/**
 * POST — reads the client's scanned statement pages (src/lib/scan): every
 * financial PDF whose read says 'scan_pending' and has no reading running.
 * Answers at once; the reading runs after the response, one file after
 * another (progress: GET scan-jobs). A failed or dead reading is started again.
 * Two requests at once never read a file twice: the database allows one
 * running reading per file (migration 0045).
 *
 * The only route that carries the scan reader: Tesseract and its English
 * model are traced into this function alone (next.config.ts).
 */

export const maxDuration = 800

interface Params {
  params: Promise<{ id: string }>
}

export async function POST(_req: NextRequest, { params }: Params) {
  const staff = await requireStaffUser()
  if (!staff) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id: clientId } = await params
  const supabase = getSupabaseServerClient()
  try {
    const [docs, reads] = await Promise.all([loadFinancialDocuments(supabase, clientId), loadStoredReads(supabase, clientId), closeDeadScanJobs(supabase, clientId)])
    const waiting: typeof docs = []
    for (const doc of docs) {
      if (reads.get(doc.id)?.read.status !== 'scan_pending') continue
      const job = await latestScanJob(supabase, doc.id, READER_VERSION)
      if (scanJobAlive(job) || job?.status === 'done') continue
      waiting.push(doc)
    }
    if (waiting.length) {
      after(async () => {
        for (const doc of waiting) await runScanJob(supabase, { clientId, documentId: doc.id, filePath: doc.file_path, readerVersion: READER_VERSION })
      })
    }
    return NextResponse.json({ started: waiting.length })
  } catch (err) {
    console.error('[POST scan-read]', err instanceof Error ? err.message : 'unknown')
    return NextResponse.json({ error: 'Failed to start reading the scanned pages' }, { status: 500 })
  }
}
