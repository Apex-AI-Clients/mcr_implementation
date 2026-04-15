import { Badge } from '@/components/ui/Badge'
import { CHECKLIST_ORDER, CATEGORY_META } from '@/lib/constants'
import type { DocCategory } from '@/lib/constants'
import type { DocumentRecord } from '@/types/app'
import { CheckCircle2 } from 'lucide-react'

interface DocumentChecklistProps {
  documents: DocumentRecord[]
}

export function DocumentChecklist({ documents }: DocumentChecklistProps) {
  const byCategory = new Map<string, DocumentRecord[]>()
  for (const doc of documents) {
    const existing = byCategory.get(doc.docCategory) ?? []
    byCategory.set(doc.docCategory, [...existing, doc])
  }

  const received = CHECKLIST_ORDER.filter((c) => (byCategory.get(c)?.length ?? 0) > 0).length

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground/80">Required Documents</h2>
        <span className="text-xs text-foreground/40">
          {received} of {CHECKLIST_ORDER.length} received
        </span>
      </div>

      <div className="flex flex-col gap-2">
        {CHECKLIST_ORDER.map((category: DocCategory) => {
          const docs = byCategory.get(category) ?? []
          const meta = CATEGORY_META[category]
          const hasFiles = docs.length > 0

          return (
            <div
              key={category}
              className={`flex items-center gap-3 rounded-xl border px-4 py-3 transition-all ${
                hasFiles ? 'border-success/30 bg-success/5' : 'border-white/8 bg-surface/50'
              }`}
            >
              {hasFiles ? (
                <CheckCircle2 className="h-5 w-5 shrink-0 text-success" />
              ) : (
                <div className="h-5 w-5 shrink-0 rounded-full border-2 border-foreground/20" />
              )}

              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground leading-tight">{meta.label}</p>
                <p className="text-xs text-foreground/40 mt-0.5">
                  {meta.formatLabel}
                  {meta.isOptional && ' · If applicable'}
                </p>
              </div>

              {hasFiles && (
                <Badge variant="success">
                  {docs.length === 1 ? 'Received' : `${docs.length} files`}
                </Badge>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
