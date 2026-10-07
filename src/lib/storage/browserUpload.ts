'use client'

import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { MAX_FILE_SIZE_BYTES } from '@/lib/constants'
import type { DocCategory } from '@/lib/constants'

const BUCKET = 'documents'

/**
 * Upload one document for a client: sign, send the bytes straight to Storage,
 * then record it. The file never passes through an API route, so it is not
 * held to Vercel's 4.5 MB request limit — only to MAX_FILE_SIZE_BYTES.
 * Returns the message to show on failure, or null on success.
 */
export async function uploadClientDocument(
  file: File,
  clientId: string,
  category: DocCategory,
): Promise<string | null> {
  if (file.size > MAX_FILE_SIZE_BYTES) return 'File too large. Maximum size is 50MB.'

  const signRes = await fetch('/api/portal/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      doc_category: category,
      filename: file.name,
      file_type: file.type,
      file_size: file.size,
    }),
  })
  const signed = await signRes.json().catch(() => ({}))
  if (!signRes.ok) return signed.error ?? 'Upload failed'

  const { error: uploadError } = await getSupabaseBrowserClient()
    .storage.from(BUCKET)
    .uploadToSignedUrl(signed.path, signed.token, file, { contentType: file.type })
  if (uploadError) {
    console.error('[uploadClientDocument] storage upload failed:', uploadError.message)
    return 'Upload failed. Please try again.'
  }

  const completeRes = await fetch('/api/portal/upload/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      doc_category: category,
      path: signed.path,
      filename: file.name,
    }),
  })
  if (!completeRes.ok) {
    const data = await completeRes.json().catch(() => ({}))
    return data.error ?? 'Upload failed'
  }
  return null
}
