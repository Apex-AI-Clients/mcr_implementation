import { describe, it, expect } from 'vitest'
import {
  ATO_ACCOUNT_CREDITOR_ROWS,
  CREDITOR_LABEL_MAX,
  atoAccountCreditorRows,
  DEFAULT_CREDITORS,
  MAX_CREDITOR_ROWS,
  creditorTotal,
  defaultCreditorRows,
  normaliseCreditorRows,
  readSavedCreditors,
} from '../creditors'

/** Creditors in the SBR. Synthetic figures and labels only. */

describe('rows and total', () => {
  it('starts with six default labels and no amounts', () => {
    expect(defaultCreditorRows().map((r) => r.label)).toEqual(['Credit cards', 'Cash loans', 'Bank overdraft', 'Trade suppliers'])
    expect(defaultCreditorRows().map((r) => r.kind)).toEqual(['creditCards', 'cashLoans', 'bankOverdraft', 'tradeSuppliers'])
    expect(defaultCreditorRows().every((r) => r.amount === null)).toBe(true)
  })

  it('adds the ATO debt and every row with an amount', () => {
    const rows = normaliseCreditorRows([{ label: 'Credit cards', amount: 12_500 }, { label: 'Overdraft', amount: 0 }, { label: 'Supplier', amount: 7_500 }])
    expect(creditorTotal(100_000, rows)).toBe(120_000)
    expect(creditorTotal(null, rows)).toBe(20_000)
    expect(creditorTotal(100_000, defaultCreditorRows())).toBe(100_000)
    expect(creditorTotal(null, defaultCreditorRows())).toBeNull()
  })

  it('keeps the rows as given, cleaning labels and amounts', () => {
    const rows = normaliseCreditorRows([
      { label: `  ${'x'.repeat(80)}  `, amount: -5 },
      { label: 'Fuel card', amount: Number.NaN },
      { label: 'Renamed overdraft', amount: 900, kind: 'bankOverdraft' },
      { label: 'Odd', amount: 1, kind: 'nope' as never },
    ])
    expect(rows).toHaveLength(4)
    expect(rows[0].label).toHaveLength(CREDITOR_LABEL_MAX)
    expect(rows[0].amount).toBeNull()
    expect(rows[1]).toEqual({ label: 'Fuel card', amount: null })
    expect(rows[2]).toEqual({ label: 'Renamed overdraft', amount: 900, kind: 'bankOverdraft' })
    expect(rows[3]).toEqual({ label: 'Odd', amount: 1 })
  })

  it('allows no rows, and at most MAX_CREDITOR_ROWS', () => {
    expect(normaliseCreditorRows([])).toEqual([])
    expect(normaliseCreditorRows(null)).toEqual(defaultCreditorRows())
    const many = Array.from({ length: MAX_CREDITOR_ROWS + 5 }, (_, i) => ({ label: `C${i}`, amount: 1 }))
    expect(normaliseCreditorRows(many)).toHaveLength(MAX_CREDITOR_ROWS)
  })

  it('reads a saved value defensively', () => {
    expect(readSavedCreditors(null)).toBeNull()
    expect(readSavedCreditors({ atoDebt: 50_000, atoDebtEdited: true, rows: [{ label: 'Cards', amount: 1_000 }] })).toEqual({
      atoDebt: 50_000,
      atoDebtEdited: true,
      rows: normaliseCreditorRows([{ label: 'Cards', amount: 1_000 }]),
    })
    expect(readSavedCreditors({ rows: 'nope' })?.rows).toEqual(defaultCreditorRows())
    expect(readSavedCreditors({ rows: [] })?.rows).toEqual([])
  })
})

describe('default rows', () => {
  it('has no default row for secured finance', () => {
    expect(DEFAULT_CREDITORS.some((c) => /finance|equipment|vehicle/i.test(c.label))).toBe(false)
  })
})

describe('rows saved by the fixed six-row version', () => {
  it('gets the kinds back from the default labels and drops empty "other" rows', () => {
    const saved = readSavedCreditors({
      atoDebt: 10_000,
      atoDebtEdited: false,
      rows: [
        { label: 'Credit cards', amount: 1_000 },
        { label: 'Cash loans', amount: null },
        { label: 'Bank overdraft', amount: null },
        { label: 'Trade suppliers', amount: null },
        { label: 'Other creditor 1', amount: 2_500 },
        { label: 'Other creditor 2', amount: null },
      ],
    })
    expect(saved?.rows).toEqual([
      { label: 'Credit cards', amount: 1_000, kind: 'creditCards' },
      { label: 'Cash loans', amount: null, kind: 'cashLoans' },
      { label: 'Bank overdraft', amount: null, kind: 'bankOverdraft' },
      { label: 'Trade suppliers', amount: null, kind: 'tradeSuppliers' },
      { label: 'Other creditor 1', amount: 2_500 },
    ])
  })
})

describe('a row per other ATO account (behind a setting)', () => {
  it('is off until Gabby confirms', () => {
    expect(ATO_ACCOUNT_CREDITOR_ROWS).toBe(false)
  })

  it('names and dates each account owed, leaving out the one the ATO debt row already is, and credits', () => {
    const rows = atoAccountCreditorRows(
      [
        { kind: 'activity_statement', label: 'Activity statement 002', balance: 40_000, balanceDate: '2026-10-12' },
        { kind: 'activity_statement', label: 'Activity statement 001', balance: 3_000, balanceDate: '2026-09-26' },
        { kind: 'income_tax', label: 'Income tax 001', balance: 20_100.5, balanceDate: '2026-10-01' },
        { kind: 'super_guarantee', label: 'Superannuation guarantee employer 005', balance: 50_000, balanceDate: '2026-09-22' },
        { kind: 'income_tax', label: 'Income tax 002', balance: -500, balanceDate: '2026-10-01' },
      ],
      'activity statement 002',
    )
    expect(rows).toEqual([
      { label: 'ATO: Activity statement 001, at 26 Sep 2026', amount: 3_000 },
      { label: 'ATO: Income tax 001, at 1 Oct 2026', amount: 20_100.5 },
      { label: 'ATO: Superannuation guarantee employer 005, at 22 Sep 2026', amount: 50_000 },
    ])
    expect(rows.every((r) => r.label.length <= CREDITOR_LABEL_MAX)).toBe(true)
  })
})

