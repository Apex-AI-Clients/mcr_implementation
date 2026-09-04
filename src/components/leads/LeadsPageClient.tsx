'use client'

import { useEffect, useMemo, useState } from 'react'
import { Download, Plus, Search } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { LeadTable } from '@/components/leads/LeadTable'
import { LeadFilters } from '@/components/leads/LeadFilters'
import { AddLeadDialog } from '@/components/leads/AddLeadDialog'
import { ConvertToClientDialog } from '@/components/leads/ConvertToClientDialog'
import { useLeads } from '@/components/leads/LeadsStore'
import { EMPTY_FILTERS, filterLeads, hasActiveFilters, type LeadFilterState } from '@/lib/leads/filter'
import { leadsToCsv } from '@/lib/leads/format'
// Only the follow-up count in the header is hidden; the rule is unchanged.
// import { needsFollowUp } from '@/lib/leads/followUp'
import type { Lead } from '@/types/leads'

const SEARCH_DEBOUNCE_MS = 250

export function LeadsPageClient() {
  const { leads } = useLeads()

  const [term, setTerm] = useState('')
  const [filters, setFilters] = useState<LeadFilterState>(EMPTY_FILTERS)
  const [addOpen, setAddOpen] = useState(false)
  const [convertTarget, setConvertTarget] = useState<Lead | null>(null)

  // Debounced search — the input stays responsive while the list settles.
  useEffect(() => {
    if (term === filters.search) return
    const timer = setTimeout(() => {
      setFilters((prev) => ({ ...prev, search: term }))
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [term, filters.search])

  const visible = useMemo(() => filterLeads(leads, filters), [leads, filters])
  const active = hasActiveFilters(filters)
  // const followUps = useMemo(() => leads.filter((lead) => needsFollowUp(lead)).length, [leads])

  function patchFilters(patch: Partial<LeadFilterState>) {
    setFilters((prev) => ({ ...prev, ...patch }))
  }

  function resetFilters() {
    setTerm('')
    setFilters(EMPTY_FILTERS)
  }

  function handleExport() {
    const csv = leadsToCsv(visible)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `mcr-leads-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Leads</h1>
          <p className="mt-1 text-sm text-foreground/50">
            <span className="tabular-nums">{leads.length}</span>{' '}
            {leads.length === 1 ? 'lead' : 'leads'}
            {/* Follow-up count — hidden along with the table column and the
                filter toggle. Restore this with the `followUps` useMemo and the
                needsFollowUp import above.
            <span aria-hidden="true"> · </span>
            <span className={followUps > 0 ? 'text-warning' : undefined}>
              <span className="tabular-nums">{followUps}</span> need
              {followUps === 1 ? 's' : ''} follow-up
            </span>
            */}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" onClick={handleExport}>
            <Download className="h-4 w-4" />
            Export
          </Button>
          <Button type="button" onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4" />
            Add lead
          </Button>
        </div>
      </div>

      {/* Search and filters read as one toolbar rather than controls adrift on
          the page background. */}
      <div className="mb-4 rounded-xl border border-border bg-card p-3">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
            aria-hidden="true"
          />
          <input
            type="search"
            aria-label="Search leads"
            placeholder="Search name, email or phone"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            className="h-9 w-full rounded-lg border border-border bg-input-bg pl-9 pr-3 text-sm text-foreground transition-colors placeholder:text-muted focus:border-accent focus:outline-none"
          />
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <LeadFilters filters={filters} onChange={patchFilters} onReset={resetFilters} />
          {active && (
            <p className="shrink-0 text-xs text-foreground/50">
              <span className="tabular-nums">{visible.length}</span> of{' '}
              <span className="tabular-nums">{leads.length}</span> shown
            </p>
          )}
        </div>
      </div>

      <LeadTable
        leads={visible}
        filtered={active}
        onResetFilters={resetFilters}
        onRequestConvert={setConvertTarget}
      />

      <AddLeadDialog open={addOpen} onClose={() => setAddOpen(false)} />
      <ConvertToClientDialog lead={convertTarget} onClose={() => setConvertTarget(null)} />
    </div>
  )
}
