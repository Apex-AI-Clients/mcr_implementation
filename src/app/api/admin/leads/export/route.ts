import { NextRequest, NextResponse } from 'next/server'
import { requireStaffUser } from '@/lib/auth/staff'
import { getActivitiesForLeads, getLeadsForExport } from '@/lib/leads/queries'
import { parseLeadQuery, type RawSearchParams } from '@/lib/leads/searchParams'
import { leadsToCsv } from '@/lib/leads/format'
import { buildLeadsWorkbook } from '@/lib/leads/workbook'

export const dynamic = 'force-dynamic'

/** UTF-8 byte-order mark. Written as an escape, not as the character
 *  itself — an invisible byte sitting in a source file is something a
 *  formatter or a careless paste will eventually eat. */
const UTF8_BOM = '\ufeff'

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

/**
 * Every lead matching the current filters, as a spreadsheet.
 *
 * Server-side because the browser only holds the page on screen now. Exporting
 * what the table happens to be showing would hand somebody a ten-row file
 * labelled as the whole list, which is worse than no export at all.
 *
 * It takes the same query string the list uses, so the file always matches
 * what was on screen when the button was pressed.
 *
 * xlsx by default. CSV carries no column width and no wrap setting, so a long
 * message or a run of notes either ran off the side of the screen or — once a
 * cell held a line break — made that row as tall as the text in it, with
 * nothing this end could do about either. `?format=csv` still returns the
 * plain-text version, which remains the better thing to feed another system.
 *
 * The file carries each lead's notes — staff commentary, not just the lead's
 * own words — so it holds internal assessment of a person's finances. Worth
 * knowing before one is forwarded outside the practice.
 */
export async function GET(req: NextRequest) {
  const staff = await requireStaffUser()
  if (!staff) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const params: RawSearchParams = Object.fromEntries(req.nextUrl.searchParams.entries())
  const { filters } = parseLeadQuery(params)
  const wantsCsv = req.nextUrl.searchParams.get('format') === 'csv'

  const leads = await getLeadsForExport(filters)
  // Notes are fetched for exactly the leads being exported, after the filter
  // has narrowed them — not for the whole table.
  const activities = await getActivitiesForLeads(leads.map((lead) => lead.id))
  const stamp = new Date().toISOString().slice(0, 10)

  // Contains names, phone numbers and financial position — never cached.
  const shared = { 'Cache-Control': 'no-store, private' }

  if (wantsCsv) {
    // Excel does not read a CSV as UTF-8 unless the file says so. Without the
    // mark it falls back to the system codepage and every non-ASCII character
    // arrives mangled.
    return new NextResponse(`${UTF8_BOM}${leadsToCsv(leads, activities)}`, {
      headers: {
        ...shared,
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="mcr-leads-${stamp}.csv"`,
      },
    })
  }

  const workbook = await buildLeadsWorkbook(leads, activities)

  return new NextResponse(new Uint8Array(workbook), {
    headers: {
      ...shared,
      'Content-Type': XLSX_TYPE,
      'Content-Disposition': `attachment; filename="mcr-leads-${stamp}.xlsx"`,
    },
  })
}
