/**
 * The uploaded file out of a multipart request, for the preview and confirm
 * routes. Refuses an oversized body before reading it, when the client says
 * how big it is.
 */
import { MAX_UPLOAD_BYTES } from './config'

/** The form field the page sends the file in. */
export const UPLOAD_FIELD = 'file'
/** The form field the confirm step sends the ticked corrections in (JSON array of keys). */
export const TICKED_FIELD = 'corrections'

/** Room for the multipart envelope around a file that is itself within the limit. */
const MULTIPART_OVERHEAD_BYTES = 64 * 1024

export type UploadRead =
  | { ok: true; bytes: Uint8Array; fileName: string; form: FormData }
  | { ok: false; status: number; error: string }

export async function readUpload(req: Request): Promise<UploadRead> {
  const tooLarge = { ok: false, status: 413, error: 'The file is larger than 5 MB.' } as const
  const declared = Number(req.headers.get('content-length') ?? 0)
  if (declared > MAX_UPLOAD_BYTES + MULTIPART_OVERHEAD_BYTES) return tooLarge

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return { ok: false, status: 400, error: 'Choose a file to upload.' }
  }
  const file = form.get(UPLOAD_FIELD)
  if (!file || typeof file === 'string') return { ok: false, status: 400, error: 'Choose a file to upload.' }
  if (file.size > MAX_UPLOAD_BYTES) return tooLarge

  // Only the last path segment: some browsers send a full path.
  const fileName = (file.name || 'upload').split(/[\/]/).pop()!.slice(0, 255)
  return { ok: true, bytes: new Uint8Array(await file.arrayBuffer()), fileName, form }
}
