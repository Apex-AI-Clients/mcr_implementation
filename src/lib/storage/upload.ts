import { randomUUID } from 'crypto'
import path from 'path'
import type { SupabaseClient } from '@supabase/supabase-js'
import { SIGNED_URL_EXPIRY_SECONDS } from '@/lib/constants'

const BUCKET = 'documents'

export async function uploadToStorage(
  supabase: SupabaseClient,
  clientId: string,
  originalFilename: string,
  mimeType: string,
  buffer: Buffer,
): Promise<string> {
  const ext = path.extname(originalFilename) || ''
  const storagePath = `${clientId}/${randomUUID()}${ext}`

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, buffer, {
      contentType: mimeType,
      upsert: false,
    })

  if (error) throw error

  return storagePath
}

export async function getSignedUrl(
  supabase: SupabaseClient,
  filePath: string,
): Promise<string> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(filePath, SIGNED_URL_EXPIRY_SECONDS)

  if (error || !data) throw error ?? new Error('Failed to create signed URL')

  return data.signedUrl
}
