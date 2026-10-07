import { randomUUID } from 'crypto'
import path from 'path'
import type { SupabaseClient } from '@supabase/supabase-js'
import { SIGNED_URL_EXPIRY_SECONDS } from '@/lib/constants'

const BUCKET = 'documents'

/**
 * A one-time URL the browser uploads the file to directly. Large files cannot
 * pass through an API route — Vercel refuses request bodies over 4.5 MB — so
 * the route only signs the upload and the bytes go straight to Storage.
 */
export async function createUploadTarget(
  supabase: SupabaseClient,
  clientId: string,
  originalFilename: string,
): Promise<{ path: string; token: string }> {
  const ext = path.extname(originalFilename) || ''
  const storagePath = `${clientId}/${randomUUID()}${ext}`

  const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(storagePath)
  if (error || !data) throw error ?? new Error('Failed to create signed upload URL')

  return { path: data.path, token: data.token }
}

/** Size and content type of a stored object, or null when it is not there. */
export async function getStoredObjectInfo(
  supabase: SupabaseClient,
  filePath: string,
): Promise<{ size: number; contentType: string } | null> {
  const { data, error } = await supabase.storage.from(BUCKET).info(filePath)
  if (error || !data) return null
  return { size: data.size ?? 0, contentType: data.contentType ?? '' }
}

export async function removeFromStorage(supabase: SupabaseClient, filePath: string) {
  await supabase.storage.from(BUCKET).remove([filePath])
}

export async function getSignedUrl(
  supabase: SupabaseClient,
  filePath: string,
  downloadName?: string,
): Promise<string> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(filePath, SIGNED_URL_EXPIRY_SECONDS, {
      download: downloadName ?? true,
    })

  if (error || !data) throw error ?? new Error('Failed to create signed URL')

  return data.signedUrl
}
