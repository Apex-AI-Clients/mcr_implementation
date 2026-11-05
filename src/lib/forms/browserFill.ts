import type { FillResult, FormCode } from './types'

/**
 * Fills an official form in the browser, with the same engine and maps the
 * server uses, so the fill-in screen's preview follows typing without a
 * request per change. The answers are cleaned as the server cleans a draft
 * (cleanAnswers: nothing handwritten, only the form's own fields), so what
 * shows is what Download and the saved PDF print.
 *
 * The template comes once per form version from /api/admin/cvl/templates and
 * is kept for the session (and by the browser's cache after). The engine,
 * maps and pdf-lib load only when a preview is first filled.
 */

const templates = new Map<string, Promise<Uint8Array>>()

function template(code: FormCode, version: string): Promise<Uint8Array> {
  const key = `${code}@${version}`
  let bytes = templates.get(key)
  if (!bytes) {
    bytes = fetch(`/api/admin/cvl/templates/${code}?version=${encodeURIComponent(version)}`)
      .then((res) => {
        if (!res.ok) throw new Error('The form could not be loaded.')
        return res.arrayBuffer()
      })
      .then((b) => new Uint8Array(b))
    templates.set(key, bytes)
    // A failed fetch is tried again next time.
    bytes.catch(() => templates.delete(key))
  }
  return bytes
}

export async function fillInBrowser(code: FormCode, version: string, answers: unknown): Promise<FillResult> {
  const [bytes, { fillForm }, { formVersion }, { cleanAnswers, toFormData }] = await Promise.all([
    template(code, version),
    import('./engine'),
    import('./registry'),
    import('@/lib/cvl/drafts'),
  ])
  const { map } = formVersion(code, version)
  // A copy: pdf-lib may hold on to (or detach) what it is given.
  return fillForm(bytes.slice(), map, toFormData(cleanAnswers(code, version, answers)))
}
