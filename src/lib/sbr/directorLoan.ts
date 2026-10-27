import type { MappedLine, NotIdentified, PredictionFinancials } from '@/lib/printed/mapping'

/**
 * The SBR prediction's "Director loan receivable amount", from the loan
 * account lines staff confirmed on the latest balance sheet (printed/mapping.ts).
 * Pure; shared by the prediction page and the predict route.
 *
 *   gross  the lines owed TO the company only (the default)
 *   net    those less the lines owed BY the company (never below $0)
 *
 * Which one the historical cases were recorded on is for Gabby to confirm:
 * ONE setting, here. The other figures are shown beside the input as
 * information either way.
 */
export type DirectorLoanBasis = 'gross' | 'net'

export const DIRECTOR_LOAN_BASIS: DirectorLoanBasis = 'gross'

export interface DirectorLoanInput {
  /** Not identified: the input shows why, and Predict asks for the line. Never a silent $0. */
  notIdentified: NotIdentified | null
  /** What the prediction uses, on the basis below. */
  amount: number
  basis: DirectorLoanBasis
  /** Owed to the company (gross). */
  receivable: number
  /** Owed by the company. */
  payable: number
  /** Receivable less payable: positive owed to the company, negative owed by it. */
  net: number
  receivableLines: MappedLine[]
  payableLines: MappedLine[]
  /** "FY2027 balance sheet" or "current period at 15 Oct 2026". */
  source: string | null
  asOf: string | null
  /** "“Owner … Funds Introduced” $40,667.15 owed by the company; net $89,500.72 owed to the company". */
  info: string | null
}

const cents = (n: number) => `$${Math.abs(n).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const round2 = (n: number) => Math.round(n * 100) / 100

export function directorLoanInput(f: PredictionFinancials, basis: DirectorLoanBasis = DIRECTOR_LOAN_BASIS): DirectorLoanInput {
  const receivable = Math.max(0, f.loanReceivable?.amount ?? 0)
  const payable = Math.max(0, f.loanPayable?.amount ?? 0)
  const net = round2(receivable - payable)
  const payableLines = f.loanPayable?.lines ?? []
  const info =
    f.loanReceivable && (payable > 0 || payableLines.length > 0)
      ? `${payableLines.map((l) => `“${l.label}”`).join(' + ') || 'Loans'} ${cents(payable)} owed by the company; net ${cents(net)} owed ${net >= 0 ? 'to' : 'by'} the company`
      : null
  return {
    notIdentified: f.notIdentified.loanReceivable ?? null,
    amount: basis === 'net' ? Math.max(0, net) : receivable,
    basis,
    receivable,
    payable,
    net,
    receivableLines: f.loanReceivable?.lines ?? [],
    payableLines,
    source: f.loanReceivable?.source ?? f.balanceSheet?.label ?? null,
    asOf: f.loanReceivable?.asOf ?? f.balanceSheet?.column.periodEnd ?? null,
    info,
  }
}
