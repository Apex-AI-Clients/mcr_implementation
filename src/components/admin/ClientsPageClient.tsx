'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ClientTable } from '@/components/admin/ClientTable'
import { Button } from '@/components/ui/Button'
import { Search, ChevronLeft, ChevronRight } from 'lucide-react'
import type { ClientSummary } from '@/types/app'

interface ClientsPageClientProps {
  clients: ClientSummary[]
  total: number
  page: number
  pageSize: number
  query: string
}

export function ClientsPageClient({ clients, total, page, pageSize, query }: ClientsPageClientProps) {
  const router = useRouter()
  const [term, setTerm] = useState(query)
  const [prevQuery, setPrevQuery] = useState(query)

  // Sync the input when the URL query changes externally (e.g. back/forward nav).
  // React-sanctioned "adjust state during render" — no effect, keeps focus.
  if (query !== prevQuery) {
    setPrevQuery(query)
    setTerm(query)
  }

  // Debounced server-side search: push ?q= once the input differs from the URL.
  useEffect(() => {
    if (term.trim() === query.trim()) return
    const t = setTimeout(() => {
      const params = new URLSearchParams()
      if (term.trim()) params.set('q', term.trim())
      router.replace(`/admin/clients${params.toString() ? `?${params.toString()}` : ''}`)
    }, 300)
    return () => clearTimeout(t)
  }, [term, query, router])

  function goToPage(p: number) {
    const params = new URLSearchParams()
    if (query.trim()) params.set('q', query.trim())
    if (p > 1) params.set('page', String(p))
    router.replace(`/admin/clients${params.toString() ? `?${params.toString()}` : ''}`)
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1
  const to = Math.min(page * pageSize, total)

  return (
    <div>
      <div className="mb-4 relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted" />
        <input
          type="text"
          placeholder="Search clients by name or email..."
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          className="w-full h-10 rounded-lg border border-border bg-input-bg pl-10 pr-4 text-sm text-foreground placeholder:text-muted focus:border-accent focus:outline-none transition-colors"
        />
      </div>

      <ClientTable clients={clients} />

      {total > 0 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-foreground/50">
            Showing {from}–{to} of {total}
          </p>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => goToPage(page - 1)}
              disabled={page <= 1}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Previous
            </Button>
            <span className="text-xs text-foreground/50 tabular-nums">
              Page {page} of {totalPages}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => goToPage(page + 1)}
              disabled={page >= totalPages}
            >
              Next
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
