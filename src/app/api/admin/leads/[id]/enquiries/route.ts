import { NextResponse } from 'next/server'
import { requireStaffUser } from '@/lib/auth/staff'
import { getSubmissionsForLead } from '@/lib/leads/queries'

/**
 * GET /api/admin/leads/[id]/enquiries — every enquiry the lead has made,
 * newest first, each with the client file it became (0052).
 *
 * For "Convert to client" opened from the lead list, which does not hold the
 * enquiries: staff pick which enquiry the new file is made from.
 */

interface Props {
  params: Promise<{ id: string }>
}

export async function GET(_req: Request, { params }: Props) {
  const staff = await requireStaffUser()
  if (!staff) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  return NextResponse.json({ enquiries: await getSubmissionsForLead(id) })
}
