'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { StageSelect } from '@/components/leads/StageSelect'
// Follow-up flag temporarily hidden — see the note on LeadRowProps.
// import { FollowUpBadge } from '@/components/leads/FollowUpBadge'
import { SOURCE_META } from '@/lib/leads/constants'
import { formatDebt, formatPhone, formatShortDate } from '@/lib/leads/format'
import type { Lead } from '@/types/leads'

interface LeadRowProps {
  lead: Lead
  /**
   * Follow-up flag hidden for now, along with its table column and the filter
   * toggle. The rule itself (needsFollowUp) is untouched and still drives the
   * page-header count — uncomment `flagged` here, the <td> below, the card
   * badge, the COLUMNS entry in LeadTable and the toggle in LeadFilters to
   * bring it back.
   */
  // flagged: boolean
  onRequestConvert: (lead: Lead) => void
}

/**
 * Desktop table row. Opening the record deliberately does not clear the
 * follow-up flag — only a recorded action does that.
 */
export function LeadTableRow({ lead, onRequestConvert }: LeadRowProps) {
  const router = useRouter()

  return (
    <tr
      onClick={() => router.push(`/leads/${lead.id}`)}
      className="cursor-pointer bg-primary transition-colors hover:bg-surface/40"
    >
      <td className="px-4 py-3.5 whitespace-nowrap tabular-nums text-foreground/50">
        {formatShortDate(lead.createdAt)}
      </td>
      <td className="px-4 py-3.5">
        <Link
          href={`/leads/${lead.id}`}
          onClick={(event) => event.stopPropagation()}
          className="font-medium text-foreground hover:text-accent"
        >
          {lead.name}
        </Link>
      </td>
      <td className="px-4 py-3.5 max-w-[180px] truncate text-foreground/50">{lead.email}</td>
      <td className="px-4 py-3.5 whitespace-nowrap tabular-nums text-foreground/50">
        {formatPhone(lead.phone)}
      </td>
      <td className="px-4 py-3.5 whitespace-nowrap text-right font-medium tabular-nums text-foreground">
        {formatDebt(lead.debtAmount)}
      </td>
      <td className="px-4 py-3.5 text-foreground/50">{lead.state}</td>
      <td className="px-4 py-3.5 w-[150px]">
        <StageSelect lead={lead} onRequestConvert={onRequestConvert} />
      </td>
      <td className="px-4 py-3.5 whitespace-nowrap text-foreground/50">
        {SOURCE_META[lead.source].short}
      </td>
      {/* <td className="px-4 py-3.5 w-8">{flagged && <FollowUpBadge compact />}</td> */}
    </tr>
  )
}

/** Below md the same row stacks into a card. */
export function LeadCard({ lead, onRequestConvert }: LeadRowProps) {
  const router = useRouter()

  return (
    <div
      onClick={() => router.push(`/leads/${lead.id}`)}
      className="cursor-pointer space-y-3 border-b border-white/5 bg-primary p-4 last:border-b-0"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Link
              href={`/leads/${lead.id}`}
              onClick={(event) => event.stopPropagation()}
              className="truncate font-medium text-foreground hover:text-accent"
            >
              {lead.name}
            </Link>
            {/* {flagged && <FollowUpBadge compact />} */}
          </div>
          <p className="mt-1 truncate text-xs text-foreground/50">{lead.email}</p>
          <p className="mt-0.5 text-xs tabular-nums text-foreground/50">
            {formatPhone(lead.phone)}
          </p>
        </div>
        <p className="shrink-0 font-medium tabular-nums text-foreground">
          {formatDebt(lead.debtAmount)}
        </p>
      </div>

      <div className="flex items-center gap-2 text-xs text-foreground/40">
        <span className="tabular-nums">{formatShortDate(lead.createdAt)}</span>
        <span aria-hidden="true">·</span>
        <span>{lead.state}</span>
        <span aria-hidden="true">·</span>
        <span>{SOURCE_META[lead.source].short}</span>
      </div>

      <StageSelect
        lead={lead}
        onRequestConvert={onRequestConvert}
        selectSize="md"
        className="w-full"
      />
    </div>
  )
}
