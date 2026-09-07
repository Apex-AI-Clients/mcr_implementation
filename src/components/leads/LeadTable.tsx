'use client'

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
}

const COLUMNS = [
  { label: 'Date', className: 'text-left' },
  { label: 'Name', className: 'text-left' },
  { label: 'Email', className: 'text-left' },
  { label: 'Phone', className: 'text-left' },
  // Left-aligned to match the cell: a short single figure stranded on the
  // right edge reads as misaligned.
  { label: 'Debt', className: 'text-left' },
  { label: 'Entity', className: 'text-left' },
  { label: 'State', className: 'text-left' },
  { label: 'Message', className: 'text-left' },
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
}: LeadTableProps) {
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
              {COLUMNS.map((column, index) => (
                <th
                  key={column.label || `col-${index}`}
                  scope="col"
                  className={`px-4 py-3 font-medium text-foreground/50 ${column.className}`}
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
          />
        ))}
      </div>
    </div>
  )
}
