'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Download, Plus, Search, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Pagination } from '@/components/ui/Pagination'
import { Select } from '@/components/ui/Select'
import { LoadingOverlay } from '@/components/ui/LoadingOverlay'
import { LeadTable } from '@/components/leads/LeadTable'
import { LeadFilters } from '@/components/leads/LeadFilters'
import { AddLeadDialog } from '@/components/leads/AddLeadDialog'
import { ConvertToClientDialog } from '@/components/leads/ConvertToClientDialog'
import { DeleteLeadsDialog } from '@/components/leads/DeleteLeadsDialog'
import { useLeads } from '@/components/leads/LeadsStore'
import { EMPTY_FILTERS, hasActiveFilters, type LeadFilterState } from '@/lib/leads/filter'
import { buildLeadQuery, leadsHref } from '@/lib/leads/searchParams'
import { PER_PAGE_OPTIONS, pageRangeLabel, type PerPage } from '@/lib/leads/pagination'
import { ALL_VIEWS, LEAD_VIEWS, type LeadView } from '@/lib/leads/constants'
import { cn } from '@/lib/utils'
import type { Lead } from '@/types/leads'
import type { LeadNote } from '@/lib/leads/notes'

const SEARCH_DEBOUNCE_MS = 250

const PER_PAGE_SELECT = PER_PAGE_OPTIONS.map((option) => ({
  value: String(option),
  label: option === 'all' ? 'All' : String(option),
}))

interface LeadsPageClientProps {
  /** The filters the server just applied, parsed from the URL. */
  filters: LeadFilterState
  /** This page of rows, already filtered and sorted in the database. */
  leads: Lead[]
  /** Rows matching the filters across every page. */
  total: number
  page: number
  pageCount: number
  pageSize: number
  /** The header tab: which stages are listed (LEAD_VIEWS). None: every stage. */
  view?: LeadView
  /** The Source filter's options, from the data. */
  sources?: string[]
  /** Leads per tab, with the other filters applied. No tabs without them. */
  counts?: Record<LeadView, number>
  /** Each lead's notes, newest first; given, the table shows a Notes column. */
  notes?: Record<string, LeadNote[]>
}

/**
 * Leads list.
 *
 * Paging, filtering and sorting all happen server-side; this component owns
 * only the controls that drive the URL and the optimistic overlay on top of
 * what came back. Two consequences worth knowing:
 *
 *  - Changing a filter resets to page 1. Staying on page 7 of a result set
 *    that now has two pages is never what anyone meant.
 *  - Rows render from the server's list but read their values through the
 *    store, so a stage change or a debt edit shows immediately while the row
 *    keeps the position the database gave it.
 */
export function LeadsPageClient({
  filters,
  leads,
  total,
  page,
  pageCount,
  pageSize,
  view,
  sources = [],
  counts,
  notes,
}: LeadsPageClientProps) {
  const screen = view ? LEAD_VIEWS[view] : null
  const router = useRouter()
  const { getLead, syncFromServer } = useLeads()

  const [term, setTerm] = useState(filters.search)
  const [addOpen, setAddOpen] = useState(false)
  const [convertTarget, setConvertTarget] = useState<Lead | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Lead[] | null>(null)
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set())
  const [pending, startTransition] = useTransition()
  // From pressing Add until the re-read that brings the new row in has landed.
  const [adding, setAdding] = useState(false)

  // Hand this page's rows to the store so edits made in the table have
  // something to apply to. Activities are loaded per record, not here.
  useEffect(() => {
    syncFromServer(leads, [])
    // Selection is per page of results. Carrying ticks across a page change or
    // a filter would mean deleting rows the person can no longer see.
    setSelectedIds(new Set())
  }, [leads, syncFromServer])

  // The URL is the source of truth, so a back button or a cleared filter has
  // to be able to push a new term into the box.
  useEffect(() => {
    setTerm(filters.search)
  }, [filters.search])

  // Debounced search — the input stays responsive while the query settles.
  useEffect(() => {
    if (term === filters.search) return
    const timer = setTimeout(() => {
      navigate({ search: term })
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
    // navigate is stable for a given filters object, which is what should
    // retrigger this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term, filters])

  /** Apply a filter change and go back to page 1. */
  function navigate(patch: Partial<LeadFilterState>) {
    const next = { ...filters, ...patch }
    startTransition(() => router.replace(leadsHref(next, 1), { scroll: false }))
  }

  function resetFilters() {
    setTerm('')
    // How many rows to show is a preference, not a filter, so it survives Clear.
    startTransition(() =>
      router.replace(leadsHref({ ...EMPTY_FILTERS, view: view ?? 'all', perPage: filters.perPage }), {
        scroll: false,
      }),
    )
  }

  function handleExport() {
    // Exports every matching row, not the page on screen — the server streams
    // it, because the browser no longer holds the rest.
    const query = buildLeadQuery(filters, 1)
    window.location.href = query
      ? `/api/admin/leads/export?${query}`
      : '/api/admin/leads/export'
  }

  function toggleLead(leadId: string) {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (!next.delete(leadId)) next.add(leadId)
      return next
    })
  }

  function toggleAll() {
    setSelectedIds((current) =>
      current.size === leads.length ? new Set() : new Set(leads.map((lead) => lead.id)),
    )
  }

  function handleAdded(saved: Promise<void>) {
    setAdding(true)
    saved.then(
      // Cleared inside the same transition as the refresh, so the overlay
      // stays up until the list with the new lead in it is on screen.
      () =>
        startTransition(() => {
          setAdding(false)
          router.refresh()
        }),
      // The store has already said it could not be saved.
      () => setAdding(false),
    )
  }

  function handleDeleted() {
    setSelectedIds(new Set())
    // The page is a server read: a row has gone, the count has moved, and this
    // page may now be past the end. Re-reading settles all three, and
    // getLeadsPage clamps the page if it has to.
    startTransition(() => router.refresh())
  }

  const active = hasActiveFilters(filters)

  // Server order, store values. The store wins on a field somebody has just
  // edited; the server decides which rows are here and in what order. A lead
  // whose stage has just changed to another screen's leaves this one.
  const current = useMemo(() => leads.map((lead) => getLead(lead.id) ?? lead), [leads, getLead])
  const rows = useMemo(
    () => (screen ? current.filter((lead) => screen.stages.includes(lead.stage)) : current),
    [current, screen],
  )
  // Re-read once per lead that left, so the counts are right and the page
  // fills up again — once, not on every render while the re-read is on its way.
  const movedAway = current.filter((lead) => !rows.includes(lead)).map((lead) => lead.id).join(',')
  const refreshedFor = useRef('')
  useEffect(() => {
    if (!movedAway || refreshedFor.current === movedAway) return
    refreshedFor.current = movedAway
    startTransition(() => router.refresh())
  }, [movedAway, router])

  const selectedLeads = useMemo(
    () => rows.filter((lead) => selectedIds.has(lead.id)),
    [rows, selectedIds],
  )

  // Not max-w-6xl like the record page: this table has ten columns and a
  // min-content width near 1400px, so a 1152px cap guaranteed a horizontal
  // scrollbar while leaving half a 1920 monitor empty. Capped far wider
  // instead — 120rem stops rows stretching to absurd lengths on an ultrawide,
  // and below that the table simply gets the window.
  return (
    <div className="mx-auto w-full max-w-[120rem] px-4 py-6 lg:px-6">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Leads</h1>
          <p className="mt-1 text-sm text-foreground/50">
            <span className="tabular-nums">{total}</span>{' '}
            {total === 1 ? 'lead' : 'leads'}
            {active && ' match these filters'}
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

      {/* One tab per group of stages, each with its count. The tab is in the
          URL (?tab=), so it can be bookmarked; the other filters carry over. */}
      {counts && (
        <nav aria-label="Lead stages" className="-mt-2 mb-4 flex flex-wrap gap-1 border-b border-border">
          {ALL_VIEWS.map((tab) => {
            const selected = tab === (view ?? 'leads')
            return (
              <Link
                key={tab}
                href={leadsHref({ ...filters, view: tab }, 1)}
                aria-current={selected ? 'page' : undefined}
                className={cn(
                  '-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors',
                  selected
                    ? 'border-accent font-medium text-foreground'
                    : 'border-transparent text-foreground/60 hover:text-foreground',
                )}
              >
                {LEAD_VIEWS[tab].label}
                <span
                  className={cn(
                    'rounded-full px-1.5 text-xs tabular-nums',
                    selected ? 'bg-accent/15 text-accent' : 'bg-surface text-foreground/50',
                  )}
                >
                  {counts[tab]}
                </span>
              </Link>
            )
          })}
        </nav>
      )}

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
            placeholder="Search name, email, phone or debt"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            className="h-9 w-full rounded-lg border border-border bg-input-bg pl-9 pr-3 text-sm text-foreground transition-colors placeholder:text-muted focus:border-accent focus:outline-none"
          />
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <LeadFilters filters={filters} onChange={navigate} onReset={resetFilters} sources={sources} />
          <div className="flex shrink-0 items-center gap-3">
            {pageCount > 1 && (
              <p className="text-xs tabular-nums text-foreground/50">
                {pageRangeLabel(page, pageSize, total)}
              </p>
            )}
            {/* A new size starts again at page 1: page 7 of tens is not page 7 of hundreds. */}
            <label className="flex items-center gap-2 text-xs text-foreground/50">
              Per page
              <Select
                aria-label="Leads per page"
                selectSize="sm"
                wrapperClassName="w-[76px]"
                options={PER_PAGE_SELECT}
                value={String(filters.perPage)}
                onChange={(event) => {
                  const value = event.target.value
                  navigate({ perPage: (value === 'all' ? 'all' : Number(value)) as PerPage })
                }}
              />
            </label>
          </div>
        </div>
      </div>

      {/* Bulk actions appear only with a selection, so the toolbar does not
          carry a permanently disabled Delete button inviting a click. */}
      {selectedLeads.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-accent/30 bg-accent/10 px-3 py-2">
          <p className="text-sm text-foreground">
            <span className="tabular-nums font-medium">{selectedLeads.length}</span>{' '}
            {selectedLeads.length === 1 ? 'lead' : 'leads'} selected
          </p>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setSelectedIds(new Set())}
            >
              <X className="h-4 w-4" />
              Clear
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={() => setDeleteTarget(selectedLeads)}
            >
              <Trash2 className="h-4 w-4" />
              Delete {selectedLeads.length}
            </Button>
          </div>
        </div>
      )}

      {/* Dimmed while the next page is in flight, so a slow query looks like
          waiting rather than like nothing happening. A hand-added lead also
          gets a spinner: the dialog has closed, but the row only appears once
          the save has landed and the list has been read again. */}
      <div className="relative">
        {adding && <LoadingOverlay label="Adding lead…" />}
        <div className={pending || adding ? 'opacity-60 transition-opacity' : undefined}>
          <LeadTable
            leads={rows}
            filtered={active}
            onResetFilters={resetFilters}
            onRequestConvert={setConvertTarget}
            selectedIds={selectedIds}
            onToggleLead={toggleLead}
            onToggleAll={toggleAll}
            onRequestDelete={setDeleteTarget}
            notes={notes}
          />

          <Pagination
            page={page}
            pageCount={pageCount}
            hrefFor={(target) => leadsHref(filters, target)}
            label={pageRangeLabel(page, pageSize, total)}
          />
        </div>
      </div>

      <AddLeadDialog open={addOpen} onClose={() => setAddOpen(false)} onAdded={handleAdded} />
      <ConvertToClientDialog lead={convertTarget} onClose={() => setConvertTarget(null)} />
      <DeleteLeadsDialog
        leads={deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onDeleted={handleDeleted}
      />
    </div>
  )
}
