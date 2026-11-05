import { NextRequest, NextResponse } from 'next/server'
import { requireStaffUser } from '@/lib/auth/staff'
import { readTemplate } from '@/lib/forms/fill'
import { FORM_CODES, formVersion } from '@/lib/forms/registry'
import type { FormCode } from '@/lib/forms/types'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/cvl/templates/[code]?version=20220801 — an official ASIC form
 * PDF, unchanged, for the fill-in screen to fill in the browser while staff
 * type (no server work per keystroke). Each version never changes, so the
 * browser keeps it: fetched once per form, not per preview.
 */

interface Params {
  params: Promise<{ code: string }>
}

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const staff = await requireStaffUser()
    if (!staff) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { code } = await params
    if (!(FORM_CODES as string[]).includes(code)) return NextResponse.json({ error: 'Unknown form' }, { status: 404 })
    const version = req.nextUrl.searchParams.get('version') ?? undefined
    try {
      formVersion(code as FormCode, version)
    } catch {
      return NextResponse.json({ error: 'Unknown form version' }, { status: 404 })
    }

    const bytes = await readTemplate(code as FormCode, version)
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        'Content-Type': 'application/pdf',
        // A version's template never changes; private: only signed-in staff fetch it.
        'Cache-Control': 'private, max-age=31536000, immutable',
      },
    })
  } catch (err) {
    console.error('[GET /api/admin/cvl/templates/[code]]', err instanceof Error ? err.message : 'unknown')
    return NextResponse.json({ error: 'Could not read the form' }, { status: 500 })
  }
}
