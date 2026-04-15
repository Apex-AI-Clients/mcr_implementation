import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { isTokenExpired } from '@/lib/tokens'
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
    const token = req.headers.get('x-client-token')
    if (!token) {
      return NextResponse.json({ error: 'Missing client token' }, { status: 401 })
    }

    const supabase = await getSupabaseServerClient()

    // Validate token
    const { data: client, error: clientError } = await supabase
      .from('clients')
      .select('id, magic_link_token, link_expires_at')
      .eq('magic_link_token', token)
      .single()

    if (clientError || !client) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
    }

    if (isTokenExpired(client.link_expires_at)) {
      return NextResponse.json({ error: 'Token expired' }, { status: 410 })
    }

    // Parse form data
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
      return NextResponse.json({ error: 'File too large. Maximum size is 50MB.' }, { status: 413 })
    }

    // Validate MIME type against category's accepted formats
    const meta = CATEGORY_META[docCategory as DocCategory]
    if (!meta.acceptedFormats.includes(file.type)) {
      return NextResponse.json(
        { error: `This category only accepts ${meta.formatLabel} files.` },
        { status: 415 },
      )
    }

    const fileBuffer = Buffer.from(await file.arrayBuffer())

    // Upload to Supabase Storage
    const filePath = await uploadToStorage(supabase, client.id, file.name, file.type, fileBuffer)

    // Create document record (marked ready immediately — no AI processing step)
    const { data: document, error: docError } = await supabase
      .from('documents')
      .insert({
        client_id: client.id,
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

    // Recompute client status based on newly-uploaded set
    await updateClientStatus(client.id)

    return NextResponse.json({ documentId: document.id }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/portal/upload]', err)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
}

async function updateClientStatus(clientId: string) {
  const supabase = await getSupabaseServerClient()
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
