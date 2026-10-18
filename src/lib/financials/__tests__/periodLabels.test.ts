import { describe, it, expect } from 'vitest'
import {
  currentPeriodAt,
  currentPeriodLabel,
  currentPeriodName,
  currentPeriodRange,
  shortDate,
  yearNotUploadedNote,
  yearSpan,
} from '../periodLabels'

/** How a current period is named everywhere. Synthetic dates only. */

describe('currentPeriodLabel', () => {
  it('names the FY and its dates, the year once when both dates share it', () => {
    const p = { financialYear: 2027, periodStartDate: '2026-07-01', periodEndDate: '2026-10-15' }
    expect(currentPeriodLabel(p)).toBe('FY2027 to date (1 Jul – 15 Oct 2026)')
    expect(currentPeriodName(p)).toBe('FY2027 to date')
    expect(currentPeriodAt(p)).toBe('15 Oct 2026 (FY2027 to date)')
  })

  it('shows both years when the period crosses a calendar year', () => {
    expect(currentPeriodRange({ financialYear: 2027, periodStartDate: '2026-07-01', periodEndDate: '2027-01-15' })).toBe(
      '1 Jul 2026 – 15 Jan 2027',
    )
  })

  it('starts at 1 July of the FY when the start date is missing', () => {
    expect(currentPeriodLabel({ financialYear: 2027, periodStartDate: null, periodEndDate: '2026-10-15' })).toBe(
      'FY2027 to date (1 Jul – 15 Oct 2026)',
    )
    expect(currentPeriodRange({ financialYear: 2026, periodEndDate: '2026-05-04' })).toBe('1 Jul 2025 – 4 May 2026')
  })

  it('keeps unreadable dates as they are', () => {
    expect(shortDate('not a date')).toBe('not a date')
    expect(currentPeriodRange({ financialYear: 2027, periodEndDate: 'soon' })).toBe('to soon')
  })
})

describe('notes', () => {
  it('names a year not uploaded, and a span of years', () => {
    expect(yearNotUploadedNote(2026)).toBe('Year ended 30 June 2026 not uploaded')
    expect(yearSpan([2025, 2022, 2023, 2024])).toBe('FY2022–FY2025')
    expect(yearSpan([2025])).toBe('FY2025')
    expect(yearSpan([])).toBe('')
  })
})
