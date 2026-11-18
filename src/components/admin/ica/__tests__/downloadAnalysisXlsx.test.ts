import { describe, expect, it, vi } from 'vitest'
import * as XLSX from 'xlsx'

/** The lodgement pages' Excel download: the analysis and the rows as printed. Synthetic. */

const written: { book: XLSX.WorkBook; name: string }[] = []
vi.mock('xlsx', async (original) => ({
  ...(await original<typeof import('xlsx')>()),
  writeFile: (book: XLSX.WorkBook, name: string) => written.push({ book, name }),
}))
vi.resetModules()
const { downloadAnalysisXlsx } = await import('../IcaParts')

describe('downloadAnalysisXlsx', () => {
  it('writes the analysis and the rows exactly as printed, one sheet each', async () => {
    const csv = 'Activity statement 001,Example Trading\nMatches the ATO\'s own balance: $1,000.00 DR at 14 Sep 2026\n"GST lodged",1200.00,3 rows,- GST\n'
    const rows = [{ id: 0, processed: '14 Sep 2026', effective: '28 Oct 2026', description: '- GST', debit: '$1,200.00', credit: '', balance: '$1,000.00 DR' }]
    await downloadAnalysisXlsx(csv, rows, 'Example — Lodgement analysis')
    const { book, name } = written[0]
    expect(name).toBe('Example — Lodgement analysis.xlsx')
    expect(book.SheetNames).toEqual(['Analysis', 'Rows as printed'])
    const analysis = XLSX.utils.sheet_to_json<string[]>(book.Sheets.Analysis, { header: 1, raw: false })
    expect(analysis[2]).toEqual(['GST lodged', '1200.00', '3 rows', '- GST'])
    const printed = XLSX.utils.sheet_to_json<string[]>(book.Sheets['Rows as printed'], { header: 1 })
    expect(printed[1]).toEqual(['14 Sep 2026', '28 Oct 2026', '- GST', '$1,200.00', '', '$1,000.00 DR'])
  })
})
