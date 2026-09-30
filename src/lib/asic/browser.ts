import type { AsicExtract } from './types'
import { ASIC_PDF_FIELD, UPLOAD_MESSAGES, checkAsicPdfFile } from './upload'

/**
 * Sending an extract to be read. Browser side.
 *
 * The size and type are checked here first, with the same rules and words as
 * the route. That matters most for size: over 4.5 MB, Vercel answers before the
 * route runs and its answer is not JSON.
 */

export type AsicUploadResult =
  | { ok: true; extract: AsicExtract }
  | { ok: false; message: string }

export async function uploadAsicExtract(file: File): Promise<AsicUploadResult> {
  const refused = checkAsicPdfFile(file)
  if (refused) return { ok: false, message: refused }

  const form = new FormData()
  form.append(ASIC_PDF_FIELD, file)

  let response: Response
  try {
    response = await fetch('/api/asic/extract-pdf', { method: 'POST', body: form })
  } catch {
    return { ok: false, message: 'Could not reach the server. Fill the fields in by hand.' }
  }

  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    // Not JSON: the platform answered instead of the route.
    body = null
  }
  const payload = (body ?? {}) as { extract?: AsicExtract; error?: unknown }

  if (response.ok && payload.extract) return { ok: true, extract: payload.extract }
  if (response.status === 413) return { ok: false, message: UPLOAD_MESSAGES.tooLarge }
  return {
    ok: false,
    message: typeof payload.error === 'string' && payload.error ? payload.error : UPLOAD_MESSAGES.failed,
  }
}
