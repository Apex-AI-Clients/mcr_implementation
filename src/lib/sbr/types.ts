/**
 * Types for the SBR outcome prediction feature.
 *
 * Methodology agreed with Gabby + Tom (May 2026), revised 28 May 2026 (v2):
 * k-NN (k=8) over a 7-feature standardised vector. Predicted outcome = mean of
 * the 8 nearest neighbours' historical outcomes. The range (min/max) is
 * presented to practitioners as a "comparable cases" interval rather than a
 * single number, because the dataset (59 cases) does not support precision
 * tighter than ±8 percentage points (leave-one-out MAE 7.7pp).
 *
 * v2 changes:
 *   - the director-loan-sent-to-ATO flag dropped (only knowable ~6 weeks post-appointment,
 *     so it can't inform a pre-appointment prediction).
 *   - 3-tier traffic-light risk band derived from neighbour rejection count
 *     (NOT a calibrated probability — a classifier on these features matches
 *     baseline accuracy).
 *   - Payment-structure recommendation from the accepted neighbours.
 *   - Per-case plain-English outcome explanation.
 */

export interface SbrPredictionInput {
  dpn: boolean
  paymentPlanType: 'plan' | 'upfront'
  directorLoanAtAppointment: boolean
  // REMOVED in v2: the director-loan-sent-to-ATO flag (only knowable post-appointment)
  directorLoanReceivableAmount: number // AUD
  cumulativeDaysLate: number
  numberOfLateLodgements: number
  daysSinceLastPayment: number // use 9999 for "no payments ever"
}

export interface HistoricalSbrCase {
  id: string
  clientName: string
  features: SbrPredictionInput
  outcomePercent: number
  accepted: boolean
  creditorAmount: number
  sbrPayment: number
}

export interface ComparableCase {
  id: string
  clientName: string
  outcomePercent: number
  accepted: boolean
  creditorAmount: number
  sbrPayment: number
  features: SbrPredictionInput
  distance: number
  outcomeExplanation: string // plain-English why this case got its outcome
}

export type SbrFeatureKey = keyof SbrPredictionInput // now 7 keys, not 8

export interface FeatureBreakdownEntry {
  feature: SbrFeatureKey
  label: string
  inputValue: number | boolean | string
  medianInNeighbours: number | boolean | string
  influenceNote: string
}

// 3-tier traffic-light risk band.
export type SbrRiskBand = 'likely_accepted' | 'borderline' | 'high_rejection_risk'

// Payment structure recommendation, derived from the accepted neighbours.
export interface PaymentStructureRecommendation {
  recommended: 'plan' | 'upfront' | 'no_strong_signal'
  reasoning: string
  neighbourSplit: { plan: number; upfront: number }
}

// Summary of the offers (outcome %) within a group of comparables.
export interface OfferRange {
  min: number
  max: number
  median: number
  count: number
}

/**
 * Per-profile answer to Tom's "how do we learn from the rejections to get a
 * positive result?" question (26 May 2026).
 *
 * It compares accepted vs rejected neighbour offers and gives an HONEST,
 * data-driven verdict on whether a higher offer would realistically help THIS
 * profile — rather than a blanket "offer more" floor. Where rejected deals were
 * genuinely offered less than accepted ones, it says a higher offer should help
 * and gives the accepted band as the target. Where rejected deals offered as
 * much or more (e.g. Globexo rejected at 61.7%), it says a higher offer won't
 * flip it and points at the non-offer factors that actually drive rejection.
 */
export type OfferMoreVerdict =
  | 'higher_offer_may_help'
  | 'higher_offer_unlikely_to_help'
  | 'insufficient_signal'

export interface RejectionLearning {
  acceptedOfferRange: OfferRange | null
  rejectedOfferRange: OfferRange | null
  offerMoreVerdict: OfferMoreVerdict
  insight: string
}

/**
 * A concrete, actionable lever for moving a borderline / high-risk profile
 * closer to the accepted comparables (Gabby/Tom 26 May 2026: "how do we make
 * it accepted?"). Derived by comparing the client's actionable features against
 * the ACCEPTED neighbours only. These are associations from comparable accepted
 * deals — NOT guarantees of approval. `factor` is a short label, `suggestion`
 * is the action, `basis` is the comparison that justifies it.
 */
export interface ImprovementLever {
  factor: string
  suggestion: string
  basis: string
  current?: string // where this client sits now, e.g. "5,000 days late"
  target?: string // where accepted comparables sat, e.g. "≈50 days"
  impact?: 'high' | 'medium' // rough priority for ordering / display
}

export interface SbrAccuracyDisclosure {
  meanAbsoluteError: number // 7.7 (was hardcoded 6.1)
  intervalCoverage: string // '75%' (was '76%')
  sampleSize: number
  knownLimitations: string[]
  riskBandDisclaimer: string // explicit caveat about the risk band
}

export interface SbrPrediction {
  predictedOutcomePercent: number
  predictedLowPercent: number
  predictedHighPercent: number
  comparableCases: ComparableCase[]
  featureBreakdown: FeatureBreakdownEntry[]
  suggestedOfferAmount: number | null
  neighbourStdev: number
  trainingSetSize: number
  // v2 fields
  riskBand: SbrRiskBand
  riskBandReasoning: string
  rejectedNeighbours: ComparableCase[]
  paymentStructureRecommendation: PaymentStructureRecommendation
  rejectionLearning: RejectionLearning
  improvementLevers: ImprovementLever[]
  accuracyDisclosure: SbrAccuracyDisclosure
}
