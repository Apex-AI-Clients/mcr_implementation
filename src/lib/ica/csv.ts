import type { IcaFile } from './types'

/**
 * An ATO account file (an RBA ICA spreadsheet, say) as the ATO's own CSV:
 * line 1 the account, line 2 the entity, line 3 the header, then the rows
 * with every cell as printed. The analyses that read the ATO's CSV
 * (computeLateLodgement, the ATO account store) then read a spreadsheet the
 * same way, with nothing re-interpreted.
 */
const cell = (v: string) => `"${v.replace(/"/g, '""')}"`

export function icaFileToCsv(file: IcaFile): string {
  const lines = [
    cell(file.label),
    cell(file.entityName),
    'Processed date,Effective date,Description,Debit (DR),Credit (CR),Balance',
    ...file.rows.map((r) => [r.rawProcessed, r.rawEffective, `'${r.description}`, r.rawDebit, r.rawCredit, r.rawBalance].map(cell).join(',')),
  ]
  return lines.join('\r\n')
}

/** Is this upload an Excel workbook (an .xlsx is a zip: it starts "PK")? */
export const isXlsxBytes = (data: Uint8Array) => data.length >= 2 && data[0] === 0x50 && data[1] === 0x4b
