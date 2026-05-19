import { Sparkles } from 'lucide-react'

interface Props {
  text: string
}

/** Reused-looking AI summary callout, matching the lodgement card's pattern. */
export function AiNarrativeCallout({ text }: Props) {
  return (
    <div className="rounded-xl border border-accent/20 bg-accent/5 p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent/15">
          <Sparkles className="h-3.5 w-3.5 text-accent" />
        </div>
        <div className="flex-1">
          <p className="text-xs font-semibold text-foreground/80 mb-1">AI Summary</p>
          <p className="text-sm text-foreground/85 leading-relaxed whitespace-pre-line">{text}</p>
        </div>
      </div>
    </div>
  )
}
