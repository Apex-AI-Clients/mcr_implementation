import type { AtoAccountKind } from '../atoAccountKind'
import type { LodgementType } from '../types'

/**
 * Which composition line each row of an income tax or superannuation
 * guarantee account counts in. Matched on the description with the ATO's
 * leading apostrophe removed; first match wins.
 *
 * The LodgementType is only what the shared breakdown check needs
 * (paymentAllocations.ts): 'Payment', 'Refund' and 'GIC' totals with their
 * breakdown rows. Everything else is 'Other' to it.
 *
 * A row that matches nothing counts its credit as an "other credit" (as the
 * activity statement analysis does) and leaves its debit out, so an unknown
 * charge shows in the unexplained difference instead of being guessed at.
 */

export type AccountLineKey =
  // Income tax
  | 'assessments'
  // Superannuation guarantee
  | 'sgShortfall'
  | 'sgNominalInterest'
  | 'sgAdminFee'
  | 'part7'
  // Both
  | 'interest'
  | 'penalties'
  | 'refunds'
  | 'payments'
  | 'otherCredits'

interface LineMeta {
  label: string
  /** 'debt': debits add, credits reduce. 'credit': credits only, shown as a reduction. */
  side: 'debt' | 'credit'
  /** Shown even when no row counts in it, for these accounts. */
  always?: AtoAccountKind[]
  explain: (debits: number, credits: number) => string
}

const aud = (n: number) => `$${n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** In display order. */
export const LINE_META: Record<AccountLineKey, LineMeta> = {
  assessments: {
    label: 'Income tax assessed',
    side: 'debt',
    always: ['income_tax'],
    explain: (d, c) => `Income tax assessed on the returns: ${aud(d)}${c ? `, less ${aud(c)} reduced on amendment` : ''}.`,
  },
  sgShortfall: {
    label: 'SG shortfall',
    side: 'debt',
    always: ['super_guarantee'],
    explain: (d, c) => `Superannuation guarantee not paid on time, per SGC statement: ${aud(d)}${c ? `, less ${aud(c)} reduced on amendment` : ''}.`,
  },
  sgNominalInterest: {
    label: 'SG nominal interest',
    side: 'debt',
    always: ['super_guarantee'],
    explain: (d, c) => `Nominal interest on the shortfall, part of the SG charge: ${aud(d)}${c ? `, less ${aud(c)}` : ''}.`,
  },
  sgAdminFee: {
    label: 'SG administration fee',
    side: 'debt',
    always: ['super_guarantee'],
    explain: (d, c) => `The ATO's administration fee per employee per quarter: ${aud(d)}${c ? `, less ${aud(c)}` : ''}.`,
  },
  part7: {
    label: 'Part 7 penalty (net of remission)',
    side: 'debt',
    explain: (d, c) => `Part 7 penalty charged: ${aud(d)}, less ${aud(c)} remitted.`,
  },
  interest: {
    label: 'Interest (GIC)',
    side: 'debt',
    always: ['income_tax', 'super_guarantee'],
    explain: (d, c) => `General interest charged: ${aud(d)}, less ${aud(c)} remitted or amended.`,
  },
  penalties: {
    label: 'Penalties',
    side: 'debt',
    explain: (d, c) => `Penalties: ${aud(d)}${c ? `, less ${aud(c)} remitted` : ''}.`,
  },
  refunds: {
    label: 'Refunds paid out',
    side: 'debt',
    explain: () => 'Money the ATO paid out, which adds back to what is owed.',
  },
  payments: {
    label: 'Payments received',
    side: 'credit',
    explain: () => '',
  },
  otherCredits: {
    label: 'Other credits',
    side: 'credit',
    explain: (_d, c) => `Credit transfers and other credits applied to the account: ${aud(c)}.`,
  },
}

export interface RowClass {
  line: AccountLineKey | null
  lodgementType: LodgementType
}

const OTHER_CREDIT: RowClass = { line: 'otherCredits', lodgementType: 'Other' }

/** The SGC statement row itself (one per quarter event); its amounts are on the rows above it. */
export const SGC_EVENT = /superannuation guarantee \(quarterly\)/

export function classifyAccountRow(kind: AtoAccountKind, rawDescription: string): RowClass {
  const s = rawDescription.replace(/^'/, '').trim().toLowerCase()

  if (kind === 'super_guarantee') {
    if (s.startsWith('sg part 7 penalty')) return { line: 'part7', lodgementType: 'Other' }
    if (s.includes('sgc statement (liability) - sg shortfall')) return { line: 'sgShortfall', lodgementType: 'Other' }
    if (s.includes('sgc statement (liability) - sg nominal interest')) return { line: 'sgNominalInterest', lodgementType: 'Other' }
    if (s.includes('sgc statement (liability) - sg administration fee')) return { line: 'sgAdminFee', lodgementType: 'Other' }
    // The quarter's statement row: $0, its amounts are on the rows above it. Not a line of its own; an
    // amount on it would show in the unexplained difference rather than be guessed at.
    if (SGC_EVENT.test(s)) return { line: null, lodgementType: 'SubLine' }
  }

  if (kind === 'income_tax') {
    if (s.startsWith('tax return') || /\bincome tax for the period\b/.test(s) || /\bassessment\b/.test(s)) {
      return { line: 'assessments', lodgementType: 'Other' }
    }
  }

  if (s.includes('general interest charge')) return { line: 'interest', lodgementType: 'GIC' }
  if (/\brefund\b/.test(s)) return { line: 'refunds', lodgementType: 'Refund' }
  if (s === 'payment' || s.startsWith('payment received') || s.startsWith('payment ')) return { line: 'payments', lodgementType: 'Payment' }
  if (s.includes('penalty')) return { line: 'penalties', lodgementType: 'Other' }
  return OTHER_CREDIT
}
