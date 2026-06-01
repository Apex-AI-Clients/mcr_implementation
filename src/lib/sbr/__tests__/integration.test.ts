import { describe, it, expect } from 'vitest'
import { predictSbrOutcome } from '../predictOutcome'
import type { HistoricalSbrCase, SbrPredictionInput } from '../types'

/**
 * Hand-traced subset of the GABI training data â€” 10 cases chosen to span the
 * spread (low cumulative-days-late through high; low and high late-lodgement
 * counts; with/without DPN; plan and upfront). The query profile below is
 * deliberately mid-range, so the 8 closest neighbours should sit in the
 * 35â€“50% outcome band rather than the extremes.
 */
const trainingSet: HistoricalSbrCase[] = [
  {
    id: '1',
    clientName: 'Mumma G\'s Pizza & Pasta Pty Ltd',
    features: {
      dpn: false,
      paymentPlanType: 'plan',
      directorLoanAtAppointment: false,
      directorLoanReceivableAmount: 0,
      cumulativeDaysLate: 7,
      numberOfLateLodgements: 1,
      daysSinceLastPayment: 6,
    },
    outcomePercent: 36.3,
    accepted: true,
    creditorAmount: 446214,
    sbrPayment: 185000,
  },
  {
    id: '2',
    clientName: 'Shearwater Iga Pty Ltd',
    features: {
      dpn: false,
      paymentPlanType: 'plan',
      directorLoanAtAppointment: false,
      directorLoanReceivableAmount: 0,
      cumulativeDaysLate: 52,
      numberOfLateLodgements: 4,
      daysSinceLastPayment: 211,
    },
    outcomePercent: 34.4,
    accepted: true,
    creditorAmount: 419220.11,
    sbrPayment: 165000,
  },
  {
    id: '3',
    clientName: 'Ryenmal Pty Ltd',
    features: {
      dpn: false,
      paymentPlanType: 'plan',
      directorLoanAtAppointment: false,
      directorLoanReceivableAmount: 0,
      cumulativeDaysLate: 145,
      numberOfLateLodgements: 6,
      daysSinceLastPayment: 40,
    },
    outcomePercent: 33.7,
    accepted: true,
    creditorAmount: 291837.56,
    sbrPayment: 112500,
  },
  {
    id: '4',
    clientName: 'Glenmarks Property Services Pty Ltd',
    features: {
      dpn: false,
      paymentPlanType: 'plan',
      directorLoanAtAppointment: false,
      directorLoanReceivableAmount: 0,
      cumulativeDaysLate: 748,
      numberOfLateLodgements: 20,
      daysSinceLastPayment: 10,
    },
    outcomePercent: 40.0,
    accepted: true,
    creditorAmount: 262265,
    sbrPayment: 120000,
  },
  {
    id: '5',
    clientName: 'Guardian Care Community Innovation Pty Ltd',
    features: {
      dpn: false,
      paymentPlanType: 'plan',
      directorLoanAtAppointment: false,
      directorLoanReceivableAmount: 0,
      cumulativeDaysLate: 606,
      numberOfLateLodgements: 13,
      daysSinceLastPayment: 6,
    },
    outcomePercent: 40.1,
    accepted: true,
    creditorAmount: 458125.3,
    sbrPayment: 210000,
  },
  {
    id: '6',
    clientName: 'Salami Bros Pty Ltd',
    features: {
      dpn: false,
      paymentPlanType: 'plan',
      directorLoanAtAppointment: false,
      directorLoanReceivableAmount: 0,
      cumulativeDaysLate: 1546,
      numberOfLateLodgements: 12,
      daysSinceLastPayment: 62,
    },
    outcomePercent: 45.9,
    accepted: true,
    creditorAmount: 241617.71,
    sbrPayment: 120000,
  },
  {
    id: '7',
    clientName: 'HTB Felicitas Pty Ltd',
    features: {
      dpn: false,
      paymentPlanType: 'plan',
      directorLoanAtAppointment: false,
      directorLoanReceivableAmount: 0,
      cumulativeDaysLate: 2752,
      numberOfLateLodgements: 17,
      daysSinceLastPayment: 31,
    },
    outcomePercent: 40.1,
    accepted: true,
    creditorAmount: 381444,
    sbrPayment: 175000,
  },
  {
    id: '8',
    clientName: 'KSVN Partners Pty Ltd',
    features: {
      dpn: true,
      paymentPlanType: 'plan',
      directorLoanAtAppointment: false,
      directorLoanReceivableAmount: 0,
      cumulativeDaysLate: 6498,
      numberOfLateLodgements: 38,
      daysSinceLastPayment: 31,
    },
    outcomePercent: 51.6,
    accepted: true,
    creditorAmount: 229009,
    sbrPayment: 135000,
  },
  {
    id: '9',
    clientName: 'Globexo Pty Ltd',
    features: {
      dpn: true,
      paymentPlanType: 'upfront',
      directorLoanAtAppointment: false,
      directorLoanReceivableAmount: 0,
      cumulativeDaysLate: 45866,
      numberOfLateLodgements: 114,
      daysSinceLastPayment: 9999,
    },
    outcomePercent: 61.7,
    accepted: false,
    creditorAmount: 928421.62,
    sbrPayment: 600000,
  },
  {
    id: '10',
    clientName: 'Plumb Cut Carpentry Pty Limited',
    features: {
      dpn: true,
      paymentPlanType: 'upfront',
      directorLoanAtAppointment: false,
      directorLoanReceivableAmount: 0,
      cumulativeDaysLate: 3006,
      numberOfLateLodgements: 21,
      daysSinceLastPayment: 720,
    },
    outcomePercent: 50.5,
    accepted: true,
    creditorAmount: 271084.02,
    sbrPayment: 150000,
  },
]

describe('predictSbrOutcome â€” integration on GABI subset', () => {
  it('returns 8 neighbours from the mid range for a mid-range query', () => {
    const query: SbrPredictionInput = {
      dpn: false,
      paymentPlanType: 'plan',
      directorLoanAtAppointment: false,
      directorLoanReceivableAmount: 0,
      cumulativeDaysLate: 800,
      numberOfLateLodgements: 14,
      daysSinceLastPayment: 40,
    }

    const result = predictSbrOutcome(query, trainingSet, { creditorAmount: 300_000 })

    // Expect exactly k = 8 neighbours.
    expect(result.comparableCases).toHaveLength(8)
    const names = result.comparableCases.map((c) => c.clientName)

    // The 5 plan-cases with cumulativeDaysLate within ~3x of 800 must all be present.
    expect(names).toEqual(
      expect.arrayContaining([
        'Glenmarks Property Services Pty Ltd',
        'Guardian Care Community Innovation Pty Ltd',
        'Salami Bros Pty Ltd',
        'HTB Felicitas Pty Ltd',
      ]),
    )
    // Globexo is the worst outlier â€” should NOT make the top 8 when 10 cases are available.
    // (It will appear when training is exactly 8 cases; with 10 it should be excluded.)
    expect(names).not.toContain('Globexo Pty Ltd')

    // Predicted outcome lands in the realistic 35â€“50% window.
    expect(result.predictedOutcomePercent).toBeGreaterThan(35)
    expect(result.predictedOutcomePercent).toBeLessThan(50)
    expect(result.predictedLowPercent).toBeGreaterThanOrEqual(33)
    expect(result.predictedHighPercent).toBeLessThanOrEqual(55)

    // Suggested offer is back-calculated and positive.
    expect(result.suggestedOfferAmount).not.toBeNull()
    expect(result.suggestedOfferAmount as number).toBeGreaterThan(0)
  })

  it('explainer notes use the expected directional language for elevated late-lodgement metrics', () => {
    const query: SbrPredictionInput = {
      dpn: false,
      paymentPlanType: 'plan',
      directorLoanAtAppointment: false,
      directorLoanReceivableAmount: 0,
      cumulativeDaysLate: 5000,
      numberOfLateLodgements: 30,
      daysSinceLastPayment: 200,
    }
    const result = predictSbrOutcome(query, trainingSet)

    const cumDays = result.featureBreakdown.find((f) => f.feature === 'cumulativeDaysLate')
    expect(cumDays).toBeDefined()
    expect(cumDays!.influenceNote.toLowerCase()).toMatch(/above median|push|higher/i)

    const dpnEntry = result.featureBreakdown.find((f) => f.feature === 'dpn')
    expect(dpnEntry).toBeDefined()
    expect(dpnEntry!.influenceNote).toMatch(/aligned|differs/i)
  })
})
