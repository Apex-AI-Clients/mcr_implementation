import type { LodgementType } from './types'

export type { LodgementType }

/**
 * Classify an ATO Activity Statement description into a lodgement type.
 * Strip the leading apostrophe the ATO embeds for Excel safety before matching.
 * Evaluation order matters — first match wins.
 */
export function classifyLodgement(description: string): LodgementType {
  const s = description.replace(/^'/, '').trim().toLowerCase()

  // Government stimulus credits (Cash Flow Boost, JobKeeper top-ups, etc.)
  // MUST come before the 'Original Activity Statement' rule because
  // "Original Cash Flow Boost..." would otherwise be missed entirely.
  if (s.includes('cash flow boost')) return 'GovernmentCredit'
  if (s.includes('jobkeeper')) return 'GovernmentCredit'
  if (s.includes('boost payment')) return 'GovernmentCredit'

  if (s.startsWith('original activity statement')) return 'Original'
  if (s.startsWith('client initiated amended activity statement')) return 'ClientAmended'
  if (s.startsWith('ato initiated amended activity statement')) return 'ATOAmended'
  if (s.startsWith('- ')) return 'SubLine'
  if (s.includes('general interest charge')) return 'GIC'
  // ATO uses both "Payment received" and bare "Payment" labels — match either.
  if (s === 'payment' || s.startsWith('payment received') || s.startsWith('payment ')) return 'Payment'
  if (s.includes('failure to lodge')) return 'FTLPenalty'
  if (s.includes('general penalty') || s.includes('administrative penalty')) return 'GeneralPenalty'
  if (s.includes('credit transfer') || s.includes('debit transfer')) return 'CreditTransfer'
  return 'Other'
}
