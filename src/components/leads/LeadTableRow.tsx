'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { StageSelect } from '@/components/leads/StageSelect'
import { DebtInput } from '@/components/leads/DebtInput'
// Follow-up flag temporarily hidden — see the note on LeadRowProps.
// import { FollowUpBadge } from '@/components/leads/FollowUpBadge'
import { Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Tooltip } from '@/components/ui/Tooltip'
import { ENTITY_TYPE_META } from '@/lib/leads/constants'
import {
  describeUncertainState,
  formatLeadSource,
  formatPhone,
  formatShortDate,
} from '@/lib/leads/format'
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
  selected: boolean
  onToggleSelect: (leadId: string) => void
  onRequestDelete: (lead: Lead) => void
}

/**
 * The row's own controls sit inside a row that navigates on click, so every
 * one of them has to stop the event. Without this, ticking a checkbox would
 * also open the record.
 */
function swallow(event: React.MouseEvent) {
  event.stopPropagation()
}

/**
 * Desktop table row. Opening the record deliberately does not clear the
 * follow-up flag — only a recorded action does that.
 */
export function LeadTableRow({
  lead,
  onRequestConvert,
  selected,
  onToggleSelect,
  onRequestDelete,
}: LeadRowProps) {
  const router = useRouter()
  const uncertainState = describeUncertainState(lead)

  return (
    <tr
      onClick={() => router.push(`/leads/${lead.id}`)}
      className={`cursor-pointer transition-colors hover:bg-surface/40 ${
        selected ? 'bg-accent/5' : 'bg-primary'
      }`}
    >
      {/* Selection and delete lead the row. Both paired with their headers in
          LeadTable's markup — the two must stay in step or the column counts
          diverge. */}
      <td className="w-9 px-2 py-3.5" onClick={swallow}>
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggleSelect(lead.id)}
          aria-label={`Select ${lead.name}`}
          className="h-4 w-4 cursor-pointer accent-accent"
        />
      </td>
      <td className="w-9 px-2 py-3.5" onClick={swallow}>
        <button
          type="button"
          onClick={() => onRequestDelete(lead)}
          aria-label={`Delete ${lead.name}`}
          // Muted until hovered: a destructive control on every row of a dense
          // table should not be the first thing the eye lands on.
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-foreground/30 transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive"
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </button>
      </td>
      <td className="px-3 py-3.5 whitespace-nowrap tabular-nums text-foreground/50">
        {formatShortDate(lead.createdAt)}
      </td>
      <td className="px-3 py-3.5">
        <Link
          href={`/leads/${lead.id}`}
          onClick={(event) => event.stopPropagation()}
          className="font-medium text-foreground hover:text-accent"
        >
          {lead.name}
        </Link>
      </td>
      {/* Paired with the Email header in LeadTable's COLUMNS. */}
      <td className="hidden max-w-[180px] truncate px-3 py-3.5 text-foreground/50 xl:table-cell">
        {lead.email}
      </td>
      <td className="px-3 py-3.5 whitespace-nowrap tabular-nums text-foreground/50">
        {formatPhone(lead.phone)}
      </td>
      {/* An exact figure, typed. The forms can only give a bracket; once the
          real number is known it should not have to be rounded to the nearest
          band. Left-aligned: a short single figure like "$150k" stranded on the
          right edge of the cell reads as misaligned against its neighbours. */}
      <td className="px-3 py-3.5 w-[160px] min-w-[160px] whitespace-nowrap text-left">
        <DebtInput lead={lead} />
      </td>
      {/* A qualifying signal, not metadata — a Trust can't take the SBR path,
          so it shouldn't take someone a phone call to find out. */}
      <td className="px-3 py-3.5 whitespace-nowrap">
        {lead.entityType ? (
          <Badge variant={ENTITY_TYPE_META[lead.entityType].badge}>
            {ENTITY_TYPE_META[lead.entityType].label}
          </Badge>
        ) : (
          <span className="text-foreground/25">&mdash;</span>
        )}
      </td>
      <td className="px-3 py-3.5 text-foreground/50">
        {lead.state ??
          (uncertainState ? (
            // Muted so a grouping reads as "one of these", not as a resolved
            // state — it can appear under several state filters at once.
            <span className="text-foreground/30" title={uncertainState.description}>
              {uncertainState.label}
            </span>
          ) : (
            <span className="text-foreground/25">&mdash;</span>
          ))}
      </td>
      {/* The one column allowed to lose information — the record has it in
          full. Capped so a long message can't push Stage and Source off screen. */}
      {/* Paired with the Message header in LeadTable's COLUMNS. */}
      <td className="hidden max-w-[12rem] px-3 py-3.5 2xl:table-cell">
        {lead.message ? (
          // Truncated in the row, in full on hover or focus — the column is the
          // one allowed to lose information, but not to hide it.
          <Tooltip content={lead.message} className="block min-w-0 cursor-help">
            <span className="block truncate text-foreground/50">{lead.message}</span>
          </Tooltip>
        ) : (
          <span className="text-foreground/25">&mdash;</span>
        )}
      </td>
      {/* "Non-proceeding" and "Do not contact" are 14 characters; with the
          select's own padding and chevron they need ~150px of control, so a
          narrower cell clipped the selected label and forced you to open the
          dropdown to read it. */}
      <td className="px-3 py-3.5 w-[188px] min-w-[188px]">
        {/* min-w on the control as well as the cell: a w-full <select> has a
            min-content width of zero, so without it auto table layout crushes
            this column to the chevron alone once the table overflows. */}
        <StageSelect
          lead={lead}
          onRequestConvert={onRequestConvert}
          className="min-w-[150px]"
        />
      </td>
      {/* The partner who ran the campaign, where one is known — "Facebook ·
          EPIC DM". Resolved from the campaign name captured at ingest, so it
          costs no request. Plain "Facebook" when the lead came from elsewhere,
          the campaign is unknown, or it is run in-house. */}
      <td className="px-3 py-3.5 whitespace-nowrap text-foreground/50">
        {formatLeadSource(lead)}
      </td>
      {/* <td className="px-3 py-3.5 w-8">{flagged && <FollowUpBadge compact />}</td> */}
    </tr>
  )
}

/** Below md the same row stacks into a card. */
export function LeadCard({
  lead,
  onRequestConvert,
  selected,
  onToggleSelect,
  onRequestDelete,
}: LeadRowProps) {
  const router = useRouter()
  const uncertainState = describeUncertainState(lead)

  return (
    <div
      onClick={() => router.push(`/leads/${lead.id}`)}
      className={`cursor-pointer space-y-3 border-b border-white/5 p-4 last:border-b-0 ${
        selected ? 'bg-accent/5' : 'bg-primary'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={selected}
              onChange={() => onToggleSelect(lead.id)}
              onClick={swallow}
              aria-label={`Select ${lead.name}`}
              className="h-4 w-4 shrink-0 cursor-pointer accent-accent"
            />
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
        <div className="flex shrink-0 items-start gap-1">
          <div className="w-[124px]">
            <DebtInput lead={lead} />
          </div>
          <button
            type="button"
            onClick={(event) => {
              swallow(event)
              onRequestDelete(lead)
            }}
            aria-label={`Delete ${lead.name}`}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-foreground/30 transition-colors hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      {lead.message && (
        <p className="truncate text-xs text-foreground/50" title={lead.message}>
          {lead.message}
        </p>
      )}

      <div className="flex items-center gap-2 text-xs text-foreground/40">
        <span className="tabular-nums">{formatShortDate(lead.createdAt)}</span>
        {lead.entityType && (
          <>
            <span aria-hidden="true">&middot;</span>
            <span>{ENTITY_TYPE_META[lead.entityType].label}</span>
          </>
        )}
        <span aria-hidden="true">·</span>
        {lead.state ? (
          <span>{lead.state}</span>
        ) : (
          uncertainState && (
            <span className="text-foreground/30" title={uncertainState.description}>
              {uncertainState.label}
            </span>
          )
        )}
        <span aria-hidden="true">·</span>
        <span>{formatLeadSource(lead, 'short')}</span>
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
