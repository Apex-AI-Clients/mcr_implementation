import { CATEGORY_META, DOCUMENT_CATEGORIES, MAX_FILE_SIZE_BYTES } from '@/lib/constants'
import type { DocCategory } from '@/lib/constants'

const VALID_CATEGORIES = new Set<string>(Object.values(DOCUMENT_CATEGORIES))

export function isDocCategory(value: unknown): value is DocCategory {
  return typeof value === 'string' && VALID_CATEGORIES.has(value)
}

/**
 * The checks every document upload passes: a known category, a size within
 * the limit, and a format the category accepts. Shared by the route that signs
 * the upload and the one that records it, which re-checks the stored object.
 */
export function checkUploadRequest(input: {
  docCategory: unknown
  fileType: unknown
  fileSize: unknown
}): { error: string; status: number } | null {
  if (!isDocCategory(input.docCategory)) {
    return { error: 'Invalid document category', status: 400 }
  }
  if (typeof input.fileSize !== 'number' || input.fileSize <= 0) {
    return { error: 'That file is empty.', status: 400 }
  }
  if (input.fileSize > MAX_FILE_SIZE_BYTES) {
    return { error: 'File too large. Maximum size is 50MB.', status: 413 }
  }
  const meta = CATEGORY_META[input.docCategory]
  if (typeof input.fileType !== 'string' || !meta.acceptedFormats.includes(input.fileType)) {
    return { error: `This category only accepts ${meta.formatLabel} files.`, status: 415 }
  }
  return null
}
