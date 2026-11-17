import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { analyseIca, readIcaCsv, readIcaFile, readIcaXlsx } from '@/lib/ica'
import { lateLodgements } from '@/lib/ica/lateLodgement'
import { wordingKey } from '@/lib/ica/learned'
import { maskDescription, parseProposal, proposeForUnmatched, windowPrompt } from '@/lib/ica/propose'
import { reconcile } from '@/lib/ica/reconcile'
import { lineOf } from '@/lib/ica/wording'

/**
 * Synthetic copies of each structure seen in real ATO exports (never real
 * rows). Rows are listed newest first, as the ATO prints them.
 */

type Cells = [string, string, string, string, string, string]

const csv = (rows: Cells[], label = 'Activity statement 002') =>
  [`"${label}"`, '"TEST ENTITY - ABN: 12 345 678 901"', 'Processed date,Effective date,Description,Debit (DR),Credit (CR),Balance', ...rows.map((r) => r.map((c) => `"${c}"`).join(','))].join('\r\n')

const analyse = (rows: Cells[], label?: string) => analyseIca(readIcaCsv(csv(rows, label)))
const line = (a: ReturnType<typeof analyse>, key: string) => a.composition?.lines.find((l) => l.key === key)

// Statement row with no amount; the amounts are on its sub-lines (Yan-Trow, 16 Nov 2026).
const SUBLINES_CARRY: Cells[] = [
  ['14 Jul 2026', '26 May 2026', "'Original Activity Statement for the period ending 31 Mar 26", '', '', '$1,500.00 DR'],
  ['14 Jul 2026', '26 May 2026', "'- PAYG Withholding", '$400.00', '', '$1,500.00 DR'],
  ['14 Jul 2026', '26 May 2026', "'- GST", '$600.00', '', '$1,100.00 DR'],
  ['01 Jul 2026', '01 Jul 2026', "'General interest charge calculated from 01 Jun 26 to 30 Jun 26", '$100.00', '', '$500.00 DR'],
  ['01 Jun 2026', '01 Jun 2026', "'Payment received", '', '$100.00', '$400.00 DR'],
  ['15 May 2026', '15 May 2026', "'General interest charge calculated from 01 Apr 26 to 14 May 26", '$500.00', '', '$500.00 DR'],
]

describe('statement + sub-lines', () => {
  it('counts the sub-lines when the statement row has no amount, never both', () => {
    const a = analyse(SUBLINES_CARRY)
    expect(a.verified).toBe(true)
    expect(line(a, 'gst')?.net).toBe(60000)
    expect(line(a, 'paygw')?.net).toBe(40000)
    expect(a.composition?.total).toBe(150000)
    expect(a.composition?.notCounted.map((n) => n.rowId)).toEqual([0])
  })

  it("counts the statement row when it carries the amount, split into tax lines by its sub-lines (a sub-line's effective date can differ)", () => {
    const a = analyse([
      ['28 Jul 2017', '21 Jun 2017', "'Client initiated amended Activity Statement for the period ending 31 May 17", '$823.00', '', '$873.00 DR'],
      ['28 Jul 2017', '28 Jul 2017', "'- Fuel Tax Credit", '', '$121.00', ''],
      ['28 Jul 2017', '21 Jun 2017', "'- GST", '$944.00', '', ''],
      ['01 Jul 2017', '30 Jun 2017', "'Payment received", '', '$50.00', '$50.00 DR'],
    ])
    expect(a.verified).toBe(true)
    expect(line(a, 'gst')?.net).toBe(94400)
    const fuel = a.composition?.lines.find((l) => l.label === 'Fuel Tax Credit')
    expect(fuel).toMatchObject({ net: -12100, named: false, section: 'tax' })
    expect(a.composition?.total).toBe(87300)
  })
})

describe('totals with their breakdown', () => {
  it('counts a payment once, and interest detail rows instead of their summary', () => {
    const a = analyse([
      ['02 Sep 2026', '01 Sep 2026', "'Payment received", '', '$1,000.00', '$500.00 DR'],
      ['02 Sep 2026', '01 Sep 2026', "'Payment received", '', '$600.00', ''],
      ['02 Sep 2026', '01 Sep 2026', "'Payment received", '', '$400.00', ''],
      ['01 Aug 2026', '01 Aug 2026', "'General interest charge", '$100.00', '', '$1,500.00 DR'],
      ['01 Aug 2026', '01 Aug 2026', "'Amended general interest charge calculated from 01 Jun 26 to 30 Jun 26", '$150.00', '', ''],
      ['01 Aug 2026', '01 Aug 2026', "'Remission of general interest charge", '', '$50.00', ''],
      ['01 Jul 2026', '01 Jul 2026', "'Original Activity Statement for the period ending 31 Mar 26", '$1,400.00', '', '$1,400.00 DR'],
    ])
    expect(a.verified).toBe(true)
    expect(line(a, 'payments')).toMatchObject({ net: -100000, parts: [{ rowId: 0 }] })
    expect(line(a, 'gic')?.net).toBe(15000)
    expect(line(a, 'gicRemitted')?.net).toBe(-5000)
  })

  it('uses the only other reading that matches the balance when the rule does not (summary, not its rows)', () => {
    const a = analyse([
      ['01 Aug 2026', '01 Aug 2026', "'General interest charge", '$100.00', '', '$1,100.00 DR'],
      ['01 Aug 2026', '01 Aug 2026', "'Amended general interest charge calculated from 01 Jun 26 to 30 Jun 26", '$150.00', '', ''],
      ['01 Aug 2026', '01 Aug 2026', "'Remission of general interest charge", '', '$30.00', ''],
      ['01 Jul 2026', '01 Jul 2026', "'Original Activity Statement for the period ending 31 Mar 26", '$1,000.00', '', '$1,000.00 DR'],
    ])
    expect(a.verified).toBe(true)
    expect(a.reconciliation.matched[0]).toMatchObject({ method: 'reading', readingsChanged: [{ reading: 'total' }] })
    expect(line(a, 'gic')?.net).toBe(10000)
  })
})

describe('the ATO balance as the answer key', () => {
  it('takes any printed balance of a day as its closing (a payment printed with the balance before the day’s interest)', () => {
    const a = analyse([
      ['02 Dec 2024', '02 Dec 2024', "'General interest charge calculated from 01 Nov 24 to 01 Dec 24", '$163.31', '', '$17,027.71 DR'],
      ['01 Nov 2024', '31 Oct 2024', "'Payment received", '', '$1,001.00', '$16,693.37 DR'],
      ['01 Nov 2024', '01 Nov 2024', "'General interest charge calculated from 01 Oct 24 to 31 Oct 24", '$171.03', '', '$16,864.40 DR'],
      ['01 Oct 2024', '01 Oct 2024', "'General interest charge calculated from 01 Sep 24 to 30 Sep 24", '$100.00', '', '$17,694.37 DR'],
    ])
    expect(a.verified).toBe(true)
    expect(a.reconciliation.matched.every((m) => m.method === 'day')).toBe(true)
  })

  it('reads a file printed oldest first the same way', () => {
    const a = analyse([...SUBLINES_CARRY].reverse())
    // Sub-lines stay directly below their statement row, as the ATO prints them.
    const oldestFirst = analyse([SUBLINES_CARRY[5], SUBLINES_CARRY[4], SUBLINES_CARRY[3], SUBLINES_CARRY[0], SUBLINES_CARRY[1], SUBLINES_CARRY[2]])
    expect(oldestFirst.file.printOrder).toBe('oldest_first')
    expect(oldestFirst.verified).toBe(true)
    expect(line(oldestFirst, 'gst')?.net).toBe(60000)
    expect(a.file.printOrder).toBe('oldest_first')
  })

  const widened = (paymentDay: string): Cells[] => [
    [paymentDay, paymentDay, "'Payment received", '', '$50.00', '$150.00 DR'],
    ['03 Mar 2026', '28 Feb 2026', "'Original Activity Statement for the period ending 31 Dec 25", '$200.00', '', '$150.00 DR'],
    ['01 Feb 2026', '01 Feb 2026', "'Payment received", '', '$10.00', '$0.00'],
  ]

  it('widens a window over neighbouring balance days, up to 7 days', () => {
    const a = analyse(widened('05 Mar 2026'))
    expect(a.verified).toBe(true)
    expect(a.reconciliation.matched).toMatchObject([{ method: 'widened', days: ['2026-03-03', '2026-03-05'] }])
  })

  it('beyond 7 days: no figures, the window reported with its rows', () => {
    const a = analyse(widened('20 Mar 2026'))
    expect(a.verified).toBe(false)
    expect(a.composition).toBeNull()
    expect(a.lodgedOver90DaysLate).toBeNull()
    expect(a.reconciliation.unmatched.length).toBeGreaterThan(0)
    expect(a.reconciliation.unmatched[0].rowIds).toContain(1)
    expect(a.holdReasons.join(' ')).toMatch(/do not match the ATO's balance change/)
    // Late lodgements depend on dates only.
    expect(a.lateLodgements.count).toBe(1)
  })
})

describe('wording', () => {
  it('names a line only for known ATO wording; anything else is its own line in the ATO’s words', () => {
    expect(lineOf('- GST')).toMatchObject({ key: 'gst', named: true })
    expect(lineOf('PAYG Withholding (STP Reported) for period ending 30 Jun 26')).toMatchObject({ key: 'paygw' })
    expect(lineOf('Remission of penalty for failure to lodge Activity Statement on time for the period from 01 Jan 26 to 31 Mar 26')).toMatchObject({ key: 'penaltiesRemitted' })
    expect(lineOf('Non-pursuit - uneconomical to pursue')).toMatchObject({ named: false, section: 'other', label: 'Non-pursuit - uneconomical to pursue' })
    expect(lineOf('Existing debt on hold included in account balance - Conversion for the period from 01 Jul 20 to 30 Jun 21')).toMatchObject({
      named: false,
      label: 'Existing debt on hold included in account balance - Conversion',
    })
  })

  it('a statement the ATO raised (audit) is never put under "lodged": its own line in the ATO’s words', () => {
    const a = analyse([
      ['07 Jul 2026', '25 Aug 2022', "'Tax Office audit amended Activity Statement for the period ending 30 Jun 22", '$4,959.00', '', '$5,959.00 DR'],
      ['07 Jul 2026', '25 Aug 2022', "'- GST", '$4,959.00', '', ''],
      ['01 Jul 2026', '01 Jul 2026', "'Original Activity Statement for the period ending 31 Mar 26", '$1,000.00', '', '$1,000.00 DR'],
      ['01 Jul 2026', '01 Jul 2026', "'- GST", '$1,000.00', '', ''],
    ])
    expect(a.verified).toBe(true)
    expect(line(a, 'gst')?.net).toBe(100000)
    expect(a.composition?.lines.find((l) => l.label === 'Tax Office audit amended Activity Statement: GST')?.net).toBe(495900)
  })

  it('an unknown row counts as printed and shows as its own line', () => {
    const a = analyse([
      ['10 Jan 2026', '10 Jan 2026', "'Non-pursuit - uneconomical to pursue", '', '$75.00', '$25.00 DR'],
      ['01 Jan 2026', '01 Jan 2026', "'Original Activity Statement for the period ending 30 Sep 25", '$100.00', '', '$100.00 DR'],
    ])
    expect(a.verified).toBe(true)
    expect(a.composition?.lines.find((l) => l.section === 'other')).toMatchObject({ label: 'Non-pursuit - uneconomical to pursue', net: -7500 })
  })
})

describe('late lodgements (the RBA ICA rule, unchanged)', () => {
  it('counts every row containing "Activity Statement", days = processed − effective, negative = 0', () => {
    const file = readIcaCsv(
      csv([
        ['20 Jan 2026', '10 Jan 2026', "'Penalty for failure to lodge Activity Statement on time for the period from 01 Jul 25 to 30 Sep 25", '$330.00', '', '$330.00 DR'],
        ['05 Jan 2026', '10 Jan 2026', "'Original Activity Statement for the period ending 30 Sep 25", '', '$0.00', '$0.00'],
        ['01 Jan 2026', '01 Oct 2025', "'Original Activity Statement for the period ending 30 Jun 25", '', '$0.00', '$0.00'],
      ]),
    )
    expect(lateLodgements(file)).toMatchObject({ count: 2, cumulativeDays: 10 + 92 })
  })

  it('gives nothing when a date cannot be read', () => {
    const file = readIcaCsv(csv([['31 Feb 2026', '10 Jan 2026', "'Original Activity Statement for the period ending 30 Sep 25", '', '', '$0.00']]))
    expect(lateLodgements(file).count).toBeNull()
  })

  it('statements lodged more than 90 days late take their amounts from the reading the balance proved', () => {
    const a = analyse([
      ['14 Sep 2026', '26 May 2026', "'Original Activity Statement for the period ending 31 Mar 26", '', '', '$1,000.00 DR'],
      ['14 Sep 2026', '26 May 2026', "'- PAYG Withholding", '$400.00', '', '$1,000.00 DR'],
      ['14 Sep 2026', '26 May 2026', "'- GST", '$600.00', '', '$600.00 DR'],
      ['01 Jun 2026', '01 Jun 2026', "'Payment received", '', '$0.00', '$0.00'],
    ])
    expect(a.lodgedOver90DaysLate).toHaveLength(1)
    expect(a.lodgedOver90DaysLate?.[0]).toMatchObject({ days: 111, debit: 100000 })
  })
})

describe('RBA ICA spreadsheet (.xlsx)', () => {
  const workbook = (h3: number, h4: number) => {
    const aoa: unknown[][] = [
      ['Activity statement 002'],
      [],
      ['TEST ENTITY', '', '', '', '', '', 'Number  Late Lodgements', h3],
      ['', '', '', '', '', '', 'Cumulative Days Late', h4],
      [],
      [],
      ['Processed date', 'Effective date', 'Description', 'Debit (DR)', 'Credit (CR)', 'Balance', 'Late Lodgements (Days)'],
      [],
      [46217, 46168, "'Original Activity Statement for the period ending 31 Mar 26", 1000, '', '$1,000.00 DR', 49],
      [46174, 46174, "'Payment received", '', 0, '$0.00', 0],
    ]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'RBA ICA')
    return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }))
  }

  it('reads columns A–F from row 9, the account on row 1, the entity on row 3, and H3/H4', () => {
    const file = readIcaFile(workbook(1, 49))
    expect(file).toMatchObject({ source: 'xlsx', label: 'Activity statement 002', entityName: 'TEST ENTITY', spreadsheet: { lateLodgements: 1, cumulativeDaysLate: 49 } })
    expect(file.rows[0]).toMatchObject({ rawProcessed: '14 Jul 2026', processed: '2026-07-14', debit: 100000, balance: 100000 })
    const a = analyseIca(file)
    expect(a.verified).toBe(true)
    expect(a.spreadsheetCheck?.matches).toBe(true)
  })

  it('a spreadsheet whose H3/H4 differ from ours makes the result unverified (never both shown)', () => {
    const a = analyseIca(readIcaXlsx(workbook(2, 49)))
    expect(a.spreadsheetCheck?.matches).toBe(false)
    expect(a.verified).toBe(false)
    expect(a.composition).toBeNull()
  })
})

describe('learned patterns and Claude proposals', () => {
  // A structure no rule knows: a summary with a balance and a detail row repeating it.
  const UNKNOWN_STRUCTURE: Cells[] = [
    ['10 Jan 2026', '10 Jan 2026', "'Transfer summary to account 98 765 432 109", '', '$300.00', '$700.00 DR'],
    ['10 Jan 2026', '10 Jan 2026', "'Transfer detail item", '', '$300.00', ''],
    ['01 Jan 2026', '01 Jan 2026', "'Original Activity Statement for the period ending 30 Sep 25", '$1,000.00', '', '$1,000.00 DR'],
  ]
  const file = () => readIcaCsv(csv(UNKNOWN_STRUCTURE))

  it('is unverified with the known rules', () => {
    expect(analyseIca(file()).verified).toBe(false)
  })

  it('a learned pattern is applied in a window that does not match, and kept only because the balance then matches', () => {
    const a = analyseIca(file(), { patterns: [{ wording: wordingKey('Transfer detail item'), printed: 'without_balance', count: false, explanation: '' }] })
    expect(a.verified).toBe(true)
    expect(a.reconciliation.matched[0].method).toBe('learned')
  })

  it('a pattern that does not make the balance match is not used', () => {
    const a = analyseIca(file(), { patterns: [{ wording: wordingKey('Transfer detail item'), printed: 'without_balance', count: true, explanation: '' }] })
    expect(a.verified).toBe(false)
  })

  it('sends Claude only the window’s rows, anonymised', () => {
    const f = file()
    const rec = reconcile(f)
    const { prompt } = windowPrompt(f, rec.unmatched[0])
    expect(prompt).not.toMatch(/TEST ENTITY|12 345 678 901|98 765 432 109|Activity statement 002/)
    expect(prompt).toContain('Transfer summary to account #')
    expect(maskDescription('ABN: 91 656 014 002 ref 123-456-789 period 01 Jul 21 to 30 Sep 21')).toBe('ABN: # ref # period 01 Jul 21 to 30 Sep 21')
  })

  it('accepts a proposal only when the balance matches to the cent, and learns its pattern', async () => {
    const ask = async () => ({ text: '{"count":[1],"skip":[2],"explanation":"The detail row repeats the summary."}', model: 'anthropic/test', generationId: 'g1' })
    const run = await proposeForUnmatched(file(), ask)
    expect(run.outcomes[0].status).toBe('accepted')
    expect(run.reconciliation.unmatched).toHaveLength(0)
    expect(run.reconciliation.matched[0].method).toBe('claude')
    expect(run.learned).toEqual([{ wording: 'transfer detail item', printed: 'without_balance', count: false, explanation: 'The detail row repeats the summary.' }])
    expect(analyseIca(file(), { forced: run.forced }).verified).toBe(true)
  })

  it('rejects a proposal that does not reconcile, an incomplete answer, and a failed call', async () => {
    const wrong = await proposeForUnmatched(file(), async () => ({ text: '{"count":[1,2],"skip":[],"explanation":"x"}', model: 'm', generationId: 'g' }))
    expect(wrong.outcomes[0].status).toBe('rejected')
    expect(wrong.learned).toEqual([])
    const incomplete = await proposeForUnmatched(file(), async () => ({ text: '{"count":[1],"skip":[]}', model: 'm', generationId: 'g' }))
    expect(incomplete.outcomes[0].status).toBe('rejected')
    const failed = await proposeForUnmatched(file(), async () => {
      throw new Error('offline')
    })
    expect(failed.outcomes[0].status).toBe('failed')
    expect(failed.reconciliation.unmatched).toHaveLength(1)
  })

  it('reads a proposal strictly', () => {
    expect(parseProposal('{"count":[1,3],"skip":[2],"explanation":"e"}', 3)).toEqual({ count: [1, 3], skip: [2], explanation: 'e' })
    expect(parseProposal('{"count":[1,4],"skip":[2]}', 3)).toBeNull()
    expect(parseProposal('{"count":[1,2],"skip":[2,3]}', 3)).toBeNull()
    expect(parseProposal('not json', 3)).toBeNull()
  })
})
