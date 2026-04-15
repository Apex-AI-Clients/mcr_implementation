// Deprecated: This component is replaced by CategoryUploadSection.
// Kept for backwards compatibility.

'use client'

import { useCallback, useState } from 'react'
import { useDropzone } from 'react-dropzone'
import { Upload, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ALL_ACCEPTED_MIME_TYPES, MAX_FILE_SIZE_BYTES } from '@/lib/constants'
import { formatBytes } from '@/lib/utils'
import { Spinner } from '@/components/ui/Spinner'

interface DropZoneProps {
  clientToken: string
  onUploadComplete: (documentId: string) => void
}

interface UploadState {
  filename: string
  error: string | null
}

export function DropZone({ clientToken, onUploadComplete }: DropZoneProps) {
  const [uploads, setUploads] = useState<UploadState[]>([])

  const uploadFile = useCallback(
    async (file: File) => {
      const state: UploadState = { filename: file.name, error: null }
      setUploads((prev) => [...prev, state])

      const formData = new FormData()
      formData.append('file', file)
      formData.append('doc_category', 'current_financials') // Default category

      try {
        const res = await fetch('/api/portal/upload', {
          method: 'POST',
          headers: { 'x-client-token': clientToken },
          body: formData,
        })

        if (!res.ok) {
          const data = await res.json()
          throw new Error(data.error || 'Upload failed')
        }

        const data = await res.json()
        setUploads((prev) => prev.filter((u) => u.filename !== file.name))
        onUploadComplete(data.documentId)
      } catch (err) {
        setUploads((prev) =>
          prev.map((u) =>
            u.filename === file.name
              ? { ...u, error: err instanceof Error ? err.message : 'Upload failed' }
              : u,
          ),
        )
      }
    },
    [clientToken, onUploadComplete],
  )

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      acceptedFiles.forEach((file) => uploadFile(file))
    },
    [uploadFile],
  )

  const { getRootProps, getInputProps, isDragActive, fileRejections } = useDropzone({
    onDrop,
    accept: Object.fromEntries(ALL_ACCEPTED_MIME_TYPES.map((m: string) => [m, []])),
    maxSize: MAX_FILE_SIZE_BYTES,
    multiple: true,
  })

  return (
    <div className="flex flex-col gap-3">
      <div
        {...getRootProps()}
        className={cn(
          'relative flex flex-col items-center justify-center rounded-2xl border-2 border-dashed p-10 text-center transition-all cursor-pointer select-none',
          isDragActive
            ? 'border-accent bg-accent/10 scale-[1.01]'
            : 'border-white/15 bg-surface/40 hover:border-accent/50 hover:bg-surface/60',
        )}
      >
        <input {...getInputProps()} />
        <Upload className="h-6 w-6 text-accent mb-3" />
        <p className="text-sm font-semibold text-foreground">
          {isDragActive ? 'Drop your files here' : 'Drag & drop your documents'}
        </p>
        <p className="mt-1 text-xs text-foreground/40">
          PDF, DOCX, CSV · Max {formatBytes(MAX_FILE_SIZE_BYTES)}
        </p>
      </div>

      {fileRejections.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5">
          <AlertCircle className="h-4 w-4 shrink-0 text-destructive mt-0.5" />
          <div className="text-xs text-destructive">
            {fileRejections.map(({ file, errors }) => (
              <p key={file.name}>
                <strong>{file.name}</strong>: {errors.map((e) => e.message).join(', ')}
              </p>
            ))}
          </div>
        </div>
      )}

      {uploads.length > 0 && (
        <div className="flex flex-col gap-2">
          {uploads.map((upload) => (
            <div
              key={upload.filename}
              className="flex items-center gap-3 rounded-lg border border-white/8 bg-surface px-3 py-2.5"
            >
              {upload.error ? (
                <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
              ) : (
                <Spinner size="sm" />
              )}
              <p className="text-xs text-foreground truncate flex-1">{upload.filename}</p>
              {upload.error && <p className="text-xs text-destructive">{upload.error}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
