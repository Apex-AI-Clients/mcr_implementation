'use client'

import { useState, useCallback } from 'react'
import { useDropzone } from 'react-dropzone'
import { Upload, CheckCircle, FileText, ExternalLink, AlertCircle, Trash2, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { CATEGORY_META, getCurrentFinancialPeriod, getHistoricalFinancialPeriod } from '@/lib/constants'
import type { DocCategory } from '@/lib/constants'
import type { DocumentRecord } from '@/types/app'
import { cn } from '@/lib/utils'
import { formatBytes } from '@/lib/utils'
import { Badge } from '@/components/ui/Badge'

interface CategoryUploadSectionProps {
  category: DocCategory
  documents: DocumentRecord[]
  onUploadComplete: () => void
  /** When true, hide the category label (useful when the parent already renders it as a heading). */
  hideTitle?: boolean
}

export function CategoryUploadSection({
  category,
  documents,
  onUploadComplete,
  hideTitle = false,
}: CategoryUploadSectionProps) {
  const meta = CATEGORY_META[category]
  const [uploading, setUploading] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<DocumentRecord | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [uploadedCount, setUploadedCount] = useState(0)
  const [totalFiles, setTotalFiles] = useState(0)

  const categoryDocs = documents.filter((d) => d.docCategory === category)
  const hasFiles = categoryDocs.length > 0

  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      if (acceptedFiles.length === 0) return
      setError(null)
      setUploading(true)
      setUploadedCount(0)
      setTotalFiles(acceptedFiles.length)

      for (const file of acceptedFiles) {
        try {
          const formData = new FormData()
          formData.append('file', file)
          formData.append('doc_category', category)

          const res = await fetch('/api/portal/upload', {
            method: 'POST',
            body: formData,
          })

          if (!res.ok) {
            const data = await res.json()
            setError(data.error ?? 'Upload failed')
            break
          }

          setUploadedCount((c) => c + 1)
        } catch {
          setError('Upload failed. Please try again.')
          break
        }
      }

      setUploading(false)
      onUploadComplete()
    },
    [category, onUploadComplete],
  )

  async function handleDelete(documentId: string) {
    setDeleting(documentId)
    setError(null)
    try {
      const res = await fetch('/api/portal/delete-document', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentId }),
      })
      if (!res.ok) {
        const data = await res.json()
        setError(data.error ?? 'Failed to delete')
      } else {
        onUploadComplete()
      }
    } catch {
      setError('Failed to delete. Please try again.')
    } finally {
      setDeleting(null)
    }
  }

  const { getRootProps, getInputProps, isDragActive, fileRejections } = useDropzone({
    onDrop,
    accept: Object.fromEntries(meta.acceptedFormats.map((mime) => [mime, []])),
    maxSize: 50 * 1024 * 1024,
    multiple: meta.multipleFiles,
    disabled: uploading,
  })

  return (
    <div
      className={cn(
        'rounded-xl border bg-surface/30 p-5 transition-all',
        hasFiles ? 'border-success/30' : 'border-white/8',
      )}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            {!hideTitle && (
              <h3 className="text-sm font-semibold text-foreground">{meta.label}</h3>
            )}
            {meta.isOptional && (
              <Badge variant="muted">If applicable</Badge>
            )}
            {hasFiles && (
              <Badge variant="success">
                <CheckCircle className="h-3 w-3 mr-1" />
                {categoryDocs.length} uploaded
              </Badge>
            )}
          </div>
          <div className={cn('mt-2 rounded-lg border border-accent/20 bg-accent/5 px-4 py-3')}>
            <p className="text-sm font-semibold text-foreground leading-relaxed">
              <StyledDescription text={meta.description} />
            </p>
            {category === 'current_financials' && (
              <p className="mt-3 text-base font-bold text-destructive">
                {getCurrentFinancialPeriod()}
              </p>
            )}
            {category === 'historical_financials' && (
              <p className="mt-3 text-base font-bold text-destructive">
                {getHistoricalFinancialPeriod()}
              </p>
            )}
          </div>
          {meta.externalLink && (
            <a
              href={meta.externalLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 mt-1.5 text-xs text-accent hover:text-accent/80 transition-colors"
            >
              Open ATO Portal <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
        <span className="shrink-0 text-xs text-foreground/40 bg-primary/50 px-2 py-1 rounded-md">
          {meta.formatLabel}
        </span>
      </div>

      {/* Uploaded files */}
      {categoryDocs.length > 0 && (
        <div className="mb-3 space-y-1.5">
          {categoryDocs.map((doc) => (
            <div
              key={doc.id}
              className="flex items-center gap-2.5 rounded-lg bg-primary/40 px-3 py-2"
            >
              <FileText className="h-4 w-4 text-foreground/40 shrink-0" />
              <span className="text-xs text-foreground/70 truncate flex-1">
                {doc.originalFilename}
              </span>
              <span className="text-xs text-foreground/30 shrink-0">
                {formatBytes(doc.fileSizeBytes)}
              </span>
              {deleting === doc.id ? (
                <Loader2 className="h-3.5 w-3.5 text-accent animate-spin shrink-0" />
              ) : doc.status === 'ready' ? (
                <CheckCircle className="h-3.5 w-3.5 text-success shrink-0" />
              ) : null}
              <button
                type="button"
                onClick={() => setConfirmDelete(doc)}
                disabled={deleting === doc.id}
                className="text-foreground/30 hover:text-destructive transition-colors disabled:opacity-50 shrink-0"
                title="Delete file"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Drop zone */}
      <div
        {...getRootProps()}
        className={cn(
          'rounded-lg border-2 border-dashed px-4 py-5 text-center cursor-pointer transition-all',
          isDragActive
            ? 'border-accent bg-accent/5 scale-[1.01]'
            : 'border-white/10 hover:border-white/20 hover:bg-primary/30',
          uploading && 'opacity-50 cursor-not-allowed',
        )}
      >
        <input {...getInputProps()} />
        {uploading ? (
          <div className="flex flex-col items-center gap-2 py-1">
            <Loader2 className="h-6 w-6 text-accent animate-spin" />
            <p className="text-xs text-foreground/50">
              Uploading {uploadedCount} of {totalFiles} file{totalFiles > 1 ? 's' : ''}...
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-1.5">
            <Upload className="h-5 w-5 text-foreground/30" />
            <p className="text-xs text-foreground/50">
              Drop {meta.formatLabel} files here or <span className="text-accent">browse</span>
            </p>
          </div>
        )}
      </div>

      {/* Errors */}
      {(error || fileRejections.length > 0) && (
        <div className="mt-2 flex items-center gap-1.5 text-xs text-destructive">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          {error || `Only ${meta.formatLabel} files are accepted.`}
        </div>
      )}

      {/* Delete confirmation popup */}
      {confirmDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setConfirmDelete(null)}
        >
          <div
            className="bg-card border border-border rounded-xl p-6 w-full max-w-sm shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold text-foreground mb-2">Delete File</h3>
            <p className="text-xs text-muted mb-1">Are you sure you want to delete this file?</p>
            <p className="text-xs text-foreground font-medium mb-4 truncate">
              {confirmDelete.originalFilename}
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="flex-1"
                onClick={() => setConfirmDelete(null)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                className="flex-1"
                loading={deleting === confirmDelete.id}
                onClick={async () => {
                  await handleDelete(confirmDelete.id)
                  setConfirmDelete(null)
                }}
              >
                Delete
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/** Renders description text with "Profit and Loss" and "Balance Sheet" in bold red */
function StyledDescription({ text }: { text: string }) {
  const highlights = ['Profit and Loss', 'Profit & Loss', 'Balance Sheet']
  const regex = new RegExp(`(${highlights.join('|')})`, 'gi')
  const parts = text.split(regex)

  return (
    <>
      {parts.map((part, i) =>
        highlights.some((h) => h.toLowerCase() === part.toLowerCase()) ? (
          <span key={i} className="font-bold text-destructive">
            {part}
          </span>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  )
}
