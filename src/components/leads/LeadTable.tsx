'use client'

import { useEffect, useRef } from 'react'
import { LeadTableRow, LeadCard } from '@/components/leads/LeadTableRow'
import { Button } from '@/components/ui/Button'
// Only the follow-up column is hidden; the rule still runs elsewhere.
// import { needsFollowUp } from '@/lib/leads/followUp'
import type { Lead } from '@/types/leads'

interface LeadTableProps {
  leads: Lead[]
  /** True when a filter is narrowing the view — changes the empty state. */
  filtered: boolean
  onResetFilters: () => void
  onRequestConvert: (lead: Lead) => void
  /** Ids ticked on this page. Selection does not survive a page change. */
  selectedIds: ReadonlySet<string>
  onToggleLead: (leadId: string) => void
  /** Tick or clear every row on this page. */
  onToggleAll: () => void
  onRequestDelete: (leads: Lead[]) => void
}

/**
 * Header checkbox.
 *
 * `indeterminate` is a DOM property, not an attribute, so React cannot set it
 * from JSX — it needs the ref. Without it a partial selection looks identical
 * to an empty one.
 */
function SelectAllCheckbox({
  checked,
  indeterminate,
  onChange,
}: {
  checked: boolean
  indeterminate: boolean
  onChange: () => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate
  }, [indeterminate])

  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      onChange={onChange}
      aria-label={checked ? 'Clear selection' : 'Select all leads on this page'}
      className="h-4 w-4 cursor-pointer accent-accent"
    />
  )
}

const COLUMNS = [
  { label: 'Date', className: 'text-left' },
  { label: 'Name', className: 'text-left' },
  // Hidden on narrower desktops so the table fits the window instead of
  // scrolling. Email is on the record, one click away, and in the card layout
  // below md. Keep in step with the matching <td> in LeadTableRow — the header
  // and body column counts must never diverge.
  { label: 'Email', className: 'text-left hidden xl:table-cell' },
  { label: 'Phone', className: 'text-left' },
  // Left-aligned to match the cell: a short single figure stranded on the
  // right edge reads as misaligned.
  { label: 'Debt', className: 'text-left' },
  // Longer than the "Company"/"Trust" badges beneath it, so it sets this
  // column's width — nowrap keeps it on one line rather than stacking and
  // making every header row taller.
  { label: 'Business type', className: 'text-left whitespace-nowrap' },
  { label: 'State', className: 'text-left' },
  // The widest column and the one already allowed to lose information, so it
  // is the first to go. Same pairing rule as Email above.
  { label: 'Message', className: 'text-left hidden 2xl:table-cell' },
  { label: 'Stage', className: 'text-left' },
  { label: 'Source', className: 'text-left' },
  // Follow-up flag column — hidden for now. Keep in step with the matching
  // <td> in LeadTableRow, or the header and body column counts diverge.
  // { label: '', className: 'text-left' },
]

export function LeadTable({
  leads,
  filtered,
  onResetFilters,
  onRequestConvert,
  selectedIds,
  onToggleLead,
  onToggleAll,
  onRequestDelete,
}: LeadTableProps) {
  const selectedHere = leads.filter((lead) => selectedIds.has(lead.id)).length
  const allSelected = leads.length > 0 && selectedHere === leads.length
  if (leads.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border py-16 text-center">
        {filtered ? (
          <>
            <p className="text-sm text-foreground/50">No leads match these filters</p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mt-3"
              onClick={onResetFilters}
            >
              Clear filters
            </Button>
          </>
        ) : (
          <p className="mx-auto max-w-sm text-sm leading-relaxed text-foreground/50">
            No leads yet. They&rsquo;ll arrive here from Facebook and the website, or add one
            manually.
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-xl border border-white/8">
      {/* Desktop table */}
      {/* overflow-y-hidden is load-bearing: with only overflow-x set, the CSS
          Overflow spec turns the other axis' `visible` into `auto`, making this
          a vertical scroll container as well — a second scrollbar inside the
          page's own. */}
      <div className="hidden overflow-x-auto overflow-y-hidden md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/8 bg-surface/60">
              {/* Selection and delete, ahead of the data columns. Paired with
                  the matching <td>s in LeadTableRow. */}
              <th scope="col" className="w-9 px-2 py-3">
                <SelectAllCheckbox
                  checked={allSelected}
                  indeterminate={selectedHere > 0 && !allSelected}
                  onChange={onToggleAll}
                />
              </th>
              <th scope="col" className="w-9 px-2 py-3">
                <span className="sr-only">Delete</span>
              </th>
              {COLUMNS.map((column, index) => (
                <th
                  key={column.label || `col-${index}`}
                  scope="col"
                  className={`px-3 py-3 font-medium text-foreground/50 ${column.className}`}
                >
                  {column.label || <span className="sr-only">Follow-up</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {leads.map((lead) => (
              <LeadTableRow
                key={lead.id}
                lead={lead}
                onRequestConvert={onRequestConvert}
                selected={selectedIds.has(lead.id)}
                onToggleSelect={onToggleLead}
                onRequestDelete={(target) => onRequestDelete([target])}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* Stacked cards below md */}
      <div className="md:hidden">
        {leads.map((lead) => (
          <LeadCard
            key={lead.id}
            lead={lead}
            onRequestConvert={onRequestConvert}
            selected={selectedIds.has(lead.id)}
            onToggleSelect={onToggleLead}
            onRequestDelete={(target) => onRequestDelete([target])}
          />
        ))}
      </div>
    </div>
  )
}
