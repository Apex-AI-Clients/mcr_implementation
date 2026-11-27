import { describe, it, expect } from 'vitest'
import { buildPrintedComparison, type ComparisonDocument } from '../compare'
import { autoMapping } from '../autoMapping'
import { decideKeyFigures, gapFigures, loanSide } from '../keyFigureDecision'
import { comparisonDocumentIds, reopenReason, type StoredDecision } from '../mappingStore'
import { LabelMasker } from '@/lib/ai/maskLabels'
import { agreedAnswers, keyFigurePrompt, maskedLines, parseKeyFigureAnswer, type AiKeyFigureAnswer, type KeyFigureChoice } from '@/lib/ai/keyFigureChoice'
import type { PrintedColumn, PrintedRow, PrintedStatement } from '../types'
import type { Meaning } from '../meanings'

/** The key-figure decision: Claude's choice with the rules on top (item 9b/9c). Synthetic statements only. */

const fy = (y: number): PrintedColumn => ({ header: String(y), periodStart: `${y - 1}-07-01`, periodEnd: `${y}-06-30`, kind: 'annual', financialYear: y })
const r = (path: string[], label: string, style: PrintedRow['style'], amount: number | null): PrintedRow => ({ page: 1, path, label, style, amounts: [amount], text: label })
const st = (kind: PrintedStatement['kind'], rows: PrintedRow[]): PrintedStatement => ({ kind, title: kind, pages: [1], columns: [fy(2025)], rows, wholeDollars: false })

const CA = ['Assets', 'Current Assets']
const EQ = ['Equity']
const NAMES = { directors: ['Jane Example'], parties: ['Example Earthworks Pty Ltd'] }

function comparison() {
  const doc: ComparisonDocument = {
    documentId: 'doc-fy25',
    filename: 'fy25.pdf',
    uploadedAt: '',
    read: {
      status: 'read',
      pageCount: 2,
      issues: [],
      statements: [
        st('profit_and_loss', [r([], 'Sales', 'line', 1000), r([], 'Net Profit', 'total', 100)]),
        st('balance_sheet', [
          r([], 'Assets', 'heading', null),
          r(CA, 'Business Account', 'line', 900),
          r(CA, 'Loan - Jane Example', 'line', 5000),
          r(CA, 'Total Current Assets', 'subtotal', 5900),
          r(['Assets'], 'Total Assets', 'subtotal', 5900),
          r([], 'Equity', 'heading', null),
          r(EQ, 'Owner A Drawings', 'line', 44952.22),
          r(EQ, 'Matthew Nobody - Drawings', 'line', 1200),
          r(EQ, 'Retained Earnings', 'line', 100),
          r([], 'Net Assets', 'total', 5900),
        ]),
      ],
    },
  }
  return buildPrintedComparison([doc])
}

const key = (c: ReturnType<typeof comparison>, label: string) => c.tables.flatMap((t) => t.rows).find((x) => x.label === label)!.key
const OPEN: Meaning[] = ['loan_receivable', 'loan_payable', 'net_profit', 'total_current_assets', 'total_assets']
const choiceOf = (c: ReturnType<typeof comparison>, answer: AiKeyFigureAnswer): KeyFigureChoice => ({
  answer,
  unknownPersonLines: new Set([key(c, 'Matthew Nobody - Drawings')]),
  model: 'anthropic/test',
})
const decide = (answer: AiKeyFigureAnswer | null) => {
  const c = comparison()
  const rules = autoMapping(c, [], NAMES, { meanings: OPEN })
  return { c, rules, out: decideKeyFigures(c, OPEN, rules, NAMES, answer ? choiceOf(c, answer) : null) }
}
const of = (out: ReturnType<typeof decideKeyFigures>, m: Meaning) => out.find((d) => d.meaning === m)

describe('decideKeyFigures: the AI only fills gaps', () => {
  it('AI off: the rules alone, exactly as autoMapping decides', () => {
    const { rules, out } = decide(null)
    for (const d of out) {
      expect(d.chosenBy).toBe('rule')
      const ruleKeys = rules.entries.filter((e) => e.meaning === d.meaning).map((e) => `${e.rowKey}|${e.nonePrinted}`)
      expect(d.entries.map((e) => `${e.rowKey}|${e.nonePrinted}`)).toEqual(ruleKeys)
    }
  })

  it('a figure the rules chose a line for is never asked and never changed, whatever the AI says', () => {
    const c = comparison()
    const rules = autoMapping(c, [], NAMES, { meanings: OPEN })
    expect(gapFigures(OPEN, rules)).not.toContain('net_profit')
    expect(gapFigures(OPEN, rules)).not.toContain('related_loans')
    const { out } = decide({
      net_profit: { kind: 'lines', rowKeys: [key(c, 'Sales')], reason: 'Wrong line.' },
      related_loans: { kind: 'not_printed', rowKeys: [], reason: 'x' },
    })
    expect(of(out, 'net_profit')!.entries.map((e) => e.label)).toEqual(['Net Profit'])
    expect(of(out, 'net_profit')!.possible).toEqual([])
    expect(of(out, 'loan_receivable')!.entries.map((e) => e.label)).toEqual(['Loan - Jane Example'])
  })

  it('a gap: the AI line is offered as a possible line, never chosen; the rules’ answer stands', () => {
    const c = gapComparison()
    const rules = autoMapping(c, [], NAMES, { meanings: ['total_non_current_assets'] })
    expect(gapFigures(['total_non_current_assets'], rules)).toEqual(['total_non_current_assets'])
    const before = ruleDecisionOf(rules, 'total_non_current_assets')
    const out = decideKeyFigures(c, ['total_non_current_assets'], rules, NAMES, {
      answer: { total_non_current_assets: { kind: 'lines', rowKeys: [keyIn(c, 'Total long-term assets')], reason: 'The long-term assets total.' } },
      unknownPersonLines: new Set(),
      model: 'anthropic/test',
    })
    const d = out[0]
    expect(d.outcome).toBe(before)
    expect(d.entries.every((e) => e.nonePrinted)).toBe(true)
    expect(d.possible.map((p) => p.label)).toContain('Total long-term assets')
    expect(d.possible.find((p) => p.label === 'Total long-term assets')!.why).toMatch(/^Suggested by AI \(asked twice/)
  })

  it('a gap the AI is unsure about, or says is not printed: the rules alone', () => {
    const c = gapComparison()
    const rules = autoMapping(c, [], NAMES, { meanings: ['total_non_current_assets'] })
    for (const kind of ['unclear', 'not_printed'] as const) {
      const out = decideKeyFigures(c, ['total_non_current_assets'], rules, NAMES, {
        answer: { total_non_current_assets: { kind, rowKeys: [keyIn(c, 'Total long-term assets')], reason: 'x' } },
        unknownPersonLines: new Set(),
        model: 'anthropic/test',
      })
      expect(out[0].possible.some((p) => p.why.startsWith('Suggested by AI'))).toBe(false)
    }
  })

  it('ask twice: only an answer both asks agree on counts', () => {
    const a = { total_assets: { kind: 'lines' as const, rowKeys: ['k1'], reason: 'r1' }, net_profit: { kind: 'lines' as const, rowKeys: ['k2'], reason: 'r' } }
    const b = { total_assets: { kind: 'lines' as const, rowKeys: ['k1'], reason: 'r2' }, net_profit: { kind: 'lines' as const, rowKeys: ['k3'], reason: 'r' } }
    expect(agreedAnswers(a, b)).toEqual({ total_assets: { kind: 'lines', rowKeys: ['k1'], reason: 'r1' } })
    expect(agreedAnswers(a, {})).toEqual({})
  })

  it('loans: the sign rule says which side a line is read on', () => {
    const c = comparison()
    expect(loanSide(c.tables[1].rows.find((x) => x.label === 'Loan - Jane Example')!, c)).toBe('loan_receivable')
    expect(loanSide(c.tables[1].rows.find((x) => x.label === 'Owner A Drawings')!, c)).toBe('loan_payable')
  })
})

/** A balance sheet whose non-current total the rules do not recognise ("Total long-term assets"). */
function gapComparison() {
  const doc: ComparisonDocument = {
    documentId: 'doc-gap',
    filename: 'gap.pdf',
    uploadedAt: '',
    read: {
      status: 'read',
      pageCount: 1,
      issues: [],
      statements: [
        st('balance_sheet', [
          r([], 'Assets', 'heading', null),
          r(CA, 'Business Account', 'line', 900),
          r(CA, 'Total Current Assets', 'subtotal', 900),
          r(['Assets', 'Long-term assets'], 'Equipment', 'line', 500),
          r(['Assets', 'Long-term assets'], 'Total long-term assets', 'subtotal', 500),
          r(['Assets'], 'Total Assets', 'subtotal', 1400),
        ]),
      ],
    },
  }
  return buildPrintedComparison([doc])
}
const keyIn = (c: ReturnType<typeof gapComparison>, label: string) => c.tables.flatMap((t) => t.rows).find((x) => x.label === label)!.key
const ruleDecisionOf = (rules: ReturnType<typeof autoMapping>, m: Meaning) =>
  rules.entries.some((e) => e.meaning === m && !e.nonePrinted) ? 'lines' : rules.entries.some((e) => e.meaning === m) ? 'not_printed' : 'possible'

describe('the prompt and the answer', () => {
  it('sends labels and headings only, names masked; restores names in the reason', () => {
    const c = comparison()
    const masker = new LabelMasker({ client: ['Example Earthworks Pty Ltd'], directors: ['Jane Example'], relatedCompanies: [], beneficiaries: [] })
    const lines = maskedLines(c, masker)
    const prompt = keyFigurePrompt(['related_loans', 'net_profit'], lines)
    expect(prompt).not.toContain('Jane Example')
    expect(prompt).not.toContain('Matthew Nobody')
    expect(prompt).not.toMatch(/44,?952/)
    expect(prompt).not.toContain('fy25.pdf')
    expect(prompt).toContain('Loan - [director 1]')
    const loan = lines.find((l) => l.text.endsWith('Loan - [director 1]'))!
    const np = lines.find((l) => l.text.includes('Net Profit'))!
    const parsed = parseKeyFigureAnswer(
      JSON.stringify({ related_loans: { lines: [loan.id], reason: '[director 1] owes the company.' }, net_profit: { lines: [np.id, loan.id], reason: 'x' } }),
      ['related_loans', 'net_profit'],
      lines,
      masker,
    )
    expect(parsed.related_loans).toEqual({ kind: 'lines', rowKeys: [loan.row.key], reason: 'Jane Example owes the company.' })
    // A balance sheet line for a profit and loss figure: not offered there, so unclear.
    expect(parsed.net_profit?.kind).toBe('unclear')
  })
})

describe('stored decisions (9c)', () => {
  const stored = (over: Partial<StoredDecision> = {}): StoredDecision => ({
    meaning: 'net_profit',
    outcome: 'lines',
    chosenBy: 'ai',
    decidedBy: 'auto',
    decidedAt: '2026-11-26T00:00:00Z',
    rule: 'Chosen by AI: x',
    aiReason: 'x',
    rowKeys: ['k1'],
    possible: [],
    documentIds: ['doc-fy25'],
    ...over,
  })
  it('stand until the documents change, a chosen line is gone, or staff clear their choice', () => {
    const rows = new Set(['k1'])
    expect(reopenReason(stored(), ['doc-fy25'], rows)).toBeNull()
    expect(reopenReason(undefined, ['doc-fy25'], rows)).toBe('not decided yet')
    expect(reopenReason(stored(), ['doc-fy25', 'doc-fy26'], rows)).toBe('the documents changed')
    expect(reopenReason(stored(), ['doc-fy25'], new Set())).toBe('a chosen line is no longer printed')
    expect(reopenReason(stored({ chosenBy: 'staff' }), ['doc-fy25'], rows)).toBe('staff cleared their choice')
  })
  it('the documents are the ones the figures come from', () => {
    expect(comparisonDocumentIds(comparison())).toEqual(['doc-fy25'])
  })
})
