import { describe, it, expect } from 'vitest'
import type { PdfLine } from '@/lib/pdf/pageLines'
import { parseAmount } from '../amounts'
import { columnPeriod, titlePeriod } from '../periods'
import { readStatements } from '../readStatements'
import { verifyStatements } from '../verify'

/** The as-printed reader. Synthetic statements only; the real PDFs are checked by `npm run printed:check`. */

type Cell = [x: number, right: number, text: string]
const line = (...cells: Cell[]): PdfLine => ({ text: cells.map((c) => c[2]).join(' '), cells: cells.map(([x, right, text]) => ({ x, right, text })) })
/** A label at `x` with one figure per column, right-aligned on the columns' right edges. */
const row = (x: number, label: string, rights: number[], ...figures: string[]): PdfLine =>
  line(...([[x, x + label.length * 5, label]] as Cell[]).filter((c) => c[2] !== ''), ...figures.map((f, i): Cell => [rights[i] - f.length * 5, rights[i], f]))

describe('parseAmount', () => {
  it.each([
    ['1,234', 1234],
    ['1,234.56', 1234.56],
    ['A$84,833.86', 84833.86],
    ['$1,234', 1234],
    ['AUD 1,234', 1234],
    ['-1,234', -1234],
    ['(1,234)', -1234],
    ['1,234 -', -1234],
    ['1,234 CR', -1234],
    ['1,234 DR', 1234],
    ['0.00', 0],
    ['-18,218.18', -18218.18],
  ])('%s is %s', (text, value) => {
    expect(parseAmount(text)).toMatchObject({ kind: 'amount', value })
  })

  it('reads "-", "–" and blank as nil, a percentage as a ratio, and a label as not an amount', () => {
    for (const nil of ['-', '–', '']) expect(parseAmount(nil)).toEqual({ kind: 'amount', value: null, cents: false })
    expect(parseAmount('88%')).toEqual({ kind: 'ratio', text: '88%' })
    expect(parseAmount('Page 3 of 10')).toBeUndefined()
    expect(parseAmount('3/5')).toBeUndefined()
  })
})

describe('periods', () => {
  it('reads every printed form of an annual period as that financial year', () => {
    for (const title of ['For the year ended 30 June 2024', 'for the period ended 30 June 2024', 'July 2023 - June 2024']) {
      expect(columnPeriod('Total', titlePeriod([title]), 'profit_and_loss')).toMatchObject({ periodStart: '2023-07-01', periodEnd: '2024-06-30', kind: 'annual', financialYear: 2024 })
    }
    for (const title of ['As of June 30, 2024', 'As at 30 June 2024', 'As at 30 JUN 2024']) {
      expect(columnPeriod('Total', titlePeriod([title]), 'balance_sheet')).toMatchObject({ periodStart: null, periodEnd: '2024-06-30', kind: 'annual', financialYear: 2024 })
    }
  })

  it('takes a comparative column year from its header and the day and month from the title', () => {
    expect(columnPeriod('2023', titlePeriod(['For the year ended 30 June 2024']), 'profit_and_loss')).toMatchObject({
      periodStart: '2022-07-01',
      periodEnd: '2023-06-30',
      kind: 'annual',
      financialYear: 2023,
    })
    expect(columnPeriod('30 JUNE 2023', titlePeriod(['As at 30 June 2024']), 'balance_sheet')).toMatchObject({ periodEnd: '2023-06-30', financialYear: 2023 })
  })

  it('ends a ranged header on its last date', () => {
    expect(columnPeriod('1 JULY 2025-4 MAY 2026', titlePeriod(['For the period 1 July 2025 to 4 May 2026']), 'profit_and_loss')).toMatchObject({
      periodStart: '2025-07-01',
      periodEnd: '2026-05-04',
      kind: 'current_period',
      financialYear: 2026,
    })
  })

  it('reads anything shorter than 12 months to 30 June as the current period', () => {
    expect(columnPeriod('JULY-SEPT 2026', titlePeriod(['For the 3 months ended 30 September 2026']), 'profit_and_loss')).toMatchObject({
      periodStart: '2026-07-01',
      periodEnd: '2026-09-30',
      kind: 'current_period',
      financialYear: 2027,
    })
    expect(columnPeriod('1 JULY-15 OCT 2026', titlePeriod(['For the period 1 July 2026 to 15 October 2026']), 'profit_and_loss')).toMatchObject({
      periodStart: '2026-07-01',
      periodEnd: '2026-10-15',
      kind: 'current_period',
    })
    expect(columnPeriod('15 OCT 2026', titlePeriod(['As at 15 October 2026']), 'balance_sheet')).toMatchObject({ kind: 'current_period', financialYear: 2027 })
  })
})

const R2 = [400, 470]

/** A two-column, flat (unindented) trust P&L in whole dollars, on one page. */
function flatProfitAndLoss(): PdfLine[][] {
  return [
    [
      line([200, 300, 'EXAMPLE PTY LTD']),
      line([200, 320, 'PROFIT AND LOSS STATEMENT']),
      line([200, 330, 'for the year ended 30 June 2025']),
      line([25, 27, '.'], [380, 400, '2025'], [450, 470, '2024']),
      line([388, 392, '$'], [458, 462, '$']),
      line([25, 60, 'Income']),
      row(25, 'Service fee', R2, '100,000', '90,000'),
      row(25, 'Total Income', R2, '100,000', '90,000'),
      line([25, 90, 'Cost of sales']),
      row(25, 'Opening Stock', R2, '5,000', '4,000'),
      row(25, 'Purchases', R2, '20,000', '18,000'),
      row(25, 'Less: Closing Stock', R2, '6,000', '5,000'),
      row(25, 'Total COGS', R2, '19,000', '17,000'),
      row(25, 'Gross profit on trading', R2, '81,000', '73,000'),
      line([25, 90, 'Expenses']),
      row(25, 'Rent', R2, '30,000', '30,000'),
      line([25, 50, 'Wages'], [397, 400, '-'], [467, 470, '-']),
      row(25, 'Total expenses', R2, '30,000', '30,000'),
      row(25, 'NET PROFIT', R2, '51,000', '43,000'),
      // "- 4,000": a minus printed left of its figure, in the same column.
      line([25, 120, 'Less prior year loss'], [352, 355, '-'], [370, 400, '4,000'], [422, 425, '-'], [440, 470, '3,000']),
      row(25, 'NET PROFIT AFTER LOSS', R2, '47,000', '40,000'),
      line([25, 40, 'NOTE:']),
      line([25, 300, 'To be read in conjunction with the attached Balance Sheet.']),
    ],
  ]
}

describe('readStatements', () => {
  it('reads every printed row: labels, figures per column, minus signs, nil, headings and totals', () => {
    const read = readStatements(flatProfitAndLoss())
    expect(read.issues).toEqual([])
    expect(read.status).toBe('read')
    const [st] = read.statements
    expect(st).toMatchObject({ kind: 'profit_and_loss', title: 'PROFIT AND LOSS STATEMENT', pages: [1], wholeDollars: true })
    expect(st.columns.map((c) => c.financialYear)).toEqual([2025, 2024])
    expect(st.rows.map((r) => [r.style, r.path.join(' > '), r.label, r.amounts])).toEqual([
      ['heading', '', 'Income', [null, null]],
      ['line', 'Income', 'Service fee', [100000, 90000]],
      ['subtotal', 'Income', 'Total Income', [100000, 90000]],
      ['heading', '', 'Cost of sales', [null, null]],
      ['line', 'Cost of sales', 'Opening Stock', [5000, 4000]],
      ['line', 'Cost of sales', 'Purchases', [20000, 18000]],
      ['line', 'Cost of sales', 'Less: Closing Stock', [6000, 5000]],
      ['subtotal', 'Cost of sales', 'Total COGS', [19000, 17000]],
      ['total', '', 'Gross profit on trading', [81000, 73000]],
      ['heading', '', 'Expenses', [null, null]],
      ['line', 'Expenses', 'Rent', [30000, 30000]],
      ['line', 'Expenses', 'Wages', [null, null]],
      ['subtotal', 'Expenses', 'Total expenses', [30000, 30000]],
      ['total', '', 'NET PROFIT', [51000, 43000]],
      ['line', '', 'Less prior year loss', [-4000, -3000]],
      ['total', '', 'NET PROFIT AFTER LOSS', [47000, 40000]],
    ])
  })

  it('verifies every printed total, with "Less" lines taken off and costs against income', () => {
    const checks = verifyStatements(readStatements(flatProfitAndLoss()).statements)
    expect(checks.length).toBeGreaterThan(0)
    expect(checks.filter((c) => c.status !== 'ok')).toEqual([])
  })

  it('reads indented sections, a statement continued overleaf, notes columns and running footers', () => {
    const R = [539]
    const page = (n: number, body: PdfLine[]) => [
      line([57, 200, 'Balance Sheet']),
      ...(n === 1 ? [line([57, 200, 'As at 30 June 2024'])] : []),
      line([458, 479, 'NOTES'], [498, 539, '30 JUNE 2024']),
      ...body,
      line([57, 400, 'The accompanying notes form part of these financial statements.']),
      line([57, 120, 'Example Trust'], [504, 539, `Page ${n} of 2`]),
    ]
    const read = readStatements([
      page(1, [
        line([57, 90, 'Assets']),
        line([64, 120, 'Current Assets']),
        line([71, 130, 'Cash at Bank'], [475, 479, '2'], [517, 539, '1,000']),
        row(71, 'Total Current Assets', R, '1,000'),
        row(64, 'Total Assets', R, '1,000'),
        line([57, 90, 'Liabilities']),
        row(64, 'GST', R, '400'),
        row(64, 'Total Liabilities', R, '400'),
        row(57, 'Net Assets', R, '600'),
        line([57, 90, 'Equity']),
      ]),
      page(2, [row(64, 'Retained Earnings', R, '590'), row(64, 'Settled Sum', R, '10'), row(64, 'Total Equity', R, '600')]),
    ])
    expect(read.issues).toEqual([])
    const [st] = read.statements
    expect(st.pages).toEqual([1, 2])
    expect(st.rows.map((r) => `${r.style}:${[...r.path, r.label].join(' > ')}=${r.amounts[0]}`)).toEqual([
      'heading:Assets=null',
      'heading:Assets > Current Assets=null',
      'line:Assets > Current Assets > Cash at Bank=1000',
      'subtotal:Assets > Current Assets > Total Current Assets=1000',
      'subtotal:Assets > Total Assets=1000',
      'heading:Liabilities=null',
      'line:Liabilities > GST=400',
      'subtotal:Liabilities > Total Liabilities=400',
      'total:Net Assets=600',
      'heading:Equity=null',
      'line:Equity > Retained Earnings=590',
      'line:Equity > Settled Sum=10',
      'subtotal:Equity > Total Equity=600',
    ])
    expect(verifyStatements(read.statements).filter((c) => c.status !== 'ok')).toEqual([])
  })

  it('reports a total that does not add up, and one printed in the wrong column', () => {
    const pages = flatProfitAndLoss()
    // Total expenses printed swapped: each column holds the other's total.
    pages[0][15] = row(25, 'Rent', R2, '30,000', '25,000')
    pages[0][17] = row(25, 'Total expenses', R2, '25,000', '30,000')
    const failures = verifyStatements(readStatements(pages).statements).filter((c) => c.status !== 'ok' && c.status !== 'rounding')
    expect(failures.find((c) => c.label === 'Total expenses' && c.column === 0)?.status).toBe('wrong_column')
  })

  it('joins a header that wraps onto a second line to its column', () => {
    const read = readStatements([
      [
        line([57, 200, 'Profit and Loss']),
        line([57, 300, 'For the period 1 July 2025 to 4 May 2026']),
        line([483, 539, '1 JULY 2025-4 MAY']),
        line([524, 539, '2026']),
        line([57, 120, 'Trading Income']),
        row(64, 'Sales', [539], '1,000.50'),
        row(64, 'Total Trading Income', [539], '1,000.50'),
      ],
    ])
    expect(read.issues).toEqual([])
    expect(read.statements[0].columns).toEqual([
      { header: '1 JULY 2025-4 MAY 2026', periodStart: '2025-07-01', periodEnd: '2026-05-04', kind: 'current_period', financialYear: 2026 },
    ])
    expect(read.statements[0].rows.map((r) => r.label)).toEqual(['Trading Income', 'Sales', 'Total Trading Income'])
  })

  it('leaves out cover, contents, cash flow and notes pages', () => {
    const read = readStatements([
      [line([57, 200, 'Financial Statements'])],
      [line([57, 143, 'Contents']), line([57, 61, '3'], [79, 149, 'Income Statement'])],
      [line([57, 221, 'Statement of Cash Flows']), line([537, 559, 'Total']), row(51, 'Net cash from operating activities', [559], '-10,216.89')],
      [line([57, 300, 'Notes to the Financial Statements']), line([57, 400, 'Income Tax'])],
    ])
    expect(read.statements).toEqual([])
    expect(read.status).toBe('no_statements')
  })

  it('says exactly which header or line it could not read, never guessing', () => {
    const noHeader = readStatements([[line([57, 200, 'Balance Sheet']), row(57, 'Cash', [539], '1,000')]])
    expect(noHeader.issues).toEqual([expect.objectContaining({ kind: 'no_column_header', page: 1 })])

    const pages = flatProfitAndLoss()
    pages[0][10] = line([25, 50, 'Rent'], [370, 400, '30,000'], [440, 470, 'see note'])
    const unparsed = readStatements(pages)
    expect(unparsed.issues).toEqual([
      expect.objectContaining({ kind: 'unparsed_amount', page: 1, text: 'Rent 30,000 see note', message: expect.stringContaining('"see note" sits in the 2024 column') }),
    ])
  })

  it('reads "--" as nil, joins a wrapped label, and skips a signature stamp across the columns', () => {
    const pages = flatProfitAndLoss()
    pages[0][16] = line([25, 50, 'Wages'], [395, 400, '--'], [465, 470, '--'])
    pages[0].splice(20, 0, line([25, 200, 'Add retained profits brought forward at the'], [370, 400, '1,000'], [440, 470, '2,000']), line([25, 120, 'Beginning of year']))
    pages[0].splice(19, 0, line([380, 600, 'Doc ID: 630aba8d238797e67e2973490876c06a']))
    const read = readStatements(pages)
    expect(read.issues).toEqual([])
    const rows = read.statements[0].rows
    expect(rows.find((r) => r.label === 'Wages')?.amounts).toEqual([null, null])
    expect(rows.map((r) => r.label)).toContain('Add retained profits brought forward at the Beginning of year')
    expect(rows.some((r) => r.text.includes('Doc ID'))).toBe(false)
  })

  it('does not read a PDF with no text layer', () => {
    const read = readStatements([[], []])
    expect(read.status).toBe('no_text_layer')
    expect(read.statements).toEqual([])
  })
})
