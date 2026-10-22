'use client'

// Flag is only used by the follow-up toggle, hidden for now.
import { X } from 'lucide-react'
import { Select } from '@/components/ui/Select'
import { AU_STATES, DATE_RANGES, DEBT_FLOORS, SORT_OPTIONS } from '@/lib/leads/constants'
import { hasActiveFilters, type LeadFilterState } from '@/lib/leads/filter'

interface LeadFiltersProps {
  filters: LeadFilterState
  onChange: (patch: Partial<LeadFilterState>) => void
  onReset: () => void
  /** Every source the leads show, from the data (getLeadSourceOptions). */
  sources?: string[]
}

const STATE_OPTIONS = AU_STATES.map((state) => ({ value: state, label: state }))
// Floors, not brackets: "show me the big ones", not "exactly this bracket".
const DEBT_OPTIONS = DEBT_FLOORS.map((f) => ({ value: f.value, label: f.label }))
const DATE_OPTIONS = DATE_RANGES.filter((range) => range.value !== 'any').map((range) => ({
  value: range.value,
  label: range.label,
}))

/**
 * Additive filters on one row. Follow-up is a toggle here, not a separate page.
 * No stage filter: each stage has its own screen (LEAD_VIEWS).
 *
 * Widths go on each Select's wrapper: `className` reaches the inner <select>,
 * and the wrapper is what this flex row actually lays out.
 */
export function LeadFilters({ filters, onChange, onReset, sources = [] }: LeadFiltersProps) {
  const active = hasActiveFilters(filters)
  // A source in the URL that no lead shows any more is still offered, so the
  // select never reads as unfiltered while it filters.
  const sourceOptions = [...sources, ...(filters.source !== 'all' && !sources.includes(filters.source) ? [filters.source] : [])].map(
    (source) => ({ value: source, label: source }),
  )

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        aria-label="Filter by state"
        selectSize="sm"
        wrapperClassName="w-[116px]"
        placeholder="All states"
        value={filters.state === 'all' ? '' : filters.state}
        onChange={(event) =>
          onChange({ state: (event.target.value || 'all') as LeadFilterState['state'] })
        }
        options={STATE_OPTIONS}
      />
      <Select
        aria-label="Filter by minimum debt"
        selectSize="sm"
        wrapperClassName="w-[112px]"
        placeholder="Any debt"
        value={filters.debtFloor === null ? '' : String(filters.debtFloor)}
        onChange={(event) =>
          onChange({ debtFloor: event.target.value ? Number(event.target.value) : null })
        }
        options={DEBT_OPTIONS}
      />
      <Select
        aria-label="Filter by source"
        selectSize="sm"
        wrapperClassName="w-[140px]"
        placeholder="All sources"
        value={filters.source === 'all' ? '' : filters.source}
        onChange={(event) =>
          onChange({ source: event.target.value || 'all' })
        }
        options={sourceOptions}
      />
      <Select
        aria-label="Filter by date added"
        selectSize="sm"
        wrapperClassName="w-[128px]"
        placeholder="Any date"
        value={filters.dateRange === 'any' ? '' : filters.dateRange}
        onChange={(event) => onChange({ dateRange: event.target.value || 'any' })}
        options={DATE_OPTIONS}
      />

      {/* Follow-up toggle — hidden for now. `followUpOnly` stays in
          LeadFilterState and filterLeads still honours it, so restoring this
          block is all that's needed.
      <button
        type="button"
        role="switch"
        aria-checked={filters.followUpOnly}
        onClick={() => onChange({ followUpOnly: !filters.followUpOnly })}
        className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
          filters.followUpOnly
            ? 'border-warning/40 bg-warning/15 text-warning'
            : 'border-border bg-surface text-muted hover:text-foreground'
        }`}
      >
        <Flag className="h-3 w-3" aria-hidden="true" />
        Follow-up
      </button>
      */}

      {/* Sort is not a filter — it changes the order, not the set, so it sits
          outside the active-filter count and the clear control. */}
      <Select
        aria-label="Sort leads"
        selectSize="sm"
        wrapperClassName="w-[150px]"
        value={filters.sort}
        onChange={(event) =>
          onChange({ sort: event.target.value as LeadFilterState['sort'] })
        }
        options={SORT_OPTIONS}
      />

      {active && (
        <button
          type="button"
          onClick={onReset}
          className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg px-2 text-xs text-muted transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <X className="h-3 w-3" aria-hidden="true" />
          Clear
        </button>
      )}
    </div>
  )
}
