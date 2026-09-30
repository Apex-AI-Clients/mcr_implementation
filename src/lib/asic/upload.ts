/**
 * The rules for uploading an ASIC extract, shared by the browser and the route.
 *
 * Pure, so the form can refuse a file before sending it with the same limits
 * and the same words the route would use. The browser check is the one that
 * matters most for size: Vercel rejects a body over 4.5 MB before the route
 * runs, and its answer is not JSON, so an oversized file that got as far as the
 * network would surface as an unreadable error.
 */

/** 4 MB. A real extract is around 100 KB; this stays under Vercel's 4.5 MB body limit. */
export const ASIC_PDF_MAX_BYTES = 4 * 1024 * 1024

export const ASIC_PDF_MIME = 'application/pdf'

/** The form field the file is sent in. */
export const ASIC_PDF_FIELD = 'file'

export const UPLOAD_MESSAGES = {
  missing: 'Choose the ASIC extract PDF to upload.',
  empty: 'That file is empty.',
  tooLarge: 'That file is over 4 MB. An ASIC company extract is far smaller — check it is the right PDF.',
  notPdf: 'That is not a PDF. Upload the ASIC Current Company Extract as a PDF.',
  unreadable:
    "This PDF couldn't be opened. It may be damaged or password-protected. Fill the fields in by hand.",
  tooManyPages:
    'This PDF has too many pages to be an ASIC company extract. Fill the fields in by hand.',
  failed: "The extract couldn't be read. Fill the fields in by hand.",
} as const

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d] // "%PDF-"

/** Whether the bytes begin with the PDF header. A renamed file does not. */
export function hasPdfMagic(bytes: Uint8Array): boolean {
  return PDF_MAGIC.every((byte, index) => bytes[index] === byte)
}

/**
 * What can be checked from the file's own description, before reading it.
 * Returns the message to show, or null when the file may be sent.
 */
export function checkAsicPdfFile(file: { size: number; type: string }): string | null {
  if (file.size === 0) return UPLOAD_MESSAGES.empty
  if (file.size > ASIC_PDF_MAX_BYTES) return UPLOAD_MESSAGES.tooLarge
  if (file.type !== ASIC_PDF_MIME) return UPLOAD_MESSAGES.notPdf
  return null
}
