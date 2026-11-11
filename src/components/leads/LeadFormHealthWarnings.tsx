import { AlertTriangle } from 'lucide-react'

interface LeadFormHealthWarningsProps {
  /** Sentences from getFacebookFormHealth. Form ids and question names only. */
  warnings: string[]
}

/**
 * A Facebook form sending something the CRM cannot read — see
 * lib/leads/formHealth. Shown on the record of each lead that came through
 * an affected form. Renders nothing when all is well.
 */
export function LeadFormHealthWarnings({ warnings }: LeadFormHealthWarningsProps) {
  if (warnings.length === 0) return null
  return (
    <div
      role="status"
      aria-label="Facebook form warnings"
      className="mb-4 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning"
    >
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <ul className="space-y-1 break-words">
        {warnings.map((warning) => (
          <li key={warning}>{warning}</li>
        ))}
      </ul>
    </div>
  )
}
