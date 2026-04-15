import { Badge } from '@/components/ui/Badge'
import { CATEGORY_META } from '@/lib/constants'
import type { DocCategory } from '@/lib/constants'
import { formatBytes } from '@/lib/utils'
import { CheckCircle2, FileText } from 'lucide-react'
import type { DocumentRecord } from '@/types/app'

interface UploadedFileRowProps {
  doc: DocumentRecord
}

export function UploadedFileRow({ doc }: UploadedFileRowProps) {
  const isReady = doc.status === 'ready'
  const meta = CATEGORY_META[doc.docCategory as DocCategory]

  return (
    <div className="flex items-center gap-3 rounded-lg border border-white/8 bg-surface px-3 py-2.5">
      {isReady ? (
        <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
      ) : (
        <FileText className="h-4 w-4 shrink-0 text-foreground/40" />
      )}

      <div className="flex-1 min-w-0">
        <p className="text-sm text-foreground truncate">{doc.originalFilename}</p>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-xs text-foreground/40">{formatBytes(doc.fileSizeBytes)}</span>
          {meta && (
            <span className="text-xs text-foreground/60">{meta.label}</span>
          )}
        </div>
      </div>

      {isReady && <Badge variant="success">Ready</Badge>}
    </div>
  )
}
