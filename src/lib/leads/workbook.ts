import { STAGE_META, SOURCE_META, ENTITY_TYPE_META } from './constants'
import { countLeadNotes, formatIsoDate, formatLeadNotes, formatPhone } from './format'
import type { Lead, LeadActivity } from '@/types/leads'

/**
 * The leads export as a real spreadsheet.
 *
 * CSV was the wrong format for this. It carries no column widths and no wrap
 * setting, so a long message or a run of notes either ran off the side of the
 * screen or — once a cell held a line break — made that row as tall as the
 * text in it. Neither is fixable in a CSV; both are ordinary properties of an
 * xlsx file.
 *
 * What the file sets, and why:
 *
 *  - A width per column, sized to what actually goes in it, so nothing has to
 *    be dragged before the sheet is readable.
 *  - Wrap on the two prose columns only. Wrapping a phone number or a stage
 *    achieves nothing and costs row height.
 *  - Top-aligned cells, so a row with one long note does not leave every
 *    other column floating in the middle of it.
 *  - A frozen, bold header, and debt as real numbers rather than text, so
 *    sorting and filtering work without anyone converting a column first.
 */

/** Cell shape, matching the library's SheetData. Kept local so the pure data
 *  builder can be unit-tested without importing the writer. */
export interface SheetCell {
  value?: string | number
  type?: StringConstructor | NumberConstructor
  fontWeight?: 'bold'
  wrap?: boolean
  alignVertical?: 'top'
  backgroundColor?: string
}

/** An empty cell is the absence of a cell, not a cell holding nothing. */
export type SheetRow = (SheetCell | null)[]

interface ColumnSpec {
  header: string
  /** Character-ish width, as xlsx counts it. */
  width: number
  wrap?: boolean
  value: (lead: Lead, activities: LeadActivity[]) => string | number | null
  numeric?: boolean
}

/**
 * Widths are deliberate rather than uniform: Notes gets the room because it
 * holds the most, State gets almost none because it holds three letters.
 * These are what stop anyone having to resize a column to read the file.
 */
const COLUMNS: ColumnSpec[] = [
  { header: 'Date added', width: 12, value: (lead) => formatIsoDate(lead.createdAt) },
  { header: 'Name', width: 22, value: (lead) => lead.name },
  { header: 'Email', width: 30, value: (lead) => lead.email },
  { header: 'Phone', width: 16, value: (lead) => formatPhone(lead.phone) },
  // Real numbers, not text: the point of two columns is that a spreadsheet
  // can sort and filter on them.
  { header: 'Debt min', width: 11, numeric: true, value: (lead) => lead.debtMin },
  { header: 'Debt max', width: 11, numeric: true, value: (lead) => lead.debtMax },
  {
    header: 'Entity type',
    width: 12,
    value: (lead) => (lead.entityType ? ENTITY_TYPE_META[lead.entityType].label : ''),
  },
  { header: 'State', width: 8, value: (lead) => lead.state ?? '' },
  { header: 'Stage', width: 16, value: (lead) => STAGE_META[lead.stage].label },
  { header: 'Source', width: 20, value: (lead) => SOURCE_META[lead.source].label },
  { header: 'Last action', width: 12, value: (lead) => formatIsoDate(lead.lastActionAt) },
  // The two prose columns, and the only two that wrap.
  { header: 'Message', width: 46, wrap: true, value: (lead) => lead.message ?? '' },
  {
    header: 'Notes count',
    width: 11,
    numeric: true,
    value: (_lead, activities) => countLeadNotes(activities),
  },
  {
    header: 'Notes',
    width: 90,
    wrap: true,
    value: (_lead, activities) => formatLeadNotes(activities),
  },
]

export const LEAD_SHEET_HEADERS = COLUMNS.map((column) => column.header)
export const LEAD_SHEET_WIDTHS = COLUMNS.map((column) => ({ width: column.width }))

/**
 * The sheet as rows of cells — pure, so the shape of the export can be
 * asserted without writing a file and unzipping it again.
 */
export function leadsSheetData(
  leads: Lead[],
  activitiesByLead: ReadonlyMap<string, LeadActivity[]> = new Map(),
): SheetRow[] {
  const header: SheetCell[] = COLUMNS.map((column) => ({
    value: column.header,
    fontWeight: 'bold',
    backgroundColor: '#F0F2F5',
  }))

  const rows = leads.map((lead) => {
    const activities = activitiesByLead.get(lead.id) ?? []
    return COLUMNS.map((column): SheetCell | null => {
      const value = column.value(lead, activities)
      if (column.numeric) {
        // An empty cell, not a zero — an unknown debt is not a debt of
        // nothing, and a 0 would sort as though it were.
        if (value === null || value === '') return null
        return { value: Number(value), type: Number }
      }
      return {
        value: String(value ?? ''),
        type: String,
        wrap: column.wrap,
        // Without this a row sized by a long note centres every other column
        // vertically inside it, which reads as though the data is floating.
        alignVertical: 'top',
      }
    })
  })

  return [header, ...rows]
}

/** The workbook as a buffer, ready to send. */
export async function buildLeadsWorkbook(
  leads: Lead[],
  activitiesByLead: ReadonlyMap<string, LeadActivity[]> = new Map(),
): Promise<Buffer> {
  // Imported here rather than at module scope: it is only needed when an
  // export is actually requested, and it has no business being pulled in by
  // anything that merely imports this module for its types.
  const { default: writeXlsxFile } = await import('write-excel-file/node')

  return writeXlsxFile(leadsSheetData(leads, activitiesByLead), {
    sheet: 'Leads',
    columns: LEAD_SHEET_WIDTHS,
    // The header stays put while someone scrolls a few hundred leads.
    stickyRowsCount: 1,
  }).toBuffer()
}
