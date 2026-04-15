import { Progress } from '@/components/ui/Progress'
import { CHECKLIST_ORDER, REQUIRED_CATEGORIES } from '@/lib/constants'
import type { DocumentRecord } from '@/types/app'

interface CompletenessBarProps {
  documents: DocumentRecord[]
}

export function CompletenessBar({ documents }: CompletenessBarProps) {
  const receivedCategories = new Set(
    documents.filter((d) => d.status !== 'rejected').map((d) => d.docCategory),
  )

  const requiredReceived = REQUIRED_CATEGORIES.filter((c) => receivedCategories.has(c)).length
  const totalReceived = CHECKLIST_ORDER.filter((c) => receivedCategories.has(c)).length
  const pctRequired = Math.round((requiredReceived / REQUIRED_CATEGORIES.length) * 100)

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between text-xs">
        <span className="text-foreground/50">Required documents</span>
        <span className="font-semibold text-foreground">
          {requiredReceived}/{REQUIRED_CATEGORIES.length} required
        </span>
      </div>
      <Progress value={pctRequired} showLabel />
      <p className="text-xs text-foreground/40">
        {totalReceived}/{CHECKLIST_ORDER.length} total categories submitted
      </p>
    </div>
  )
}
