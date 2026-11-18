import { CheckCircle2, Clock, Info, MinusCircle } from 'lucide-react'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import type { DocumentProofRow, DocumentProofStatus } from '@/lib/clients/documentProofs'

const ICON: Record<DocumentProofStatus, { Icon: typeof CheckCircle2; className: string; label: string }> = {
  proven: { Icon: CheckCircle2, className: 'text-success', label: 'Proven' },
  as_printed: { Icon: Info, className: 'text-warning', label: 'As printed' },
  being_prepared: { Icon: Clock, className: 'text-foreground/50', label: 'Being prepared' },
  not_used: { Icon: MinusCircle, className: 'text-foreground/40', label: 'Not used' },
}

/**
 * "Documents" on the client page: each ATO file, notice and statement with what was proven
 * ("Matches the ATO's own balance: …", "Notice adds up · Matches the ATO account",
 * "Every total on the statements adds up"), or "Being prepared".
 */
export function DocumentProofList({ rows }: { rows: DocumentProofRow[] }) {
  if (rows.length === 0) return null
  return (
    <section className="mb-6" data-testid="document-proofs">
      <Card>
        <CardHeader>
          <CardTitle>Documents</CardTitle>
        </CardHeader>
        <ul className="divide-y divide-border">
          {rows.map((row) => {
            const { Icon, className, label } = ICON[row.status]
            return (
              <li key={row.documentId} className="flex items-start gap-2.5 py-2 text-sm" data-status={row.status}>
                <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${className}`} aria-label={label} />
                <div className="min-w-0">
                  <p className="truncate text-foreground" title={row.filename}>
                    {row.filename} <span className="text-xs text-foreground/50">· {row.kindLabel}</span>
                  </p>
                  <p className={`text-xs ${row.status === 'proven' ? 'text-success' : 'text-foreground/70'}`}>{row.text}</p>
                </div>
              </li>
            )
          })}
        </ul>
      </Card>
    </section>
  )
}
