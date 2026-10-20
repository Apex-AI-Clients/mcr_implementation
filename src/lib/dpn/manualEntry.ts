import { z } from 'zod'
import { parseNoticeDate } from './parse'

/**
 * A notice entered by hand: the request body, validated. Shared by the route
 * and the form, so the two agree on what is accepted. Amounts are cents.
 *
 * The director field takes a NAME. The form says so; the address printed on
 * the notice has no field to go into.
 */

const IsoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a full date.')
  .refine((value) => {
    const [y, m, d] = value.split('-')
    return parseNoticeDate(`${d}/${m}/${y}`) === value
  }, 'That date does not exist.')

const Cents = z.number().int().min(-1_000_000_000_00).max(1_000_000_000_00)

export const ManualRowSchema = z
  .object({
    periodFrom: IsoDate,
    periodTo: IsoDate,
    column2: Cents,
    column3: Cents,
    column4: Cents,
    column5: Cents,
  })
  .refine((row) => row.periodFrom <= row.periodTo, 'A period cannot end before it starts.')

export const ManualNoticeSchema = z.object({
  reference: z.string().trim().min(1, 'Enter the reference.').max(40),
  issuedOn: IsoDate,
  type: z.enum(['paygw', 'gst', 'sgc']),
  companyName: z.string().trim().min(1, 'Enter the company.').max(200),
  acn: z
    .string()
    .transform((value) => value.replace(/\s+/g, ''))
    .pipe(z.string().regex(/^\d{9}$/, 'An ACN is 9 digits.')),
  directorName: z.string().trim().min(1, "Enter the director's name.").max(200),
  rows: z.array(ManualRowSchema).min(1, 'Add at least one period.').max(100),
})

export type ManualNoticeInput = z.input<typeof ManualNoticeSchema>
export type ManualNotice = z.output<typeof ManualNoticeSchema>

/**
 * An amount as staff type it, in cents: "1234", "1,234.5", "$1,234.56",
 * "-12.00". Null when it is not an amount. Blank is not zero: a blank cell is
 * a gap to fill, not a figure.
 */
export function parseTypedAmount(raw: string): number | null {
  const match = /^(-)?\$?\s?(\d{1,3}(?:,\d{3})*|\d+)(?:\.(\d{1,2}))?$/.exec(raw.trim())
  if (!match) return null
  const [, minus, whole, fraction = ''] = match
  const cents = Number(whole.replace(/,/g, '')) * 100 + Number(fraction.padEnd(2, '0'))
  return minus ? -cents : cents
}

/** Cents back to what the form shows: 123456 -> "1234.56". */
export function centsToTyped(cents: number): string {
  return (cents / 100).toFixed(2)
}
