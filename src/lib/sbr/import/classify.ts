/**
 * Sorts validated rows into what an import would do, before anything is
 * saved: NEW cases, ALREADY HAVE (identical), CORRECTIONS (same name,
 * different figures; applied only when staff tick them) and REJECTED.
 *
 * Repeats within the file (decided 13 Oct 2026):
 *  - a repeat with the same figures as the earlier row is rejected
 *    ("appears twice in this file");
 *  - a repeat with different figures becomes a correction, unticked, with the
 *    note "appears in two tabs with different figures — check which is right".
 *    It corrects what the earlier row stands for: the stored case, or the
 *    new case the earlier row adds.
 *  - when the earlier row differs from the stored case but the later one
 *    matches it, the later row wins: no correction, both already have. (This
 *    is what a re-upload looks like after the correction above was ticked.)
 *  - a third version of the same case, or a repeat of a row that is itself a
 *    correction (and does not match the stored case), is rejected: the file
 *    disagrees with itself.
 *
 * Business type and number of creditors are filled in on a stored case that
 * has none ("details added"). They are never part of the comparison, so they
 * cannot turn a row into a correction.
 */
import { NO_PAYMENTS_EVER_DAYS } from './config'
import type {
  AlreadyHave,
  CaseRecord,
  Correction,
  DetailsAdded,
  ExistingCase,
  FieldChange,
  ImportPreview,
  NewCase,
  RejectedRow,
  RowNote,
  RowRef,
  TabSummary,
  ValidatedRow,
} from './types'

type Compared = keyof Pick<
  CaseRecord,
  | 'accepted'
  | 'outcome_percent'
  | 'creditor_amount'
  | 'sbr_payment'
  | 'dpn'
  | 'payment_plan_type'
  | 'director_loan_at_appointment'
  | 'director_loan_receivable_amount'
  | 'cumulative_days_late'
  | 'number_of_late_lodgements'
  | 'days_since_last_payment'
>

/** The figures that decide "identical": the model's inputs and its outcome. */
const COMPARED: { column: Compared; label: string; format: (v: CaseRecord[Compared]) => string }[] = [
  { column: 'accepted', label: 'Outcome', format: (v) => (v ? 'Accepted' : 'Rejected') },
  { column: 'outcome_percent', label: 'C/$', format: (v) => String(v) },
  { column: 'creditor_amount', label: 'Creditor amount', format: (v) => money(v as number) },
  { column: 'sbr_payment', label: 'SBR payment', format: (v) => money(v as number) },
  { column: 'dpn', label: 'DPN', format: yesNo },
  { column: 'payment_plan_type', label: 'Payment type', format: (v) => (v === 'plan' ? 'Plan' : 'Upfront') },
  { column: 'director_loan_at_appointment', label: 'Director loan at appointment', format: yesNo },
  { column: 'director_loan_receivable_amount', label: 'Director loan amount', format: (v) => money(v as number) },
  { column: 'cumulative_days_late', label: 'Cumulative days late', format: (v) => String(v) },
  { column: 'number_of_late_lodgements', label: 'Late lodgements', format: (v) => String(v) },
  {
    column: 'days_since_last_payment',
    label: 'Days since last payment',
    format: (v) => (v === NO_PAYMENTS_EVER_DAYS ? 'No payments ever' : String(v)),
  },
]

/**
 * The columns a correction of a stored case sets: the whole record except the
 * name (how it was matched) and the two details, which are only ever filled.
 */
export const CORRECTION_COLUMNS = [
  'dpn',
  'payment_plan_type',
  'term_months',
  'director_loan_at_appointment',
  'director_loan_raw',
  'director_loan_receivable_amount',
  'director_loan_payable_amount',
  'cumulative_days_late',
  'number_of_late_lodgements',
  'days_since_last_payment',
  'outcome_percent',
  'accepted',
  'creditor_amount',
  'sbr_payment',
  'raw',
] as const satisfies readonly (keyof CaseRecord)[]

function yesNo(v: unknown): string {
  return v ? 'Yes' : 'No'
}

function money(v: number): string {
  return `$${v.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function same(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') {
    // Spreadsheet floats: 317450.6 vs 317450.60000000003. Integers compare exactly.
    return Math.abs(a - b) < 0.005
  }
  return a === b
}

/** The compared figures that differ between two records, `from` → `to`. */
export function diffRecords(from: CaseRecord, to: CaseRecord): FieldChange[] {
  return COMPARED.filter(({ column }) => !same(from[column], to[column])).map(
    ({ column, label, format }) => ({
      column,
      label,
      from: format(from[column]),
      to: format(to[column]),
    }),
  )
}

function pick<K extends keyof CaseRecord>(record: CaseRecord, columns: readonly K[]): Pick<CaseRecord, K> {
  const out = {} as Pick<CaseRecord, K>
  for (const c of columns) out[c] = record[c]
  return out
}

function where(ref: RowRef): string {
  return ref.tab ? `row ${ref.rowNumber} of "${ref.tab}"` : `row ${ref.rowNumber}`
}

/** How the first accepted row for a name was classified. */
type FirstSeen =
  | { kind: 'new'; row: ValidatedRow }
  | { kind: 'same'; row: ValidatedRow; existing: ExistingCase }
  | { kind: 'correction'; row: ValidatedRow }

export function classifyRows(
  rows: readonly ValidatedRow[],
  existingCases: readonly ExistingCase[],
  tabs: TabSummary[],
): ImportPreview {
  const existingByKey = new Map(existingCases.map((c) => [c.name_key, c]))
  const firstSeen = new Map<string, FirstSeen>()
  const repeatCorrected = new Set<string>()
  const detailsFor = new Set<string>()

  const added: NewCase[] = []
  const corrections: Correction[] = []
  const alreadyHave: AlreadyHave[] = []
  const detailsAdded: DetailsAdded[] = []
  const rejected: RejectedRow[] = []

  const reject = (row: ValidatedRow, reasons = row.reasons) =>
    rejected.push({ ref: row.ref, clientName: row.clientName, reasons, raw: row.raw })

  const fillDetails = (existing: ExistingCase, record: CaseRecord) => {
    if (detailsFor.has(existing.id)) return
    const values: DetailsAdded['values'] = {}
    if (existing.record.business_type == null && record.business_type != null) {
      values.business_type = record.business_type
    }
    if (existing.record.number_of_creditors == null && record.number_of_creditors != null) {
      values.number_of_creditors = record.number_of_creditors
    }
    if (Object.keys(values).length === 0) return
    detailsFor.add(existing.id)
    detailsAdded.push({ caseId: existing.id, clientName: existing.record.client_name, values })
  }

  const correctStored = (row: ValidatedRow, existing: ExistingCase, notes: RowNote[]) => {
    const record = row.record!
    corrections.push({
      key: row.nameKey,
      ref: row.ref,
      clientName: row.clientName,
      caseId: existing.id,
      changes: diffRecords(existing.record, record),
      values: pick(record, CORRECTION_COLUMNS),
      expected: pick(existing.record, CORRECTION_COLUMNS),
      notes,
    })
  }

  for (const row of rows) {
    if (row.reasons.length > 0 || !row.record) {
      reject(row)
      continue
    }
    const record = row.record
    const existing = existingByKey.get(row.nameKey)

    if (existing?.excluded) {
      reject(row, [
        {
          code: 'excluded',
          message: `On the excluded list: ${existing.excluded_reason ?? 'excluded by staff'}.`,
        },
      ])
      continue
    }

    const first = firstSeen.get(row.nameKey)
    if (first) {
      const changes = diffRecords(first.row.record!, record)
      if (changes.length === 0) {
        reject(row, [
          {
            code: 'duplicate_in_file',
            message: `Appears twice in this file (same figures as ${where(first.row.ref)}).`,
          },
        ])
        continue
      }
      // The later row already matches the stored case: the file's latest
      // version is in, so the earlier row's correction is withdrawn and both
      // count as already have. Re-uploading a file whose cross-tab correction
      // was ticked therefore changes nothing.
      if (
        first.kind === 'correction' &&
        !repeatCorrected.has(row.nameKey) &&
        diffRecords(existing!.record, record).length === 0
      ) {
        corrections.splice(corrections.findIndex((c) => c.key === row.nameKey), 1)
        firstSeen.set(row.nameKey, { kind: 'same', row, existing: existing! })
        alreadyHave.push({ ref: first.row.ref, clientName: first.row.clientName })
        alreadyHave.push({ ref: row.ref, clientName: row.clientName })
        continue
      }
      if (first.kind === 'correction' || repeatCorrected.has(row.nameKey)) {
        reject(row, [
          {
            code: 'conflicting_repeat',
            message: `Appears more than once in this file with different figures (see ${where(first.row.ref)}). Fix the file and upload it again.`,
          },
        ])
        continue
      }

      repeatCorrected.add(row.nameKey)
      const note: RowNote = {
        code: 'repeat_with_different_figures',
        message:
          first.row.ref.tab !== row.ref.tab
            ? 'Appears in two tabs with different figures — check which is right.'
            : 'Appears twice in this file with different figures — check which is right.',
      }
      if (first.kind === 'same') {
        correctStored(row, first.existing, [note, ...row.notes])
        fillDetails(first.existing, record)
      } else {
        // Corrects the new case the earlier row adds: ticked, this row's
        // figures are added instead of the earlier row's.
        corrections.push({
          key: row.nameKey,
          ref: row.ref,
          clientName: row.clientName,
          caseId: null,
          changes,
          values: record,
          expected: {},
          notes: [note, ...row.notes],
        })
      }
      continue
    }

    if (!existing) {
      firstSeen.set(row.nameKey, { kind: 'new', row })
      added.push({ key: row.nameKey, ref: row.ref, record, notes: row.notes })
      continue
    }

    if (diffRecords(existing.record, record).length === 0) {
      firstSeen.set(row.nameKey, { kind: 'same', row, existing })
      alreadyHave.push({ ref: row.ref, clientName: row.clientName })
    } else {
      firstSeen.set(row.nameKey, { kind: 'correction', row })
      correctStored(row, existing, row.notes)
    }
    fillDetails(existing, record)
  }

  return {
    tabs,
    added,
    corrections,
    alreadyHave,
    detailsAdded,
    rejected,
    counts: {
      added: added.length,
      corrections: corrections.length,
      already_have: alreadyHave.length,
      details_added: detailsAdded.length,
      rejected: rejected.length,
    },
  }
}
