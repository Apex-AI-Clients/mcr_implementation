import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fillForm } from './engine'
import { formVersion } from './registry'
import type { FillOptions, FillResult, FormCode, FormData } from './types'

/**
 * Server-only entry point: fills an official ASIC form from its template in
 * src/lib/forms/templates/ (traced into the server build by next.config.ts).
 */

const TEMPLATE_DIR = path.join(process.cwd(), 'src', 'lib', 'forms', 'templates')

/** The official PDFs never change at run time: each is read from disk once. */
const templates = new Map<string, Promise<Uint8Array>>()

export async function readTemplate(code: FormCode, version?: string): Promise<Uint8Array> {
  const { template } = formVersion(code, version)
  let bytes = templates.get(template)
  if (!bytes) {
    bytes = readFile(path.join(TEMPLATE_DIR, template)).then((b) => new Uint8Array(b))
    templates.set(template, bytes)
    bytes.catch(() => templates.delete(template))
  }
  // A copy: pdf-lib may hold on to (or detach) what it is given.
  return (await bytes).slice()
}

export async function fillOfficialForm(
  code: FormCode,
  data: FormData,
  opts: FillOptions & { version?: string } = {},
): Promise<FillResult> {
  const { map } = formVersion(code, opts.version)
  return fillForm(await readTemplate(code, opts.version), map, data, opts)
}
