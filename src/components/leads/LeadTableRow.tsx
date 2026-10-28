'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { StageSelect } from '@/components/leads/StageSelect'
import { DebtInput } from '@/components/leads/DebtInput'
import { SourceInput } from '@/components/leads/SourceInput'
// Follow-up flag temporarily hidden — see the note on LeadRowProps.
// import { FollowUpBadge } from '@/components/leads/FollowUpBadge'
import { MessageSquareText, NotebookPen, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Tooltip } from '@/components/ui/Tooltip'
import { ENTITY_TYPE_META } from '@/lib/leads/constants'
import {
  describeLatestEnquiry,
  enquiryCountLabel,
  reenquiryMarkerLabel,
  showsReenquiryMarker,
} from '@/lib/leads/enquiries'
import {
  describeUncertainState,
  formatEntityType,
  formatPhone,
  formatShortDate,
} from '@/lib/leads/format'
import type { Lead } from '@/types/leads'
import { noteHeading, type LeadNote } from '@/lib/leads/notes'

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
  /** The lead's notes, newest first; undefined when the table has no notes column. */
  notes?: LeadNote[]
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
  notes,
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
      {/* The latest enquiry, not the first: the list sorts on it, so the date
          shown has to be the one the order follows. */}
      <td className="px-3 py-3.5 whitespace-nowrap tabular-nums text-foreground/50">
        {formatShortDate(lead.lastEnquiryAt)}
        <EnquiryCount lead={lead} />
      </td>
      {/* Wraps at spaces, as it always has. Not wrap-anywhere: once the table
          overflows, auto layout shrinks every column to its minimum, and that
          would break ordinary names mid-word ("Pava/n"). */}
      <td className="px-3 py-3.5">
        <Link
          href={`/leads/${lead.id}`}
          onClick={(event) => event.stopPropagation()}
          className="font-medium text-foreground hover:text-accent"
        >
          {lead.name}
        </Link>
        <ReenquiryMarker lead={lead} className="mt-1" />
      </td>
      {/* Paired with the Email header in LeadTable's COLUMNS. */}
      <td className="hidden max-w-[180px] truncate px-3 py-3.5 text-foreground/50 xl:table-cell">
        {lead.email}
      </td>
      {/* Capped: a malformed number with no spaces would otherwise widen the
          whole table. Cut in the row, in full on hover. */}
      <td
        className="max-w-[10rem] truncate px-3 py-3.5 whitespace-nowrap tabular-nums text-foreground/50"
        title={formatPhone(lead.phone)}
      >
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
        {lead.entityTypeLabel ? (
          <Badge variant="muted">{lead.entityTypeLabel}</Badge>
        ) : lead.entityType ? (
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
            // Same colour as a resolved state; the tooltip says it is a grouping.
            <span title={uncertainState.description}>{uncertainState.label}</span>
          ) : (
            <span className="text-foreground/25">&mdash;</span>
          ))}
      </td>
      {/* An icon, the message in full on hover or focus, like Notes: a text
          column here pushed Stage and Source off screen. The record has it too.
          Paired with the Message header in LeadTable's COLUMNS. */}
      <td className="w-12 px-2 py-3.5 text-center" onClick={swallow}>
        <MessageIcon message={lead.message} />
      </td>
      {/* Paired with the Notes header LeadTable adds when given notes. */}
      {notes && (
        <td className="w-12 px-2 py-3.5 text-center" onClick={swallow}>
          <NotesIcon notes={notes} />
        </td>
      )}
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
          the campaign is unknown, or it is run in-house. Editable in place,
          like the debt. */}
      <td className="px-3 py-3.5 whitespace-nowrap text-foreground/50">
        <SourceInput lead={lead} />
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
  notes,
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
          <ReenquiryMarker lead={lead} className="mt-1.5" />
          <p className="mt-1 truncate text-xs text-foreground/50">{lead.email}</p>
          <p className="mt-0.5 truncate text-xs tabular-nums text-foreground/50">
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

      {notes && notes.length > 0 && (
        <div onClick={swallow}>
          <NotesIcon notes={notes} />
        </div>
      )}

      <div className="flex items-center gap-2 text-xs text-foreground/40">
        <span className="tabular-nums">{formatShortDate(lead.lastEnquiryAt)}</span>
        {lead.enquiryCount > 1 && (
          <>
            <span aria-hidden="true">&middot;</span>
            <EnquiryCount lead={lead} inline />
          </>
        )}
        {formatEntityType(lead) && (
          <>
            <span aria-hidden="true">&middot;</span>
            <span>{formatEntityType(lead)}</span>
          </>
        )}
        <span aria-hidden="true">·</span>
        {lead.state ? (
          <span>{lead.state}</span>
        ) : (
          uncertainState && <span title={uncertainState.description}>{uncertainState.label}</span>
        )}
        <span aria-hidden="true">·</span>
        <SourceInput lead={lead} style="short" />
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

/**
 * "3 enquiries" under the date, with where and when the latest came from on
 * hover or focus. Nothing for a lead with a single enquiry, which is most.
 */
function EnquiryCount({ lead, inline = false }: { lead: Lead; inline?: boolean }) {
  if (lead.enquiryCount < 2) return null
  return (
    <Tooltip
      content={describeLatestEnquiry(lead)}
      className={`${inline ? 'inline' : 'mt-0.5 block w-fit'} cursor-help`}
    >
      <span className="text-xs text-accent">{enquiryCountLabel(lead.enquiryCount)}</span>
    </Tooltip>
  )
}

/**
 * A converted or closed lead that has enquired again. Warning, not
 * destructive: nothing is wrong, but somebody should look. Cleared by a stage
 * change or a dismissal on the record.
 */
function ReenquiryMarker({ lead, className }: { lead: Lead; className?: string }) {
  if (!showsReenquiryMarker(lead)) return null
  return (
    <div className={className}>
      <Badge variant="warning" className="whitespace-nowrap">
        {reenquiryMarkerLabel(lead)}
      </Badge>
    </div>
  )
}

/**
 * The notes column: an icon with the count, every note (newest first, one
 * bullet each) on hover or focus, so a long note never stretches the row. A
 * dash when there are none.
 */
function NotesIcon({ notes }: { notes: LeadNote[] }) {
  if (notes.length === 0) return <span className="text-foreground/25">&mdash;</span>
  return (
    <Tooltip
      content={<NotesList notes={notes} />}
      maxHeightClassName="max-h-[70vh]"
      className="inline-flex cursor-help rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <span
        className="inline-flex items-center gap-1 text-accent"
        aria-label={`${notes.length} note${notes.length === 1 ? '' : 's'}`}
      >
        <NotebookPen className="h-4 w-4" aria-hidden="true" />
        <span className="text-xs tabular-nums">{notes.length}</span>
      </span>
    </Tooltip>
  )
}

/** The message column: an icon, the lead's message on hover or focus. A dash when there is none. */
function MessageIcon({ message }: { message: string | null }) {
  if (!message) return <span className="text-foreground/25">&mdash;</span>
  return (
    <Tooltip
      content={message}
      className="inline-flex cursor-help rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <span className="inline-flex items-center text-accent" aria-label="Message">
        <MessageSquareText className="h-4 w-4" aria-hidden="true" />
      </span>
    </Tooltip>
  )
}

/** The notes in the tooltip: one bullet each, its date and author over the note. */
function NotesList({ notes }: { notes: LeadNote[] }) {
  return (
    <ul className="list-disc space-y-2 pl-4 text-left">
      {notes.map((note, index) => (
        <li key={index}>
          <span className="block text-foreground/50">{noteHeading(note)}</span>
          {note.body.trim()}
        </li>
      ))}
    </ul>
  )
}
