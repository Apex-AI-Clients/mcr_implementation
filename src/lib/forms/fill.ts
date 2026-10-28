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

export async function readTemplate(code: FormCode, version?: string): Promise<Uint8Array> {
  const { template } = formVersion(code, version)
  return new Uint8Array(await readFile(path.join(TEMPLATE_DIR, template)))
}

export async function fillOfficialForm(
  code: FormCode,
  data: FormData,
  opts: FillOptions & { version?: string } = {},
): Promise<FillResult> {
  const { map } = formVersion(code, opts.version)
  return fillForm(await readTemplate(code, opts.version), map, data, opts)
}
