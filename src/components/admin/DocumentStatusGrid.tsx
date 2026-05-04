'use client'

import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { CHECKLIST_ORDER, CATEGORY_META } from '@/lib/constants'
import type { DocumentRecord } from '@/types/app'
import { CheckCircle2, XCircle, Download, Trash2, X } from 'lucide-react'
import { ReuploadRequestButton } from '@/components/admin/ReuploadRequestButton'
import { formatBytes } from '@/lib/utils'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface DocumentStatusGridProps {
  documents: DocumentRecord[]
  clientId?: string
  onDocumentDeleted?: () => void
}

export function DocumentStatusGrid({ documents, clientId, onDocumentDeleted }: DocumentStatusGridProps) {
  const router = useRouter()
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
              <DocumentRow key={doc.id} doc={doc} clientId={clientId} onDeleted={onDocumentDeleted ?? (() => router.refresh())} />
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

function DocumentRow({ doc, clientId, onDeleted }: { doc: DocumentRecord; clientId?: string; onDeleted?: () => void }) {
  const [downloading, setDownloading] = useState(false)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [deleteMessage, setDeleteMessage] = useState('')
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
        body: JSON.stringify({ message: deleteMessage.trim() || undefined }),
      })
      if (!res.ok) {
        const data = await res.json()
        setDeleteError(data.error ?? 'Failed to delete')
        setDeleting(false)
        return
      }
      setShowDeleteModal(false)
      setDeleting(false)
      onDeleted?.()
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
            {clientId && (
              <ReuploadRequestButton
                clientId={clientId}
                documentId={doc.id}
                documentName={doc.originalFilename}
              />
            )}
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
              This will permanently delete the file. The client will need to re-upload if required.
            </p>

            <div className="space-y-3">
              <div className="flex flex-col gap-1.5">
                <label htmlFor={`delete-msg-${doc.id}`} className="text-xs font-medium text-muted">
                  Message to client (optional)
                </label>
                <textarea
                  id={`delete-msg-${doc.id}`}
                  className="h-20 w-full rounded-lg border border-border bg-input-bg px-3 py-2 text-sm text-foreground placeholder:text-muted transition-colors focus:border-accent focus:outline-none resize-none"
                  placeholder="e.g. Please re-upload the correct version of this document."
                  value={deleteMessage}
                  onChange={(e) => setDeleteMessage(e.target.value)}
                />
                <p className="text-xs text-foreground/30">
                  If provided, the client will receive an email with your message.
                </p>
              </div>

              {deleteError && <p className="text-xs text-destructive">{deleteError}</p>}

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
                  Delete{deleteMessage.trim() ? ' & Notify' : ''}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
