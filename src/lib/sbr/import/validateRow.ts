/**
 * Validates one row on its own. Every failing rule is reported, not just the
 * first, so a rejected row can be fixed in one pass. The file-level rules
 * (repeats within the file) and the comparison with stored cases are in
 * classify.ts.
 */
import {
  DIRECTOR_LOAN_PAYABLE_MODE,
  EXCLUDED_CASES,
  NO_PAYMENTS_EVER_DAYS,
  SHARE_CHECK,
  type DirectorLoanPayableMode,
} from './config'
import { cellText, isNoPaymentsEver, nameKey, parseNumber, parseYesNo } from './normalise'
import type { CaseRecord, RejectReason, RowNote, SourceRow, ValidatedRow } from './types'

export interface ValidateOptions {
  directorLoanPayableMode: DirectorLoanPayableMode
  /** Name key → reason, for names that must never be imported. */
  excluded: ReadonlyMap<string, string>
}

export const DEFAULT_VALIDATE_OPTIONS: ValidateOptions = {
  directorLoanPayableMode: DIRECTOR_LOAN_PAYABLE_MODE,
  excluded: new Map(EXCLUDED_CASES.map((c) => [nameKey(c.name), c.reason])),
}

const percent = (x: number) => `${(x * 100).toFixed(1)}%`
const shown = (value: unknown) => {
  const s = cellText(value)
  return s === '' ? 'blank' : `"${s}"`
}

export function validateRow(
  row: SourceRow,
  options: ValidateOptions = DEFAULT_VALIDATE_OPTIONS,
): ValidatedRow {
  const c = row.cells
  const reasons: RejectReason[] = []
  const notes: RowNote[] = []
  const reject = (code: RejectReason['code'], message: string) => reasons.push({ code, message })

  // a. Client name.
  const clientName = cellText(c.clientName).replace(/\s+/g, ' ')
  const key = nameKey(clientName)
  if (!key) reject('missing_name', 'No client name.')

  // b. Outcome.
  const outcome = cellText(c.outcome).toLowerCase()
  const accepted = outcome === 'accepted' ? true : outcome === 'rejected' ? false : null
  if (accepted === null) {
    reject(
      'outcome',
      `Accepted/Rejected is ${shown(c.outcome)}: it must say whether creditors accepted or rejected the plan.`,
    )
  }

  // c. Payment type: Upfront, Plan, or Plan N months.
  const paymentType = cellText(c.paymentType).toLowerCase().replace(/\s+/g, ' ')
  let paymentPlanType: CaseRecord['payment_plan_type'] | null = null
  let termMonths: number | null = null
  const term = /^plan (\d{1,3}) months?$/.exec(paymentType)
  if (paymentType === 'upfront') paymentPlanType = 'upfront'
  else if (paymentType === 'plan') paymentPlanType = 'plan'
  else if (term && Number(term[1]) >= 1 && Number(term[1]) <= 120) {
    paymentPlanType = 'plan'
    termMonths = Number(term[1])
  } else {
    reject('payment_type', `Payment type ${shown(c.paymentType)} not supported yet.`)
  }

  // d. DPN.
  const dpn = parseYesNo(c.dpn)
  if (dpn === null) reject('dpn', `DPN is ${shown(c.dpn)}: expected Y or N.`)

  // e. Director loan at appointment.
  const loanRaw = cellText(c.directorLoanAtAppointment)
  const loanText = loanRaw.toLowerCase().replace(/\s+/g, ' ')
  let loanAtAppointment = parseYesNo(loanRaw)
  let loanPayable = false
  if (loanText === 'yes (receivable)') loanAtAppointment = true
  if (loanText === 'yes (payable)') {
    if (options.directorLoanPayableMode === 'treat_as_no') {
      loanAtAppointment = false
      loanPayable = true
      notes.push({ code: 'payable_loan', message: 'Payable loan, treated as not receivable.' })
    } else {
      reject('director_loan_payable', 'Director loan is payable: payable loans are not accepted.')
    }
  }
  if (loanAtAppointment === null && loanText !== 'yes (payable)') {
    reject(
      'director_loan',
      `Director loan at appointment is ${shown(c.directorLoanAtAppointment)}: expected Y, N, "Yes (Receivable)" or "Yes (Payable)".`,
    )
  }
  // A blank amount means no loan; an amount that is not a number does not.
  const loanAmountText = cellText(c.directorLoanAmount)
  const loanAmount = loanAmountText === '' ? 0 : parseNumber(c.directorLoanAmount)
  if (loanAmount === null || loanAmount < 0) {
    reject('director_loan', `Director loan amount is ${shown(c.directorLoanAmount)}: expected an amount.`)
  }

  // f. The figures.
  const creditorAmount = parseNumber(c.creditorAmount)
  if (creditorAmount === null || creditorAmount <= 0) {
    reject('creditor_amount', `Creditor amount is ${shown(c.creditorAmount)}: expected an amount above 0.`)
  }
  const sbrPayment = parseNumber(c.sbrPayment)
  if (sbrPayment === null || sbrPayment <= 0) {
    reject('sbr_payment', `SBR payment is ${shown(c.sbrPayment)}: expected an amount above 0.`)
  }
  const cents = parseNumber(c.centsInDollar)
  if (cents === null || cents < 0 || cents > 100) {
    reject('cents_in_dollar', `C/$ is ${shown(c.centsInDollar)}: expected a number from 0 to 100.`)
  }
  const cumulativeDaysLate = parseNumber(c.cumulativeDaysLate)
  if (cumulativeDaysLate === null || cumulativeDaysLate < 0 || !Number.isInteger(cumulativeDaysLate)) {
    reject(
      'cumulative_days_late',
      `Cumulative days of late lodgement is ${shown(c.cumulativeDaysLate)}: expected a whole number, 0 or more.`,
    )
  }
  const lateLodgements = parseNumber(c.numberOfLateLodgements)
  if (lateLodgements === null || lateLodgements < 0 || !Number.isInteger(lateLodgements)) {
    reject(
      'number_of_late_lodgements',
      `Number of late lodgements is ${shown(c.numberOfLateLodgements)}: expected a whole number, 0 or more.`,
    )
  }
  const noPaymentsEver = isNoPaymentsEver(c.daysSinceLastPayment)
  const daysSince = noPaymentsEver ? NO_PAYMENTS_EVER_DAYS : parseNumber(c.daysSinceLastPayment)
  if (
    !noPaymentsEver &&
    (daysSince === null || daysSince < 0 || !Number.isInteger(daysSince) || daysSince >= NO_PAYMENTS_EVER_DAYS)
  ) {
    reject(
      'days_since_last_payment',
      `Days since last payment is ${shown(c.daysSinceLastPayment)}: expected a whole number, 0 or more, or "NO PAYMENTS EVER".`,
    )
  }

  // g. Payment no more than the debt.
  const amountsOk = creditorAmount !== null && creditorAmount > 0 && sbrPayment !== null && sbrPayment > 0
  if (amountsOk && sbrPayment! > creditorAmount!) {
    reject('payment_exceeds_debt', 'SBR payment is more than the creditor amount.')
  }

  // h. Payment and C$ consistent.
  let share: number | null = null
  if (amountsOk && cents !== null && cents >= 0 && cents <= 100) {
    share = ((cents / 100) * creditorAmount!) / sbrPayment!
    if (share < SHARE_CHECK.rejectBelow || share > SHARE_CHECK.rejectAbove) {
      reject(
        'payment_cents_mismatch',
        `Payment and C/$ don't match: they mean creditors get ${percent(share)} of the payment (expected ${percent(SHARE_CHECK.rejectBelow)} to ${percent(SHARE_CHECK.rejectAbove)}).`,
      )
    } else if (share < SHARE_CHECK.noteBelow || share > SHARE_CHECK.noteAbove) {
      notes.push({
        code: 'share_borderline',
        message: `Payment and C/$ only roughly match: creditors get ${percent(share)} of the payment.`,
      })
    }
  }

  // i. Excluded.
  const excludedReason = key ? options.excluded.get(key) : undefined
  if (excludedReason) reject('excluded', `On the excluded list: ${excludedReason}.`)

  // Not a rule: an unreadable creditor count is left blank, not a rejection.
  const creditorsText = cellText(c.numberOfCreditors)
  let numberOfCreditors = creditorsText === '' ? null : parseNumber(c.numberOfCreditors)
  if (numberOfCreditors !== null && (numberOfCreditors < 0 || !Number.isInteger(numberOfCreditors))) {
    numberOfCreditors = null
  }
  if (creditorsText !== '' && numberOfCreditors === null) {
    notes.push({
      code: 'number_of_creditors_ignored',
      message: `Number of creditors ${shown(c.numberOfCreditors)} is not a whole number; left blank.`,
    })
  }

  const businessType = cellText(c.businessType).replace(/\s+/g, ' ') || null

  const record: CaseRecord | null =
    reasons.length > 0
      ? null
      : {
          client_name: clientName,
          dpn: dpn!,
          payment_plan_type: paymentPlanType!,
          term_months: termMonths,
          director_loan_at_appointment: loanAtAppointment!,
          director_loan_raw: loanRaw || null,
          director_loan_receivable_amount: loanPayable ? 0 : loanAmount!,
          director_loan_payable_amount: loanPayable ? loanAmount! : null,
          cumulative_days_late: cumulativeDaysLate!,
          number_of_late_lodgements: lateLodgements!,
          days_since_last_payment: daysSince!,
          outcome_percent: cents!,
          accepted: accepted!,
          creditor_amount: creditorAmount!,
          sbr_payment: sbrPayment!,
          business_type: businessType,
          number_of_creditors: numberOfCreditors,
          raw: row.raw,
        }

  return { ref: row.ref, clientName, nameKey: key, raw: row.raw, record, reasons, notes, share }
}
