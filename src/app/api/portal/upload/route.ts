import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { getPortalClient } from '@/lib/auth/portal'
import { uploadToStorage } from '@/lib/storage/upload'
import {
  CATEGORY_META,
  DOCUMENT_CATEGORIES,
  MAX_FILE_SIZE_BYTES,
  REQUIRED_CATEGORIES,
} from '@/lib/constants'
import type { DocCategory } from '@/lib/constants'

const VALID_CATEGORIES = new Set(Object.values(DOCUMENT_CATEGORIES))

export async function POST(req: NextRequest) {
  try {
    const ctx = await getPortalClient()
    if (!ctx) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const formData = await req.formData()
    const file = formData.get('file') as File | null
    const docCategory = formData.get('doc_category') as string | null

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    if (!docCategory || !VALID_CATEGORIES.has(docCategory as DocCategory)) {
      return NextResponse.json({ error: 'Invalid document category' }, { status: 400 })
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json(
        { error: 'File too large. Maximum size is 50MB.' },
        { status: 413 },
      )
    }

    const meta = CATEGORY_META[docCategory as DocCategory]
    if (!meta.acceptedFormats.includes(file.type)) {
      return NextResponse.json(
        { error: `This category only accepts ${meta.formatLabel} files.` },
        { status: 415 },
      )
    }

    const supabase = getSupabaseServerClient()
    const fileBuffer = Buffer.from(await file.arrayBuffer())
    const filePath = await uploadToStorage(
      supabase,
      ctx.clientId,
      file.name,
      file.type,
      fileBuffer,
    )

    const { data: document, error: docError } = await supabase
      .from('documents')
      .insert({
        client_id: ctx.clientId,
        file_path: filePath,
        original_filename: file.name,
        file_type: file.type,
        file_size_bytes: file.size,
        doc_category: docCategory,
        status: 'ready',
      })
      .select()
      .single()

    if (docError || !document) throw docError

    await updateClientStatus(ctx.clientId)

    return NextResponse.json({ documentId: document.id }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/portal/upload]', err)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
}

async function updateClientStatus(clientId: string) {
  const supabase = getSupabaseServerClient()
  const { data: docs } = await supabase
    .from('documents')
    .select('doc_category')
    .eq('client_id', clientId)
    .neq('status', 'rejected')

  const receivedCategories = new Set((docs ?? []).map((d) => d.doc_category))
  const allRequiredMet = REQUIRED_CATEGORIES.every((c) => receivedCategories.has(c))

  await supabase
    .from('clients')
    .update({ status: allRequiredMet ? 'complete' : 'in_progress' })
    .eq('id', clientId)
}
