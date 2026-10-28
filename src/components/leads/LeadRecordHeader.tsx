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
  /** Record-level actions, right-aligned against the name. */
  actions?: React.ReactNode
}

export function LeadRecordHeader({ lead, actions }: LeadRecordHeaderProps) {
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

      <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3.5">
          {/* Initials, so the page is recognisably this person at a glance. */}
          <span
            aria-hidden="true"
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-accent/10 text-base font-semibold text-accent"
          >
            {initials(lead.name)}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <h1 className="text-2xl font-semibold text-foreground wrap-anywhere">{lead.name}</h1>
              <Badge variant={stage.badge}>{stage.label}</Badge>
              {/* Follow-up badge — hidden with the rest of the follow-up UI (table
                  column, filter toggle, page-header count, top-bar pill). */}
              {/* {needsFollowUp(lead) && <FollowUpBadge />} */}
            </div>
            <p className="mt-1 text-sm text-foreground/50">
              {formatLeadSource(lead)}
              <span aria-hidden="true"> · </span>
              Added {formatFullDate(lead.createdAt)}
              {lead.enquiryCount > 1 && (
                <>
                  <span aria-hidden="true"> · </span>
                  {lead.enquiryCount} enquiries, latest {formatFullDate(lead.lastEnquiryAt)}
                </>
              )}
            </p>
          </div>
        </div>
        {actions}
      </div>
    </div>
  )
}

/** "Dean Whitlock" → "DW"; one word gives one letter. */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  const letters = words.length > 1 ? [words[0], words[words.length - 1]] : words
  return letters.map((word) => word[0]?.toUpperCase() ?? '').join('') || '?'
}
