import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { requireStaffUser } from '@/lib/auth/staff'
import { fileNameFor } from '@/lib/cvl/generate'

export const dynamic = 'force-dynamic'

interface Params {
  params: Promise<{ caseId: string; docId: string }>
}

const LABEL: Record<string, string> = { '509': 'Form 509', '507a': 'Form 507 Part A', '507b': 'Form 507 Part B', all: 'CVL forms' }

/**
 * GET /api/admin/cvl/[caseId]/documents/[docId] — opens a saved CVL PDF with a
 * signed link of 300 seconds (never a public one). ?download=1 saves it.
 */
export async function GET(req: NextRequest, { params }: Params) {
  const staff = await requireStaffUser()
  if (!staff) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { caseId, docId } = await params
  const supabase = getSupabaseServerClient()
  const { data: row } = await supabase
    .from('cvl_generated_documents')
    .select('file_path, form_code, subject, generated_at')
    .eq('id', docId)
    .eq('case_id', caseId)
    .maybeSingle()
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const download = req.nextUrl.searchParams.get('download') === '1'
  const name = fileNameFor(`${LABEL[row.form_code] ?? 'CVL form'} ${row.subject.replace(':', ' ')}`, new Date(row.generated_at))
  const { data, error } = await supabase.storage.from('documents').createSignedUrl(row.file_path, 300, download ? { download: name } : undefined)
  if (error || !data?.signedUrl) return NextResponse.json({ error: 'Could not open the file' }, { status: 500 })
  return NextResponse.redirect(data.signedUrl, 302)
}
