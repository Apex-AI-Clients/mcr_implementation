'use client'

import { Flag, X } from 'lucide-react'
import { Select } from '@/components/ui/Select'
import {
  ALL_STAGES,
  ALL_SOURCES,
  AU_STATES,
  DATE_RANGES,
  SOURCE_META,
  STAGE_META,
} from '@/lib/leads/constants'
import { hasActiveFilters, type LeadFilterState } from '@/lib/leads/filter'

interface LeadFiltersProps {
  filters: LeadFilterState
  onChange: (patch: Partial<LeadFilterState>) => void
  onReset: () => void
}

const STAGE_OPTIONS = ALL_STAGES.map((stage) => ({
  value: stage,
  label: STAGE_META[stage].label,
}))
const STATE_OPTIONS = AU_STATES.map((state) => ({ value: state, label: state }))
const SOURCE_OPTIONS = ALL_SOURCES.map((source) => ({
  value: source,
  label: SOURCE_META[source].label,
}))
const DATE_OPTIONS = DATE_RANGES.filter((range) => range.value !== 'any').map((range) => ({
  value: range.value,
  label: range.label,
}))

/**
 * Additive filters on one row. Follow-up is a toggle here, not a separate page.
 *
 * Widths go on each Select's wrapper: `className` reaches the inner <select>,
 * and the wrapper is what this flex row actually lays out.
 */
export function LeadFilters({ filters, onChange, onReset }: LeadFiltersProps) {
  const active = hasActiveFilters(filters)

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        aria-label="Filter by stage"
        selectSize="sm"
        wrapperClassName="w-[132px]"
        placeholder="All stages"
        value={filters.stage === 'all' ? '' : filters.stage}
        onChange={(event) =>
          onChange({ stage: (event.target.value || 'all') as LeadFilterState['stage'] })
        }
        options={STAGE_OPTIONS}
      />
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
        aria-label="Filter by source"
        selectSize="sm"
        wrapperClassName="w-[140px]"
        placeholder="All sources"
        value={filters.source === 'all' ? '' : filters.source}
        onChange={(event) =>
          onChange({ source: (event.target.value || 'all') as LeadFilterState['source'] })
        }
        options={SOURCE_OPTIONS}
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
