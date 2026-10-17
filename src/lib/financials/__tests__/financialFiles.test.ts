import { describe, it, expect } from 'vitest'
import { applyPeriodOverride, periodOverrideOf } from '../periodOverride'
import { describeFinancialFiles, overrideYearOptions, type FinancialFileInput } from '../financialFiles'
import type { FinancialsPrepass } from '../prepass'
import type {
  ExtractedBalanceSheet,
  ExtractedIncomeStatement,
  FinancialStatementSourceColumn,
  StoredStatementSlot,
} from '../types'

/** One upload area: per-file overrides, and what became of each file. SYNTHETIC data. */

const IS = { income: { sales: 1 }, cogs: {}, expenses: {}, totals: {} } as ExtractedIncomeStatement
const BS = { totals: { totalAssets: 1 } } as unknown as ExtractedBalanceSheet

function slot(year: number, column: FinancialStatementSourceColumn, doc: string, periodLabel: string | null = null): StoredStatementSlot {
  const half = <T,>(data: T) => ({ data, documentId: doc, sourceFilename: `${doc}.pdf`, extractedAt: null, warnings: [] })
  return {
    id: `${year}-${column}-${doc}`,
    financialYear: year,
    periodEndDate: `${year}-06-30`,
    periodStartDate: null,
    periodLabel,
    sourceColumn: column,
    incomeStatement: half(IS),
    balanceSheet: half(BS),
    slotWarnings: [],
    legacy: false,
    extractionModel: null,
  }
}

function doc(id: string, override: FinancialFileInput['override'] = null, overrideAt: string | null = null): FinancialFileInput {
  return { id, filename: `${id}.pdf`, override, overrideBy: override ? 'Sam' : null, overrideAt }
}

function prepass(over: Partial<FinancialsPrepass['classification']> = {}): FinancialsPrepass {
  return {
    encrypted: false,
    pageCount: 4,
    failure: null,
    pages: [],
    classification: {
      kind: 'combined',
      hasTextLayer: true,
      pages: [],
      statementPages: { income_statement: [], balance_sheet: [] },
      periods: [],
      headingYears: [2024],
      currentPeriodYear: null,
      comparativeYears: [2023],
      entity: null,
      ...over,
    },
  }
}

describe('applyPeriodOverride', () => {
  it('leaves the pre-pass alone without an override', () => {
    const p = prepass()
    expect(applyPeriodOverride(p, null)).toEqual({ prepass: p, warning: null })
  })

  it('sets an annual year, keeping a comparative column a year before', () => {
    const { prepass: out, warning } = applyPeriodOverride(prepass(), { kind: 'annual', financialYear: 2025 })
    expect(out.classification).toMatchObject({ headingYears: [2025], comparativeYears: [2024], currentPeriodYear: null })
    expect(warning?.message).toMatch(/annual, FY2025, as set by staff/)
  })

  it('adds no comparative year when the headings showed none', () => {
    const { prepass: out } = applyPeriodOverride(prepass({ comparativeYears: [] }), { kind: 'annual', financialYear: 2025 })
    expect(out.classification.comparativeYears).toEqual([])
  })

  it('turns an annual reading into a current period', () => {
    const { prepass: out } = applyPeriodOverride(prepass(), { kind: 'current_period', financialYear: 2027 })
    expect(out.classification).toMatchObject({ headingYears: [], comparativeYears: [], currentPeriodYear: 2027 })
  })

  it('never changes what the file is', () => {
    const { prepass: out } = applyPeriodOverride(prepass({ kind: 'tax_return_only' }), { kind: 'annual', financialYear: 2025 })
    expect(out.classification.kind).toBe('tax_return_only')
  })

  it('reads an override from the document row only when complete', () => {
    expect(periodOverrideOf({ fs_override_kind: 'annual', fs_override_fy: 2025 })).toEqual({ kind: 'annual', financialYear: 2025 })
    expect(periodOverrideOf({ fs_override_kind: 'annual', fs_override_fy: null })).toBeNull()
    expect(periodOverrideOf({ fs_override_kind: 'quarterly', fs_override_fy: 2025 })).toBeNull()
  })
})

describe('describeFinancialFiles', () => {
  const EXTRACTED = '2026-10-01T00:00:00Z'
  const extracted = (...ids: string[]) => ids.map((documentId) => ({ documentId, kind: 'combined' as const, extractedAt: EXTRACTED }))

  it("sorts Gabby's example: five annual files and a current period", () => {
    const years = [2022, 2023, 2024, 2025, 2026]
    const rows = describeFinancialFiles({
      documents: [...years.map((y) => doc(`fy${y}`)), doc('cp27')],
      slots: [
        ...years.map((y) => slot(y, 'primary', `fy${y}`)),
        slot(2027, 'current_period', 'cp27', '1 July 2026 to 30 September 2026'),
      ],
      extractions: extracted(...years.map((y) => `fy${y}`), 'cp27'),
    })
    expect(rows.map((r) => [r.documentId, r.usage])).toEqual([
      ['fy2022', 'older'],
      ['fy2023', 'used'],
      ['fy2024', 'used'],
      ['fy2025', 'used'],
      ['fy2026', 'used'],
      ['cp27', 'used'],
    ])
    expect(rows[0].note).toBe('Annual FY2022: older than the four years compared, so shown only.')
    expect(rows[5].note).toBe('Used as the current period (1 July 2026 to 30 September 2026).')
  })

  it('says a current period is superseded once its year has an annual statement', () => {
    const [annual, current] = describeFinancialFiles({
      documents: [doc('fy26'), doc('cp26')],
      slots: [slot(2026, 'primary', 'fy26'), slot(2026, 'current_period', 'cp26')],
      extractions: extracted('fy26', 'cp26'),
    })
    expect(annual.usage).toBe('used')
    expect(current).toMatchObject({ usage: 'superseded', currentPeriodYear: 2026 })
    expect(current.note).toMatch(/FY2026 already has its annual statement, so this file isn't used/)
  })

  it('says when a later current period is on file', () => {
    const rows = describeFinancialFiles({
      documents: [doc('cp26'), doc('cp27')],
      slots: [slot(2026, 'current_period', 'cp26'), slot(2027, 'current_period', 'cp27')],
      extractions: extracted('cp26', 'cp27'),
    })
    expect(rows.map((r) => r.usage)).toEqual(['later_current_on_file', 'used'])
  })

  it('explains files that gave nothing', () => {
    const rows = describeFinancialFiles({
      documents: [doc('deed'), doc('tax'), doc('blank'), doc('new')],
      slots: [],
      extractions: [
        { documentId: 'deed', kind: 'not_financial', extractedAt: EXTRACTED },
        { documentId: 'tax', kind: 'tax_return_only', extractedAt: EXTRACTED },
        { documentId: 'blank', kind: 'unknown', extractedAt: EXTRACTED },
      ],
    })
    expect(rows.map((r) => r.usage)).toEqual(['not_financial', 'tax_return_only', 'nothing_read', 'not_read'])
  })

  it('names the years a file gives only through its prior-year column', () => {
    const [row] = describeFinancialFiles({
      documents: [doc('fy25')],
      slots: [slot(2025, 'primary', 'other'), slot(2024, 'comparative', 'fy25')],
      extractions: extracted('fy25'),
    })
    expect(row).toMatchObject({ usage: 'used', comparativeYears: [2024], note: 'Supplies FY2024 from its prior-year column.' })
  })

  it('flags an override set after the last read, until the file is read again', () => {
    const override = { kind: 'annual' as const, financialYear: 2025 }
    const [pending] = describeFinancialFiles({
      documents: [doc('a', override, '2026-10-05T00:00:00Z')],
      slots: [slot(2024, 'primary', 'a')],
      extractions: extracted('a'),
    })
    expect(pending.overridePending).toBe(true)
    expect(pending.note).toMatch(/^Set to annual, FY2025\. Read the file again to apply it\./)

    const [applied] = describeFinancialFiles({
      documents: [doc('a', override, '2026-09-01T00:00:00Z')],
      slots: [slot(2025, 'primary', 'a')],
      extractions: extracted('a'),
    })
    expect(applied.overridePending).toBe(false)
  })
})

describe('overrideYearOptions', () => {
  it('runs from the next FY back ten years', () => {
    // 17 Oct 2026 is in FY2027.
    const years = overrideYearOptions(new Date('2026-10-17T00:00:00'))
    expect(years[0]).toBe(2028)
    expect(years[1]).toBe(2027)
    expect(years.at(-1)).toBe(2017)
  })
})
