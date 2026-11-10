import { describe, expect, it } from 'vitest'
import { verifyStatements } from '../verify'
import type { PrintedRow, PrintedStatement } from '../types'

/** A trust's distribution section is taken off the profit available for distribution. Synthetic. */

const r = (path: string[], label: string, style: PrintedRow['style'], ...amounts: (number | null)[]): PrintedRow => ({ page: 1, path, label, style, amounts, text: label })

describe('trust distributions', () => {
  it('takes "Distribution of Trust Income" off the profit available; a nil undistributed income adds up', () => {
    const st: PrintedStatement = {
      kind: 'profit_and_loss',
      title: 'Profit & Loss Statement',
      pages: [1],
      columns: [
        { header: '2023', periodStart: '2022-07-01', periodEnd: '2023-06-30', kind: 'annual', financialYear: 2023 },
        { header: '2022', periodStart: '2021-07-01', periodEnd: '2022-06-30', kind: 'annual', financialYear: 2022 },
      ],
      wholeDollars: true,
      rows: [
        r([], 'Profit Available for Distribution', 'total', -15402, 292211),
        r([], 'Distribution of Trust Income', 'heading', null, null),
        r(['Distribution of Trust Income'], 'Trust Income Distributed', 'line', null, 292211),
        r(['Distribution of Trust Income'], 'Total Distribution of Trust Income', 'subtotal', null, 292211),
        r([], 'Undistributed Income', 'total', -15402, null),
      ],
    }
    expect(verifyStatements([st]).filter((c) => c.status === 'mismatch' || c.status === 'wrong_column')).toEqual([])
  })
})
