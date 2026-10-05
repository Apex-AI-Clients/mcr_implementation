import { describe, it, expect } from 'vitest'
import { correctYear, decidePresence } from '../columnChecks'
import { planDocument } from '../documentPlan'
import { buildExtractionContext } from '../extractionContext'
import type { FinancialsPrepass } from '../prepass'
import type { ResolvedYears } from '../resolveYear'
import type { FinancialDocumentKind } from '../types'

/** Cross-checks between the model's columns and the pre-pass. Pure; synthetic values. */

const REAL_IS = { income: { sales: 100 }, cogs: {}, expenses: {}, totals: {} }
const REAL_BS = { totals: { totalAssets: 10 } }
const EMPTY = {}

const presence = (kind: FinancialDocumentKind, half: 'income_statement' | 'balance_sheet', data: unknown, modelSaysPresent?: boolean) =>
  decidePresence({ half, modelSaysPresent, data, kind, financialYear: 2025, sourceColumn: 'primary' })

describe('decidePresence', () => {
  it('drops balance sheet figures from a P&L-only document, with a warning', () => {
    const result = presence('pnl_only', 'balance_sheet', REAL_BS, true)
    expect(result.present).toBe(false)
    expect(result.warning?.kind).toBe('presence_mismatch')
  })

  it('says nothing when a P&L-only document correctly has no balance sheet', () => {
    expect(presence('pnl_only', 'balance_sheet', EMPTY, false)).toEqual({ present: false, warning: null })
  })

  it('keeps real figures the pre-pass expects, even if the model flag says absent', () => {
    expect(presence('combined', 'income_statement', REAL_IS, false)).toEqual({ present: true, warning: null })
  })

  it('warns when an expected statement came back empty', () => {
    const result = presence('combined', 'balance_sheet', EMPTY, true)
    expect(result.present).toBe(false)
    expect(result.warning?.message).toMatch(/expected/)
  })

  it('follows the model flag, with real figures, when the pre-pass could not tell', () => {
    expect(presence('unknown', 'income_statement', REAL_IS, true).present).toBe(true)
    expect(presence('unknown', 'income_statement', REAL_IS, false).present).toBe(false)
    expect(presence('unknown', 'income_statement', EMPTY, true).present).toBe(false)
  })
})

const years = (over: Partial<ResolvedYears> = {}): ResolvedYears => ({
  annualYears: [2025],
  currentPeriodYear: null,
  source: 'heading',
  filename: null,
  conflict: null,
  ...over,
})

describe('correctYear', () => {
  it('keeps a year that matches the heading', () => {
    expect(correctYear({ modelYear: 2025, sourceColumn: 'primary', years: years() })).toEqual({ financialYear: 2025, warning: null })
    expect(correctYear({ modelYear: 2024, sourceColumn: 'comparative', years: years() })).toEqual({ financialYear: 2024, warning: null })
  })

  it('moves a mislabelled column to the year the heading names, and says so', () => {
    const primary = correctYear({ modelYear: 2024, sourceColumn: 'primary', years: years() })
    expect(primary.financialYear).toBe(2025)
    expect(primary.warning?.kind).toBe('year_mismatch')
    expect(correctYear({ modelYear: 2023, sourceColumn: 'comparative', years: years() }).financialYear).toBe(2024)
  })

  it('checks a current-period column against the current-period heading', () => {
    const y = years({ annualYears: [], currentPeriodYear: 2026 })
    expect(correctYear({ modelYear: 2025, sourceColumn: 'current_period', years: y }).financialYear).toBe(2026)
  })

  it('leaves the year alone when only the filename, or nothing, named one', () => {
    expect(correctYear({ modelYear: 2023, sourceColumn: 'primary', years: years({ source: 'filename' }) }).warning).toBeNull()
    expect(correctYear({ modelYear: 2023, sourceColumn: 'primary', years: years({ source: 'none', annualYears: [] }) }).warning).toBeNull()
  })

  it('does not guess when the headings name more than one annual year', () => {
    const y = years({ annualYears: [2024, 2025] })
    expect(correctYear({ modelYear: 2023, sourceColumn: 'primary', years: y })).toEqual({ financialYear: 2023, warning: null })
  })
})

const prepass = (kind: FinancialDocumentKind, failure: FinancialsPrepass['failure'] = null): FinancialsPrepass => ({
  classification: {
    kind,
    hasTextLayer: failure !== 'no_text_layer',
    pages: [],
    statementPages: { income_statement: [], balance_sheet: [] },
    periods: [],
    headingYears: [],
    currentPeriodYear: null,
    comparativeYears: [],
    entity: null,
  },
  encrypted: false,
  pageCount: 1,
  failure,
})

describe('planDocument', () => {
  it('stores nothing from a trust deed or a bare tax return, and says why', () => {
    for (const kind of ['not_financial', 'tax_return_only'] as const) {
      const plan = planDocument(prepass(kind))
      expect(plan.extract).toBe(false)
      expect(plan.warnings[0].kind).toBe('document_kind')
    }
  })

  it('extracts everything else, warning when the pages could not be checked', () => {
    expect(planDocument(prepass('combined'))).toEqual({ extract: true, warnings: [] })
    const scan = planDocument(prepass('unknown', 'no_text_layer'))
    expect(scan.extract).toBe(true)
    expect(scan.warnings[0].message).toMatch(/no text layer/)
    expect(planDocument(prepass('unknown', 'password_protected')).warnings[0].message).toMatch(/password/)
  })
})

describe('buildExtractionContext', () => {
  const selection = (mode: 'statement_pages' | 'named_pages_whole_file' | 'whole_file') => ({
    mode,
    sentPages: [1],
    statementPages: { income_statement: [5], balance_sheet: [6, 7] },
  })

  it('names the statement pages of an encrypted file and rules out the tax return', () => {
    const text = buildExtractionContext({
      sourceFilename: 'synthetic.pdf',
      classification: { kind: 'combined', comparativeYears: [2024] },
      years: years(),
      selection: selection('named_pages_whole_file'),
    })
    expect(text).toContain('the Income Statement is on page 5 and the Balance Sheet is on pages 6 and 7')
    expect(text).toMatch(/Tax Return/)
    expect(text).toContain('financialYear MUST be 2025')
    expect(text).toContain('also show 2024')
  })

  it('tells the model a P&L-only file has no balance sheet', () => {
    const text = buildExtractionContext({
      sourceFilename: '2024-2025_PROFIT_AND_LOSS.pdf',
      classification: { kind: 'pnl_only', comparativeYears: [] },
      years: years(),
      selection: selection('statement_pages'),
    })
    expect(text).toContain('Income Statement (Profit and Loss) ONLY')
    expect(text).toContain('balanceSheetPresent to false')
    expect(text).toContain('cut down to the statement pages only')
  })

  it('falls back to the filename year, then to the heading alone', () => {
    const fromName = buildExtractionContext({
      sourceFilename: 'Balance_sheet_23-24.pdf',
      classification: { kind: 'unknown', comparativeYears: [] },
      years: years({ source: 'filename', annualYears: [2024], filename: { year: 2024, pattern: 'range' } }),
      selection: selection('whole_file'),
    })
    expect(fromName).toContain('filename suggests PRIMARY financial year 2024')
    const nothing = buildExtractionContext({
      sourceFilename: 'scan.pdf',
      classification: { kind: 'unknown', comparativeYears: [] },
      years: years({ source: 'none', annualYears: [] }),
      selection: selection('whole_file'),
    })
    expect(nothing).toContain('derive financialYear ONLY from the PDF heading')
  })
})
