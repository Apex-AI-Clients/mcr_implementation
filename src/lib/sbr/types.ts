/**
 * Types for the SBR outcome prediction feature.
 *
 * Methodology agreed with Gabby + Tom (May 2026): k-NN (k=8) over an
 * 8-feature standardised vector. Predicted outcome = mean of the 8 nearest
 * neighbours' historical outcomes. The range (min/max) is presented to
 * practitioners as a "comparable cases" interval rather than a single number,
 * because the dataset (49 cases) does not support precision tighter than
 * ±6 percentage points (leave-one-out MAE).
 */

export interface SbrPredictionInput {
  dpn: boolean
  paymentPlanType: 'plan' | 'upfront'
  directorLoanAtAppointment: boolean
  directorLoanSentToAto: boolean
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
}

export type SbrFeatureKey = keyof SbrPredictionInput

export interface FeatureBreakdownEntry {
  feature: SbrFeatureKey
  label: string
  inputValue: number | boolean | string
  medianInNeighbours: number | boolean | string
  influenceNote: string
}

export interface SbrAccuracyDisclosure {
  meanAbsoluteError: 6.1
  intervalCoverage: '76%'
  sampleSize: number
  knownLimitations: string[]
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
  accuracyDisclosure: SbrAccuracyDisclosure
}
