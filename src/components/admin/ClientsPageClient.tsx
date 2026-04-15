'use client'

import { useState } from 'react'
import { ClientTable } from '@/components/admin/ClientTable'
import { Search } from 'lucide-react'
import type { ClientSummary } from '@/types/app'

interface ClientsPageClientProps {
  clients: ClientSummary[]
}

export function ClientsPageClient({ clients }: ClientsPageClientProps) {
  const [search, setSearch] = useState('')

  const filtered = search
    ? clients.filter(
        (c) =>
          c.name.toLowerCase().includes(search.toLowerCase()) ||
          c.email.toLowerCase().includes(search.toLowerCase()),
      )
    : clients

  return (
    <div>
      <div className="mb-4 relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted" />
        <input
          type="text"
          placeholder="Search clients by name or email..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full h-10 rounded-lg border border-border bg-input-bg pl-10 pr-4 text-sm text-foreground placeholder:text-muted focus:border-accent focus:outline-none transition-colors"
        />
      </div>
      <ClientTable clients={filtered} />
    </div>
  )
}
