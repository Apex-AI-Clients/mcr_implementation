import { tidyRegisterName } from '@/lib/abr/names'
import type { CompanyIdentity } from '@/lib/clients/identity'
import { formatDob, parseDobInput } from './dates'
import { digitsOnly } from './identifiers'
import type { AsicExtract, Director } from './types'

/**
 * Filling a form from an ASIC extract. Pure, and shared by every form that has
 * the upload: lead conversion and the intake company step.
 *
 * What an extract fills:
 *
 *   - the registered office address, the principal place of business and the
 *     directors (name and date of birth, one row each)
 *   - the company name, ACN and the company's own ABN — ONLY into empty boxes.
 *     A box already filled is compared instead: equal reads "matches the ASIC
 *     extract"; different asks, per field, "Use ASIC / Keep" (chooseAsicValue,
 *     keepFormValue).
 *
 * It never fills the trust fields. Trusts are not registered with ASIC, so an
 * extract knows nothing about them. An extract with no ABN line — normal for a
 * company that only acts as trustee — leaves the company ABN alone and says so
 * (IdentityFill.noAbn), so the form can offer the trustee entity type.
 *
 * An extract for a different ACN than the form's is confirmed first. If staff
 * choose to replace, the fill runs in 'replace' mode and overwrites the three
 * company fields with the extract's; an ABN the extract lacks is cleared,
 * because the form's belonged to the other company.
 *
 * Undo puts back every field the fill changed, the identity fields included.
 * None of this depends on "Enter manually" — that only stops register lookups.
 */

/** A director as the form holds it: the date of birth is what was typed. */
export interface DirectorRow {
  name: string
  /** "14/03/1970", "03/1970", "1970" or "". Validated on save, not as typed. */
  dateOfBirth: string
}

/** The three fields an extract fills. */
export interface AsicFields {
  registeredOfficeAddress: string
  principalPlaceOfBusiness: string
  directors: DirectorRow[]
}

export type AsicSource = 'asic_pdf' | 'asic_pdf_edited' | 'manual'

/**
 * A fill that has been applied and can still be undone.
 *
 * `filled` is what the extract put in the form, kept so a later save can tell
 * "saved as filled" from "filled, then edited". `previous` is what was there
 * before, for undo.
 */
export type IdentityField = keyof CompanyIdentity

/** What the extract said about one of the company's identity fields. */
export type IdentityComparison =
  /** The box was empty (or replaced) and now holds the extract's value. */
  | { status: 'filled'; asic: string }
  /** The box already held the same thing. */
  | { status: 'matches'; asic: string }
  /** The box holds something else. Untouched until staff choose. */
  | { status: 'differs'; asic: string; form: string }
  /** Was 'differs'; staff chose the extract's value. */
  | { status: 'used_asic'; asic: string; form: string }
  /** Was 'differs'; staff kept the form's value. */
  | { status: 'kept'; asic: string; form: string }
  /** The extract has nothing for this field. */
  | { status: 'not_on_extract' }

export type IdentityFillMode = 'merge' | 'replace'

export interface IdentityFill {
  mode: IdentityFillMode
  fields: Record<IdentityField, IdentityComparison>
  /** What the fill wrote into the form, field by field. */
  filled: Partial<CompanyIdentity>
  /** What those fields held before — only the ones it changed, for undo. */
  previous: Partial<CompanyIdentity>
  /** The extract shows no ABN: the company may only be a trustee. */
  noAbn: boolean
}

export interface AsicFill {
  /** The extract's own date — the "as at". */
  extractedAt: string | null
  /**
   * Whose extract it was. Never filled into the form — kept only so an ACN
   * typed after the fill can still be checked against it.
   */
  acn: string
  companyName: string | null
  warnings: string[]
  filled: AsicFields
  previous: AsicFields
  /** The company name / ACN / ABN half, when the form passed its identity in. */
  identity: IdentityFill | null
}

export const EMPTY_ASIC_FIELDS: AsicFields = {
  registeredOfficeAddress: '',
  principalPlaceOfBusiness: '',
  directors: [],
}

export function emptyDirectorRow(): DirectorRow {
  return { name: '', dateOfBirth: '' }
}

export function directorRows(directors: readonly Director[]): DirectorRow[] {
  return directors.map((director) => ({
    name: director.name,
    dateOfBirth: formatDob(director.dateOfBirth),
  }))
}

/** Names compared the way a person would: case, punctuation and the long forms aside. */
function comparableName(name: string): string {
  return name
    .toUpperCase()
    .replace(/\bPROPRIETARY\b/g, 'PTY')
    .replace(/\bLIMITED\b/g, 'LTD')
    .replace(/[^A-Z0-9]/g, '')
}

/** Whether two values for a field are the same, the way the extract comparison reads them. */
export function sameIdentityValue(field: IdentityField, a: string, b: string): boolean {
  return field === 'companyName'
    ? comparableName(a) === comparableName(b)
    : digitsOnly(a) === digitsOnly(b)
}

/** The extract's value for a field, as it would be filled, or null. */
function extractValue(field: IdentityField, extract: AsicExtract): string | null {
  if (field === 'companyName') {
    return extract.companyName ? tidyRegisterName(extract.companyName) : null
  }
  if (field === 'acnNumber') return extract.acn ? digitsOnly(extract.acn) : null
  return extract.abn ? digitsOnly(extract.abn) : null
}

const IDENTITY_FIELDS: IdentityField[] = ['companyName', 'acnNumber', 'abnNumber']

/**
 * The identity half of a fill.
 *
 * 'merge' (the default): fill empty boxes, compare filled ones.
 * 'replace': staff confirmed an extract for a different ACN — the extract's
 * name, ACN and ABN overwrite the form's, and the company ABN is cleared when
 * the extract has none.
 */
export function fillIdentity(
  current: CompanyIdentity,
  extract: AsicExtract,
  mode: IdentityFillMode = 'merge',
): IdentityFill {
  const fields = {} as Record<IdentityField, IdentityComparison>
  const filled: Partial<CompanyIdentity> = {}
  const previous: Partial<CompanyIdentity> = {}

  for (const field of IDENTITY_FIELDS) {
    const asic = extractValue(field, extract)
    const form = current[field]

    if (asic === null) {
      if (mode === 'replace' && field === 'abnNumber' && form.trim()) {
        filled[field] = ''
        previous[field] = form
      }
      fields[field] = { status: 'not_on_extract' }
    } else if (form.trim() && sameIdentityValue(field, form, asic)) {
      fields[field] = { status: 'matches', asic }
    } else if (!form.trim() || mode === 'replace') {
      filled[field] = asic
      previous[field] = form
      fields[field] = { status: 'filled', asic }
    } else {
      fields[field] = { status: 'differs', asic, form }
    }
  }

  return { mode, fields, filled, previous, noAbn: extract.abn === null }
}

/**
 * Apply an extract to the fields it fills.
 *
 * Only what the extract actually has: a missing address or an empty director
 * list leaves what was typed alone rather than blanking it. The company name,
 * ACN and ABN are filled only when the form passes its identity in.
 */
export function applyExtract(
  current: AsicFields,
  extract: AsicExtract,
  identity?: { current: CompanyIdentity; mode?: IdentityFillMode },
): AsicFill {
  const filled: AsicFields = {
    registeredOfficeAddress: extract.registeredOffice ?? current.registeredOfficeAddress,
    principalPlaceOfBusiness: extract.principalPlaceOfBusiness ?? current.principalPlaceOfBusiness,
    directors: extract.directors.length > 0 ? directorRows(extract.directors) : current.directors,
  }
  return {
    extractedAt: extract.extractedAt,
    acn: extract.acn,
    companyName: extract.companyName,
    warnings: extract.warnings,
    filled,
    previous: current,
    identity: identity ? fillIdentity(identity.current, extract, identity.mode) : null,
  }
}

/**
 * "Use ASIC" on a field that differed: the extract's value goes in, and what it
 * replaced is kept for undo. Returns the form patch and the updated fill.
 */
export function chooseAsicValue(
  fill: AsicFill,
  field: IdentityField,
  current: CompanyIdentity,
): { patch: Partial<CompanyIdentity>; fill: AsicFill } {
  const comparison = fill.identity?.fields[field]
  if (!fill.identity || comparison?.status !== 'differs') return { patch: {}, fill }
  const identity: IdentityFill = {
    ...fill.identity,
    fields: { ...fill.identity.fields, [field]: { ...comparison, status: 'used_asic' } },
    filled: { ...fill.identity.filled, [field]: comparison.asic },
    previous: { ...fill.identity.previous, [field]: current[field] },
  }
  return { patch: { [field]: comparison.asic }, fill: { ...fill, identity } }
}

/** "Keep" on a field that differed: nothing changes in the form. */
export function keepFormValue(fill: AsicFill, field: IdentityField): AsicFill {
  const comparison = fill.identity?.fields[field]
  if (!fill.identity || comparison?.status !== 'differs') return fill
  return {
    ...fill,
    identity: {
      ...fill.identity,
      fields: { ...fill.identity.fields, [field]: { ...comparison, status: 'kept' } },
    },
  }
}

/** The fields still waiting on "Use ASIC / Keep". */
export function pendingIdentityChoices(fill: AsicFill | null): IdentityField[] {
  const identity = fill?.identity
  if (!identity) return []
  return IDENTITY_FIELDS.filter((field) => identity.fields[field].status === 'differs')
}

/** Everything undo puts back: the three ASIC fields and every identity field the fill changed. */
export function undoFill(fill: AsicFill): AsicFields & Partial<CompanyIdentity> {
  return { ...fill.previous, ...(fill.identity?.previous ?? {}) }
}

/**
 * Whether the extract is for a different company than the form.
 *
 * Only when the form has a whole ACN to compare with: an empty or half-typed
 * ACN is not a contradiction, and there is nothing to warn about.
 */
export function acnDiffers(formAcn: string, extractAcn: string): boolean {
  const typed = digitsOnly(formAcn)
  return typed.length === 9 && typed !== digitsOnly(extractAcn)
}

/** "123456780" -> "123 456 780", for the mismatch question. */
export function formatAcn(acn: string): string {
  const digits = digitsOnly(acn)
  return digits.length === 9 ? `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}` : acn
}

function isBlank(row: DirectorRow): boolean {
  return !row.name.trim() && !row.dateOfBirth.trim()
}

/**
 * What is wrong with each director row, or null. Same length as `rows`.
 *
 * A wholly blank row is fine — it is simply dropped on save. A date of birth
 * is optional; a name is not, once anything has been typed in the row.
 */
export function directorRowErrors(rows: readonly DirectorRow[]): (string | null)[] {
  return rows.map((row) => {
    if (isBlank(row)) return null
    if (!row.name.trim()) return "Enter the director's name."
    const parsed = parseDobInput(row.dateOfBirth)
    return parsed.ok ? null : parsed.message
  })
}

/** Form rows -> what is stored: blank rows dropped, dates as ISO. */
export function directorsForSave(rows: readonly DirectorRow[]): Director[] {
  return rows
    .filter((row) => !isBlank(row))
    .map((row) => {
      const parsed = parseDobInput(row.dateOfBirth)
      return { name: row.name.trim(), dateOfBirth: parsed.ok ? parsed.iso : null }
    })
}

function comparable(fields: AsicFields): string {
  return JSON.stringify({
    registered: fields.registeredOfficeAddress.trim(),
    principal: fields.principalPlaceOfBusiness.trim(),
    directors: directorsForSave(fields.directors),
  })
}

function isEmpty(fields: AsicFields): boolean {
  return (
    !fields.registeredOfficeAddress.trim() &&
    !fields.principalPlaceOfBusiness.trim() &&
    directorsForSave(fields.directors).length === 0
  )
}

/**
 * Where the fields being saved came from.
 *
 *   'asic_pdf'         filled from an extract and saved as filled
 *   'asic_pdf_edited'  filled from an extract, then an address or a director changed
 *   'manual'           typed by hand, no extract
 *   null               nothing there to have a source
 *
 * The browser decides this because only it knows what the fill contained; the
 * routes check the value is one of the three.
 */
export function sourceFor(
  fill: Pick<AsicFill, 'filled'> | null,
  current: AsicFields,
): AsicSource | null {
  if (fill) return comparable(fill.filled) === comparable(current) ? 'asic_pdf' : 'asic_pdf_edited'
  return isEmpty(current) ? null : 'manual'
}

/** A stored director on a read-only page: "Jane Sample · born 14/03/1970". */
export function describeDirector(director: Director): string {
  const born = formatDob(director.dateOfBirth)
  return born ? `${director.name} · born ${born}` : director.name
}

/** The line under the fields on a saved record. */
export function sourceLabel(source: string | null | undefined, asAt: string): string | null {
  if (source === 'asic_pdf') return `From ASIC extract as at ${asAt}`
  if (source === 'asic_pdf_edited') return `From ASIC extract as at ${asAt}, edited`
  return null
}

/** What a saved record says about where its ASIC fields came from. */
export interface SavedAsicOrigin {
  source: string | null
  extractedAt: string | null
  /** The fields as they were saved, to tell "unchanged" from "edited since". */
  fields: AsicFields
}

/**
 * The source and extract date to save, for a form editing an existing record.
 *
 * A fill made in this sitting decides it, exactly as at conversion. Without
 * one, the record's own origin carries forward: something that came from an
 * extract stays "from the extract" until a field it filled is changed, at which
 * point it becomes — and stays — "edited", keeping the extract's date. Emptied
 * out entirely, there is nothing left to have come from anywhere.
 */
export function resolveOrigin(
  fill: AsicFill | null,
  saved: SavedAsicOrigin | null,
  current: AsicFields,
): { source: AsicSource | null; extractedAt: string | null } {
  if (fill) return { source: sourceFor(fill, current), extractedAt: fill.extractedAt }

  const fromExtract = saved?.source === 'asic_pdf' || saved?.source === 'asic_pdf_edited'
  if (saved && fromExtract && !isEmpty(current)) {
    const unchanged = saved.source === 'asic_pdf' && comparable(saved.fields) === comparable(current)
    return { source: unchanged ? 'asic_pdf' : 'asic_pdf_edited', extractedAt: saved.extractedAt }
  }
  return { source: sourceFor(null, current), extractedAt: null }
}
