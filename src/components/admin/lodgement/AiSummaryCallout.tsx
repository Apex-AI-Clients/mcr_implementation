'use client'

import { Sparkles } from 'lucide-react'
import { formatDateRelative } from '@/lib/utils'

interface Props {
  summary: string | null
  generatedAt: string | null
}

export function AiSummaryCallout({ summary, generatedAt }: Props) {
  if (!summary) return null

  return (
    <div className="rounded-lg bg-accent/5 border border-accent/20 p-4 space-y-2">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-accent flex-shrink-0" />
        <p className="text-sm text-foreground leading-relaxed">{summary}</p>
      </div>
      <p className="text-xs text-foreground/40 italic">
        Generated {generatedAt ? formatDateRelative(generatedAt) : ''} by AI — for reference only,
        not professional advice.
      </p>
    </div>
  )
}
