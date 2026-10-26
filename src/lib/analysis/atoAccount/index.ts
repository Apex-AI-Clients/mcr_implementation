import { analyseAccountCore, type AtoAccountCore } from './engine'
import { incomeTaxSummary, type IncomeTaxSummary } from './incomeTax'
import { superGuaranteeSummary, type SuperGuaranteeSummary } from './superGuarantee'

/**
 * An income tax or superannuation guarantee account, analysed: the shared
 * core (engine.ts) and the account's own summary. Activity statement files
 * keep their own analysis (computeLateLodgement), which the SBR prediction
 * reads; this never runs for them.
 */

export type AtoAccountAnalysis =
  | (AtoAccountCore & { kind: 'income_tax'; summary: IncomeTaxSummary })
  | (AtoAccountCore & { kind: 'super_guarantee'; summary: SuperGuaranteeSummary })

export function analyseAtoAccount(csvText: string): AtoAccountAnalysis {
  const core = analyseAccountCore(csvText)
  if (core.kind === 'income_tax') return { ...core, kind: 'income_tax', summary: incomeTaxSummary(core) }
  if (core.kind === 'super_guarantee') return { ...core, kind: 'super_guarantee', summary: superGuaranteeSummary(core) }
  throw new Error('An activity statement account has its own analysis (computeLateLodgement).')
}

export type { AtoAccountCore } from './engine'
export { NEEDS_REVIEW_THRESHOLD } from './engine'
