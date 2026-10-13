import { NextResponse } from 'next/server'
import { requireStaffUser } from '@/lib/auth/staff'
import { templateCsv } from '@/lib/sbr/import/headers'

export const dynamic = 'force-dynamic'

/** UTF-8 byte-order mark, so Excel opens the file as UTF-8 (as the leads export). */
const UTF8_BOM = '﻿'

/**
 * GET /api/admin/sbr/case-imports/template — staff only. "Download template":
 * the exact headers the import reads, plus one synthetic example row.
 */
export async function GET() {
  const staff = await requireStaffUser()
  if (!staff) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  return new NextResponse(`${UTF8_BOM}${templateCsv()}`, {
    headers: {
      'Cache-Control': 'no-store, private',
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="sbr-historical-cases-template.csv"',
    },
  })
}
