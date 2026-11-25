import parta20220801 from './maps/form507-parta-20220801.json'
import partb20220801 from './maps/form507-partb-20220801.json'
import f509v2011 from './maps/form509-2011.json'
import type { FormCode, FormMap } from './types'

/**
 * Every form the app can fill, by code AND version: a saved draft or a
 * generated PDF records its version, so if ASIC replaces a form the old
 * records still map onto the template they were written for.
 *
 * Adding a version = its official PDF in templates/, its map in maps/, an
 * entry here, and CURRENT_VERSION moved once it is checked.
 */

interface FormVersion {
  map: FormMap
  /** File in src/lib/forms/templates/: the official ASIC PDF, unchanged. */
  template: string
}

const FORMS: Record<FormCode, Record<string, FormVersion>> = {
  '509': {
    '2011': { map: f509v2011 as unknown as FormMap, template: 'asic-form-509-2011.pdf' },
  },
  '507a': {
    '20220801': { map: parta20220801 as unknown as FormMap, template: 'asic-form-507-parta-20220801.pdf' },
  },
  '507b': {
    '20220801': { map: partb20220801 as unknown as FormMap, template: 'asic-form-507-partb-20220801.pdf' },
  },
}

/** The version new drafts use. */
export const CURRENT_VERSION: Record<FormCode, string> = {
  '509': '2011',
  '507a': '20220801',
  '507b': '20220801',
}

export const FORM_CODES = Object.keys(FORMS) as FormCode[]

export function formVersion(code: FormCode, version: string = CURRENT_VERSION[code]): FormVersion {
  const v = FORMS[code]?.[version]
  if (!v) throw new Error(`No map for form ${code} version ${version}`)
  return v
}

/**
 * The appendix tables' "...and dated" (FormData has no field for it): one date
 * per printed table page, keyed `signedDate:<table id>` by the page's first
 * table (A6's two tables share a page and a date).
 */
export const TABLE_DATED_KEY = 'signedDate'

export function tableDateKey(tableId: string): string {
  return `${TABLE_DATED_KEY}:${tableId}`
}

/** The tables that carry a date: the first on each printed page, in order. */
export function datedTables(map: Pick<FormMap, 'tables'>): string[] {
  const seen = new Set<number>()
  return map.tables.filter((t) => !seen.has(t.page) && seen.add(t.page)).map((t) => t.id)
}

/**
 * Keys that are written by hand on the printout and never stored: Part B
 * B6 user name/password (the B1 address is typed since 24 Nov 2026). The drafts API drops them before
 * saving; the engine never draws them.
 *
 * The dates beside a signature were on this list until Nov 2026. They are
 * typed now (FormField.signatureDate, and TABLE_DATED_KEY for the tables).
 */
export function handwrittenKeys(code: FormCode, version: string = CURRENT_VERSION[code]): string[] {
  const { map } = formVersion(code, version)
  return map.fields.filter((f) => f.handwritten).map((f) => f.key)
}

/** The form's signature date keys: its own date boxes, and each table page's "...and dated". */
export function signatureDateKeys(code: FormCode, version: string = CURRENT_VERSION[code]): string[] {
  const { map } = formVersion(code, version)
  return [...map.fields.filter((f) => f.signatureDate).map((f) => f.key), ...datedTables(map).map(tableDateKey)]
}
