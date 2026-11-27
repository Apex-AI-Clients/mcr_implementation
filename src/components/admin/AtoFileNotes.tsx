import { Info } from 'lucide-react'
import type { DocumentRecord } from '@/types/app'

/**
 * Under an ATO account CSV in a file list: which account it is, and why it is
 * in this slot (moved there, or its type not recognised yet). Nothing for any
 * other file. No warning when the entity on it is not the client's name
 * (removed 25 Nov 2026 at the user's request).
 */
export function AtoFileNotes({ doc }: { doc: DocumentRecord }) {
  if (!doc.atoAccountLabel && !doc.categoryNote) return null
  return (
    <div className="mt-1 space-y-0.5 text-xs">
      {doc.atoAccountLabel && <p className="text-foreground/50">{doc.atoAccountLabel}</p>}
      {doc.categoryNote && (
        <p className="flex items-start gap-1 text-foreground/60">
          <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
          {doc.categoryNote}
        </p>
      )}
    </div>
  )
}
