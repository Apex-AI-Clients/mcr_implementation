'use client'

import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
// import { FollowUpBadge } from '@/components/leads/FollowUpBadge'
import { STAGE_META } from '@/lib/leads/constants'
import { formatFullDate, formatLeadSource } from '@/lib/leads/format'
// import { needsFollowUp } from '@/lib/leads/followUp'
import type { Lead } from '@/types/leads'

interface LeadRecordHeaderProps {
  lead: Lead
}

export function LeadRecordHeader({ lead }: LeadRecordHeaderProps) {
  const stage = STAGE_META[lead.stage]

  return (
    <div className="mb-6">
      <Link
        href="/leads"
        className="inline-flex items-center gap-1.5 text-xs text-muted transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
        All leads
      </Link>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="text-xl font-semibold text-foreground">{lead.name}</h1>
        <Badge variant={stage.badge}>{stage.label}</Badge>
        {/* Follow-up badge — hidden with the rest of the follow-up UI (table
            column, filter toggle, page-header count, top-bar pill). */}
        {/* {needsFollowUp(lead) && <FollowUpBadge />} */}
      </div>

      <p className="mt-1.5 text-sm text-foreground/50">
        {formatLeadSource(lead)}
        <span aria-hidden="true"> · </span>
        Added {formatFullDate(lead.createdAt)}
      </p>
    </div>
  )
}
