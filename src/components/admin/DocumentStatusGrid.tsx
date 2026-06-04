'use client'

import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { CHECKLIST_ORDER, CATEGORY_META } from '@/lib/constants'
import type { DocCategory } from '@/lib/constants'
import type { DocumentRecord } from '@/types/app'
import { CheckCircle2, XCircle, Download, Trash2, X, Upload, Loader2 } from 'lucide-react'
import { CompareFinancialsButton } from '@/components/admin/CompareFinancialsButton'
import { LodgementAnalysisButton } from '@/components/admin/LodgementAnalysisButton'
import { formatBytes } from '@/lib/utils'
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

interface DocumentStatusGridProps {
  documents: DocumentRecord[]
  clientId?: string
  onDocumentDeleted?: () => void
}

export function DocumentStatusGrid({ documents, clientId, onDocumentDeleted }: DocumentStatusGridProps) {
  const router = useRouter()
  const refresh = onDocumentDeleted ?? (() => router.refresh())
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
              <DocumentRow key={doc.id} doc={doc} onDeleted={refresh} />
            ))}

            {!received && (
              <p className="mt-2 ml-6.5 text-xs text-foreground/30 italic">Not yet uploaded</p>
            )}

            {clientId && (
              <CategoryUploader
                clientId={clientId}
                category={category}
                hasFiles={received}
                onUploaded={refresh}
              />
            )}

            {/* 2-file minimum: comparison view requires at least two years of statements. */}
            {category === 'historical_financials' && clientId && (
              <CompareFinancialsButton clientId={clientId} documentCount={docs.length} />
            )}

            {category === 'integrated_client_account' && clientId && (
              <LodgementAnalysisButton clientId={clientId} />
            )}
          </div>
        )
      })}
    </div>
  )
}

function DocumentRow({ doc, onDeleted }: { doc: DocumentRecord; onDeleted: () => void }) {
  const [downloading, setDownloading] = useState(false)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')

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

  async function handleDelete() {
    setDeleting(true)
    setDeleteError('')
    try {
      const res = await fetch(`/api/admin/documents/${doc.id}/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (!res.ok) {
        const data = await res.json()
        setDeleteError(data.error ?? 'Failed to delete')
        setDeleting(false)
        return
      }
      setShowDeleteModal(false)
      setDeleting(false)
      onDeleted()
    } catch {
      setDeleteError('Failed to delete. Please try again.')
      setDeleting(false)
    }
  }

  return (
    <>
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
            <button
              type="button"
              onClick={() => setShowDeleteModal(true)}
              className="text-foreground/30 hover:text-destructive transition-colors"
              title="Delete document"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        {doc.status === 'ready' && (
          <span className="text-xs text-success mt-1 block">Ready</span>
        )}
      </div>

      {showDeleteModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setShowDeleteModal(false)}
        >
          <div
            className="bg-card border border-border rounded-xl p-6 w-full max-w-md shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-foreground">Delete Document</h3>
              <button type="button" onClick={() => setShowDeleteModal(false)} className="text-muted hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>

            <p className="text-xs text-muted mb-2">
              File: <span className="text-foreground">{doc.originalFilename}</span>
            </p>
            <p className="text-xs text-destructive/80 mb-4">
              This permanently deletes the file. You can upload a replacement in this section
              afterwards.
            </p>

            {deleteError && <p className="text-xs text-destructive mb-3">{deleteError}</p>}

            <div className="flex gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="flex-1"
                onClick={() => setShowDeleteModal(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                className="flex-1"
                loading={deleting}
                onClick={handleDelete}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

/**
 * Inline uploader for a single document category on the client detail page.
 * Staff can add or replace files without leaving the detail view. Posts to the
 * staff-authenticated /api/portal/upload with the client id + category.
 */
function CategoryUploader({
  clientId,
  category,
  hasFiles,
  onUploaded,
}: {
  clientId: string
  category: DocCategory
  hasFiles: boolean
  onUploaded: () => void
}) {
  const meta = CATEGORY_META[category]
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    setError(null)
    setUploading(true)
    try {
      for (const file of Array.from(files)) {
        const formData = new FormData()
        formData.append('file', file)
        formData.append('doc_category', category)
        formData.append('client_id', clientId)
        const res = await fetch('/api/portal/upload', { method: 'POST', body: formData })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          setError(data.error ?? 'Upload failed')
          break
        }
      }
      onUploaded()
    } catch {
      setError('Upload failed. Please try again.')
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div className="mt-2 ml-6.5">
      <input
        ref={inputRef}
        type="file"
        accept={meta.acceptedFormats.join(',')}
        multiple={meta.multipleFiles}
        onChange={(e) => handleFiles(e.target.files)}
        className="hidden"
      />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        loading={uploading}
        onClick={() => inputRef.current?.click()}
      >
        {uploading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Upload className="h-3.5 w-3.5" />
        )}
        {hasFiles ? 'Upload / replace' : 'Upload file'}
      </Button>
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  )
}
