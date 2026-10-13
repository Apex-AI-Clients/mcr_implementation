/**
 * Which column is which. Headers are matched case-, space- and
 * punctuation-insensitively against a list of synonyms per field; columns
 * that match nothing are ignored.
 */
import { csvCell } from './csv'
import type { ImportField } from './types'

/** Header text reduced to lowercase letters, digits and "$". */
export function headerKey(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9$]/g, '')
}

interface FieldSpec {
  /** The header the template writes (Gabby's spelling). */
  header: string
  required: boolean
  /** Accepted spellings, written as headerKey() reduces them. */
  synonyms: string[]
}

export const FIELDS: Record<ImportField, FieldSpec> = {
  clientName: {
    header: 'Client Name',
    required: true,
    synonyms: ['clientname', 'client', 'companyname', 'company', 'name'],
  },
  businessType: {
    header: 'Business Type',
    required: false,
    synonyms: ['businesstype', 'industry'],
  },
  dpn: {
    header: 'DPN',
    required: true,
    synonyms: ['dpn', 'directorpenaltynotice'],
  },
  numberOfCreditors: {
    header: 'Number of creditors',
    required: false,
    synonyms: ['numberofcreditors', 'noofcreditors', 'creditorcount'],
  },
  creditorAmount: {
    header: 'Creditor amount',
    required: true,
    synonyms: ['creditoramount', 'creditorsamount', 'totalcreditoramount'],
  },
  outcome: {
    header: 'Accepted/Rejected',
    required: true,
    synonyms: ['acceptedrejected', 'acceptedorrejected', 'outcome', 'result'],
  },
  sbrPayment: {
    header: 'SBR Payment',
    required: true,
    synonyms: ['sbrpayment', 'sbrpaymentamount', 'sbroffer'],
  },
  paymentType: {
    header: 'Payment Plan or Upfront',
    required: true,
    synonyms: ['paymentplanorupfront', 'paymentplanupfront', 'paymenttype', 'planorupfront'],
  },
  directorLoanAtAppointment: {
    header: 'Receivable Director Loan At Appointment',
    required: true,
    synonyms: [
      'receivabledirectorloanatappointment',
      'directorloanatappointment',
      'directorloanreceivableatappointment',
    ],
  },
  // Read only into `raw`: dropped from the model in v2 (only knowable after
  // appointment), so a file without it is fine.
  directorLoanSentToAto: {
    header: 'Receivable Director Loan sent to ATO',
    required: false,
    synonyms: ['receivabledirectorloansenttoato', 'directorloansenttoato'],
  },
  directorLoanAmount: {
    header: 'Director Loan Receivable Amount (Sent to ATO)',
    required: true,
    synonyms: [
      'directorloanreceivableamountsenttoato',
      'directorloanreceivableamount',
      'directorloanamount',
    ],
  },
  cumulativeDaysLate: {
    header: 'Cumulative Days of Late Lodgement',
    required: true,
    synonyms: ['cumulativedaysoflatelodgement', 'cumulativedaysoflatelodgements', 'cumulativedayslate'],
  },
  numberOfLateLodgements: {
    header: 'Number of Late Lodgements',
    required: true,
    synonyms: ['numberoflatelodgements', 'noflatelodgements', 'latelodgements'],
  },
  daysSinceLastPayment: {
    header: 'Days Since Last Payment',
    required: true,
    synonyms: ['dayssincelastpayment', 'dayssincepayment'],
  },
  centsInDollar: {
    header: 'C/$',
    required: true,
    synonyms: ['c$', 'cents$', 'centsinthedollar', 'centsperdollar', 'centsonthedollar'],
  },
}

export const FIELD_ORDER = Object.keys(FIELDS) as ImportField[]

const BY_SYNONYM = new Map<string, ImportField>(
  FIELD_ORDER.flatMap((field) => FIELDS[field].synonyms.map((s) => [s, field] as const)),
)

export interface HeaderMatch {
  /** Column index per field found. */
  columns: Partial<Record<ImportField, number>>
  /** Required fields with no column. Empty when the row is a usable header. */
  missing: ImportField[]
}

/** Match one row of cells as a header row. The first column wins a field. */
export function matchHeader(cells: readonly string[]): HeaderMatch {
  const columns: Partial<Record<ImportField, number>> = {}
  cells.forEach((cell, i) => {
    const field = BY_SYNONYM.get(headerKey(cell))
    if (field && columns[field] === undefined) columns[field] = i
  })
  const missing = FIELD_ORDER.filter((f) => FIELDS[f].required && columns[f] === undefined)
  return { columns, missing }
}

/** "Client Name, DPN" for a list of fields. */
export function describeFields(fields: readonly ImportField[]): string {
  return fields.map((f) => FIELDS[f].header).join(', ')
}

/**
 * The downloadable template: the exact headers plus one synthetic example
 * row (no real client). It imports cleanly as one accepted case.
 */
export function templateCsv(): string {
  const example: Record<ImportField, string> = {
    clientName: 'Example Trading Pty Ltd',
    businessType: 'Cafe & Restaurant',
    dpn: 'N',
    numberOfCreditors: '3',
    creditorAmount: '250,000.00',
    outcome: 'Accepted',
    sbrPayment: '100,000.00',
    paymentType: 'Plan 24 Months',
    directorLoanAtAppointment: 'No',
    directorLoanSentToAto: 'No',
    directorLoanAmount: '0.00',
    cumulativeDaysLate: '450',
    numberOfLateLodgements: '9',
    daysSinceLastPayment: '120',
    // 35.0% × 250,000 ÷ 100,000 = 87.5% of the payment reaches creditors.
    centsInDollar: '35.0',
  }
  const line = (values: string[]) => values.map(csvCell).join(',')
  return [
    line(FIELD_ORDER.map((f) => FIELDS[f].header)),
    line(FIELD_ORDER.map((f) => example[f])),
  ].join('\r\n') + '\r\n'
}

