import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { requireStaffUser } from '@/lib/auth/staff'
import { FINANCIAL_STATEMENT_CATEGORIES } from '@/lib/constants'
import { cropBand, extractPageImage, openPdf } from '@/lib/scan/pageImages'

/**
 * GET — the crop of a scanned line beside its figure: a band of the page
 * image, made here from the PDF in our storage, in memory. Never stored, never
 * logged, never cached.
 *   ?documentId=…&page=7&top=0.31&bottom=0.33
 */

export const maxDuration = 30

interface Params {
  params: Promise<{ id: string }>
}

export async function GET(req: NextRequest, { params }: Params) {
  const staff = await requireStaffUser()
  if (!staff) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id: clientId } = await params
  const q = req.nextUrl.searchParams
  const documentId = q.get('documentId') ?? ''
  const page = Number(q.get('page'))
  const top = Number(q.get('top'))
  const bottom = Number(q.get('bottom'))
  if (!/^[0-9a-f-]{36}$/i.test(documentId) || !Number.isInteger(page) || page < 1 || !(top >= 0 && bottom <= 1 && bottom > top)) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  const supabase = getSupabaseServerClient()
  const { data: doc } = await supabase
    .from('documents')
    .select('file_path')
    .eq('id', documentId)
    .eq('client_id', clientId)
    .in('doc_category', FINANCIAL_STATEMENT_CATEGORIES as string[])
    .maybeSingle()
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  try {
    const { data: blob, error } = await supabase.storage.from('documents').download(doc.file_path)
    if (error || !blob) throw new Error('download')
    const pdf = await openPdf(new Uint8Array(await blob.arrayBuffer()))
    if (page > pdf.getPageCount()) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const png = await cropBand(await extractPageImage(pdf, page - 1), [top, bottom])
    return new NextResponse(Buffer.from(png), { headers: { 'content-type': 'image/png', 'cache-control': 'private, no-store' } })
  } catch {
    return NextResponse.json({ error: 'The crop could not be made.' }, { status: 422 })
  }
}
