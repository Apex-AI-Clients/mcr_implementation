'use client'

import { Badge } from '@/components/ui/Badge'
import { CHECKLIST_ORDER, CATEGORY_META } from '@/lib/constants'
import type { DocumentRecord } from '@/types/app'
import { CheckCircle2, XCircle, Download } from 'lucide-react'
import { formatBytes } from '@/lib/utils'
import { useState } from 'react'

interface DocumentStatusGridProps {
  documents: DocumentRecord[]
}

export function DocumentStatusGrid({ documents }: DocumentStatusGridProps) {
  const byCategory = new Map<string, DocumentRecord[]>()
  for (const doc of documents) {
    const existing = byCategory.get(doc.docCategory) ?? []
    byCategory.set(doc.docCategory, [...existing, doc])
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {CHECKLIST_ORDER.map((category) => {
        const docs = byCategory.get(category) ?? []
        const meta = CATEGORY_META[category]
        const received = docs.length > 0

        return (
          <div
            key={category}
            className={`rounded-xl border p-4 transition-colors ${
              received ? 'border-success/30 bg-success/5' : 'border-white/8 bg-surface'
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2.5 min-w-0">
                {received ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
                ) : (
                  <XCircle className="h-4 w-4 shrink-0 text-foreground/25" />
                )}
                <span className="text-sm font-medium text-foreground/90 leading-tight">
                  {meta.label}
                </span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {meta.isOptional && <Badge variant="muted">Optional</Badge>}
                {received && (
                  <Badge variant="success">
                    {docs.length === 1 ? 'Received' : `${docs.length} files`}
                  </Badge>
                )}
              </div>
            </div>

            <p className="mt-1.5 ml-6.5 text-xs text-foreground/40">{meta.formatLabel}</p>

            {docs.map((doc) => (
              <DocumentRow key={doc.id} doc={doc} />
            ))}

            {!received && (
              <p className="mt-2 ml-6.5 text-xs text-foreground/30 italic">Not yet uploaded</p>
            )}
          </div>
        )
      })}
    </div>
  )
}

function DocumentRow({ doc }: { doc: DocumentRecord }) {
  const [downloading, setDownloading] = useState(false)

  async function handleDownload() {
    setDownloading(true)
    try {
      const res = await fetch(`/api/admin/documents/${doc.id}/download`)
      if (res.ok) {
        const { url } = await res.json()
        window.open(url, '_blank')
      }
    } catch {
      // Silently fail
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="mt-2 ml-6.5 rounded-lg bg-primary/40 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-foreground/70 truncate">{doc.originalFilename}</span>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-foreground/40">{formatBytes(doc.fileSizeBytes)}</span>
          <button
            onClick={handleDownload}
            disabled={downloading}
            className="text-accent hover:text-accent/80 transition-colors disabled:opacity-50"
            title="Download"
          >
            <Download className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      {doc.status === 'ready' && (
        <span className="text-xs text-success mt-1 block">Ready</span>
      )}
    </div>
  )
}
