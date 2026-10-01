import { z } from 'zod'
import { isIsoDob } from '@/lib/asic/dates'
import type { Director } from '@/lib/asic/types'
import type { Database, Json } from '@/types/database'
import type { EntityType } from '@/types/leads'

/**
 * Writing to company_details without flattening what is already there.
 *
 * Two forms write this record now, and they know different amounts. The intake
 * company step sends every field it renders, because a cleared box has to be
 * able to clear the column. Intake step 1 sends only what the business register
 * answered — a name, an ABN, sometimes an ACN — and knows nothing about the
 * phone number and email somebody typed in a fortnight ago, or the directors
 * that came off an ASIC extract.
 *
 * So absence and emptiness are different things here, and the whole point of
 * this module is that they stay different:
 *
 *   absent (undefined)  ->  leave the column exactly as it is
 *   present but ''      ->  the user cleared the box; store ''
 *   directors absent    ->  leave the directors exactly as they are
 *   directors []        ->  the user removed them all; store []
 *
 * Getting that backwards is silent: the register has no phone number for any
 * entity, so a partial write that treated absent as empty would wipe the
 * client's phone and email every time somebody corrected a company name, and
 * nothing would look wrong until an accountant went to call them.
 */

/** Where the ASIC fields on this record came from. Decided by the browser. */
export const COMPANY_DETAILS_SOURCES = ['asic_pdf', 'asic_pdf_edited', 'manual'] as const
export type CompanyDetailsSource = (typeof COMPANY_DETAILS_SOURCES)[number]

export interface CompanyDetailsInput {
  companyName?: string
  acnNumber?: string
  abnNumber?: string
  trustName?: string
  /** The trust's own ABN. abnNumber is only ever the company's. */
  trustAbnNumber?: string
  /** 'trust' = a company acting as trustee. Absent leaves it; a new row defaults to 'company'. */
  entityType?: EntityType
  phoneNumber?: string
  emailAddress?: string
  registeredOfficeAddress?: string
  principalPlaceOfBusiness?: string
  directors?: Director[]
  /** The extract's own date. null clears it; absent leaves it. */
  asicExtractDate?: string | null
  companyDetailsSource?: CompanyDetailsSource | null
}

const MAX_DIRECTORS = 20

const DirectorSchema = z.object({
  name: z.string().trim().min(1).max(200),
  /** ISO at the precision known: "1970-03-14", "1970-03" or "1970". */
  dateOfBirth: z
    .string()
    .refine(isIsoDob, 'A date of birth has to be YYYY-MM-DD, YYYY-MM or YYYY.')
    .nullable(),
})

/**
 * What either route accepts for this record. Every field optional, because
 * which ones a form requires is that form's business (see conversionForm.ts);
 * this only says what a value has to look like when it is sent.
 *
 * Strict on the fields that are not plain text: directors is stored as jsonb,
 * so anything the schema lets through is what the column holds.
 */
export const CompanyDetailsSchema = z.object({
  companyName: z.string().max(200).optional(),
  acnNumber: z.string().max(40).optional(),
  abnNumber: z.string().max(40).optional(),
  trustName: z.string().max(200).optional(),
  trustAbnNumber: z.string().max(40).optional(),
  entityType: z.enum(['company', 'trust']).optional(),
  phoneNumber: z.string().max(40).optional(),
  emailAddress: z.string().max(200).optional(),
  registeredOfficeAddress: z.string().max(500).optional(),
  principalPlaceOfBusiness: z.string().max(500).optional(),
  directors: z.array(DirectorSchema).max(MAX_DIRECTORS).optional(),
  asicExtractDate: z.iso.datetime({ offset: true }).nullable().optional(),
  companyDetailsSource: z.enum(COMPANY_DETAILS_SOURCES).nullable().optional(),
})

/**
 * The stored directors, read back.
 *
 * The column is jsonb, so its type says nothing about what is in it. Anything
 * that is not a list of { name, dateOfBirth } reads as no directors rather than
 * reaching a page as something it cannot render.
 */
export function readDirectors(value: unknown): Director[] {
  const parsed = z.array(DirectorSchema).safeParse(value)
  return parsed.success ? parsed.data : []
}

type CompanyDetailsTable = Database['public']['Tables']['company_details']
export type CompanyDetailsUpdate = CompanyDetailsTable['Update']
export type CompanyDetailsInsert = CompanyDetailsTable['Insert']

/** Request field -> column, for the plain text fields. The one place the mapping is written down. */
const TEXT_COLUMNS = {
  companyName: 'company_name',
  acnNumber: 'acn_number',
  abnNumber: 'abn_number',
  trustName: 'trust_name',
  trustAbnNumber: 'trust_abn_number',
  phoneNumber: 'phone_number',
  emailAddress: 'email_address',
  registeredOfficeAddress: 'registered_office_address',
  principalPlaceOfBusiness: 'principal_place_of_business',
} as const

type TextField = keyof typeof TEXT_COLUMNS

const TEXT_FIELDS = Object.keys(TEXT_COLUMNS) as TextField[]

function directorsJson(directors: Director[]): Json {
  // Rebuilt field by field, so nothing beyond name and dateOfBirth — a place of
  // birth, say — can ride into the column on the back of a wider object.
  return directors.map(({ name, dateOfBirth }) => ({ name, dateOfBirth }))
}

/**
 * The columns to set on an UPDATE — only the ones actually supplied.
 *
 * Never includes a column the caller did not mention, which is what makes a
 * partial write safe.
 */
export function companyDetailsUpdate(input: CompanyDetailsInput): CompanyDetailsUpdate {
  const update: CompanyDetailsUpdate = {}
  for (const field of TEXT_FIELDS) {
    const value = input[field]
    if (typeof value === 'string') update[TEXT_COLUMNS[field]] = value
  }
  if (input.entityType !== undefined) update.entity_type = input.entityType
  if (Array.isArray(input.directors)) update.directors = directorsJson(input.directors)
  // null is a value for these two — it clears the column — so only undefined is absent.
  if (input.asicExtractDate !== undefined) update.asic_extract_date = input.asicExtractDate
  if (input.companyDetailsSource !== undefined) {
    update.company_details_source = input.companyDetailsSource
  }
  return update
}

/**
 * The columns for an INSERT — all of them, with nothing supplied stored as null
 * (and no directors as an empty list).
 *
 * Different from the update on purpose: there is no existing value to preserve
 * on a new row, and leaving columns out would rely on database defaults that
 * would then be the real definition of a blank field.
 */
export function companyDetailsInsert(
  clientId: string,
  input: CompanyDetailsInput,
): CompanyDetailsInsert {
  const row: CompanyDetailsInsert = {
    client_id: clientId,
    // Written out rather than left to the column default, like every other
    // column here: the default should not be the real definition of "unsaid".
    entity_type: input.entityType ?? 'company',
    directors: directorsJson(Array.isArray(input.directors) ? input.directors : []),
    asic_extract_date: input.asicExtractDate ?? null,
    company_details_source: input.companyDetailsSource ?? null,
  }
  for (const field of TEXT_FIELDS) {
    const value = input[field]
    row[TEXT_COLUMNS[field]] = typeof value === 'string' ? value : null
  }
  return row
}

/** Whether there is anything to write at all. */
export function hasCompanyDetails(input: CompanyDetailsInput): boolean {
  return (
    TEXT_FIELDS.some((field) => typeof input[field] === 'string') ||
    input.entityType !== undefined ||
    Array.isArray(input.directors) ||
    input.asicExtractDate !== undefined ||
    input.companyDetailsSource !== undefined
  )
}
