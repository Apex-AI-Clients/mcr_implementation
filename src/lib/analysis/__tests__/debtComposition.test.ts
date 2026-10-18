import { describe, expect, it } from 'vitest'
import { computeLateLodgement } from '../computeLateLodgement'
import { parseActivityStatementCsv } from '../parseActivityStatement'
import { debtComposition } from '../debtComposition'

/** The debt composition, line by line, with its rows. Synthetic account only. */

const HEADER = '"Activity statement 001"\n"SAMPLE TRADING PTY LTD"\nProcessed date,Effective date,Description,Debit (DR),Credit (CR),Balance\n'
const row = (p: string, e: string, d: string, dr = '', cr = '', bal = '') => `"${p}","${e}","'${d}","${dr}","${cr}","${bal}"`

// Newest first, as the ATO prints it. The ATO's balance includes $40 the rows
// cannot account for.
const ROWS = [
  row('20 Mar 2024', '20 Mar 2024', 'Payment received', '', '$1,000.00', '$11,890.00 DR'),
  row('10 Mar 2024', '10 Mar 2024', 'Miscellaneous ATO adjustment', '$40.00', '', '$12,890.00 DR'),
  row('27 Feb 2024', '27 Feb 2024', 'Tax Office audit amended Activity Statement for the period ending 30 Sep 23', '$2,000.00', '', '$12,850.00 DR'),
  row('31 Jan 2024', '31 Jan 2024', 'General interest charge calculated from 01 Jan 24 to 31 Jan 24', '$150.00', '', '$10,850.00 DR'),
  row('20 Jan 2024', '20 Jan 2024', 'Penalty for failure to lodge Activity Statement on time for the period from 01 Jul 23 to 30 Sep 23', '$700.00', '', '$10,700.00 DR'),
  row('15 Jan 2024', '28 Oct 2023', 'Client initiated amended Activity Statement for the period ending 30 Sep 23', '', '$1,000.00', '$10,000.00 DR'),
  row('10 Dec 2023', '28 Oct 2023', 'Original Activity Statement for the period ending 30 Sep 23', '$11,000.00', '', '$11,000.00 DR'),
  row('10 Dec 2023', '28 Oct 2023', '- GST', '$11,000.00'),
]
const csv = (rows: string[]) => HEADER + rows.join('\n') + '\n'

describe('debtComposition', () => {
  const r = computeLateLodgement(parseActivityStatementCsv(csv(ROWS)))
  const { lines, uncounted } = debtComposition(r.rows, r.debtBreakdown)
  const line = (key: string) => lines.find((l) => l.key === key)!

  it('gives each line its rows and a plain-English sentence', () => {
    expect(line('principal').amount).toBe(10_000)
    expect(line('principal').rows.map((x) => x.description)).toEqual([
      'Client initiated amended Activity Statement for the period ending 30 Sep 23',
      'Original Activity Statement for the period ending 30 Sep 23',
    ])
    expect(line('principal').explanation).toBe(
      'Activity statements lodged: $11,000 charged, less $1,000 reduced by amendments or credit statements.',
    )
    expect(line('interest').rows).toHaveLength(1)
    expect(line('penalties').amount).toBe(700)
    expect(line('audit').amount).toBe(2000)
    expect(line('payments').rows[0]).toMatchObject({ processedDate: '2024-03-20', credit: 1000 })
  })

  it('explains the total ATO debt from its parts', () => {
    expect(line('totalDebt').amount).toBe(12_850)
    expect(line('totalDebt').explanation).toBe(
      'Everything the ATO charged: tax lodged ($10,000 after amendments) + interest ($150) + penalties ($700) + ATO audit amendments ($2,000).',
    )
  })

  it('explains the unexplained difference and lists every row no line counts', () => {
    expect(line('unexplained').amount).toBe(40)
    expect(line('unexplained').explanation).toContain(
      "The ATO's own balance ($11,890) minus what we can account for from the rows ($11,850)",
    )
    expect(uncounted).toEqual([
      expect.objectContaining({ kind: 'SubLine', count: 1, debits: 11_000, credits: 0 }),
      expect.objectContaining({ kind: 'Other', count: 1, debits: 40, credits: 0 }),
    ])
  })

  it('says when no payments were found', () => {
    const none = computeLateLodgement(parseActivityStatementCsv(csv(ROWS.slice(1))))
    expect(debtComposition(none.rows, none.debtBreakdown).lines.find((l) => l.key === 'payments')!.explanation).toBe(
      'No payments found in the ATO account.',
    )
  })
})
