import type { LodgementType } from './types'

export type { LodgementType }

/**
 * Classify an ATO Activity Statement description into a lodgement type.
 * Strip the leading apostrophe the ATO embeds for Excel safety before matching.
 * Evaluation order matters — first match wins.
 */
export function classifyLodgement(description: string): LodgementType {
  const s = description.replace(/^'/, '').trim().toLowerCase()

  if (s.startsWith('original activity statement')) return 'Original'
  if (s.startsWith('client initiated amended activity statement')) return 'ClientAmended'
  if (s.startsWith('ato initiated amended activity statement')) return 'ATOAmended'
  if (s.startsWith('- ')) return 'SubLine'
  if (s.includes('general interest charge')) return 'GIC'
  if (s.startsWith('payment received')) return 'Payment'
  return 'Other'
}
