/**
 * Writing to company_details without flattening what is already there.
 *
 * Two forms write this record now, and they know different amounts. The intake
 * company step sends all six fields, because it renders all six and a cleared
 * box has to be able to clear the column. Intake step 1 sends only what the
 * business register answered — a name, an ABN, sometimes an ACN — and knows
 * nothing about the phone number and email somebody typed in a fortnight ago.
 *
 * So absence and emptiness are different things here, and the whole point of
 * this module is that they stay different:
 *
 *   absent (undefined)  ->  leave the column exactly as it is
 *   present but ''      ->  the user cleared the box; store ''
 *
 * Getting that backwards is silent: the register has no phone number for any
 * entity, so a partial write that treated absent as empty would wipe the
 * client's phone and email every time somebody corrected a company name, and
 * nothing would look wrong until an accountant went to call them.
 */

export interface CompanyDetailsInput {
  companyName?: string
  acnNumber?: string
  abnNumber?: string
  trustName?: string
  phoneNumber?: string
  emailAddress?: string
}

/** Request field -> column. The one place the mapping is written down. */
const COLUMNS = {
  companyName: 'company_name',
  acnNumber: 'acn_number',
  abnNumber: 'abn_number',
  trustName: 'trust_name',
  phoneNumber: 'phone_number',
  emailAddress: 'email_address',
} as const

type Field = keyof typeof COLUMNS

const FIELDS = Object.keys(COLUMNS) as Field[]

/**
 * The columns to set on an UPDATE — only the ones actually supplied.
 *
 * Never includes a column the caller did not mention, which is what makes a
 * partial write safe.
 */
export function companyDetailsUpdate(input: CompanyDetailsInput): Record<string, string> {
  const update: Record<string, string> = {}
  for (const field of FIELDS) {
    const value = input[field]
    if (typeof value === 'string') update[COLUMNS[field]] = value
  }
  return update
}

/**
 * The columns for an INSERT — all of them, with nothing supplied stored as null.
 *
 * Different from the update on purpose: there is no existing value to preserve
 * on a new row, and leaving columns out would rely on database defaults that
 * would then be the real definition of a blank field.
 */
export function companyDetailsInsert(
  clientId: string,
  input: CompanyDetailsInput,
): Record<string, string | null> {
  const row: Record<string, string | null> = { client_id: clientId }
  for (const field of FIELDS) {
    const value = input[field]
    row[COLUMNS[field]] = typeof value === 'string' ? value : null
  }
  return row
}

/** Whether there is anything to write at all. */
export function hasCompanyDetails(input: CompanyDetailsInput): boolean {
  return FIELDS.some((field) => typeof input[field] === 'string')
}
