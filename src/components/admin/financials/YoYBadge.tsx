import { ArrowUp, ArrowDown, Minus } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Props {
  /** Year-over-year percent change. `null` renders nothing. */
  percent: number | null
  /** When true, an INCREASE is bad (e.g. ATO debt growing). Inverts colour
   *  sentiment so up arrows are red and down arrows are green. */
  invertSentiment?: boolean
  size?: 'sm' | 'md'
  className?: string
}

export function YoYBadge({ percent, invertSentiment = false, size = 'sm', className }: Props) {
  if (percent === null) return null

  const rounded = Math.round(percent)
  const absRound = Math.abs(rounded)
  const isFlat = rounded === 0
  const isUp = rounded > 0

  // Sentiment: up=good unless inverted (e.g. ATO debt up = bad)
  const sentiment: 'good' | 'bad' | 'flat' = isFlat
    ? 'flat'
    : invertSentiment
      ? isUp
        ? 'bad'
        : 'good'
      : isUp
        ? 'good'
        : 'bad'

  const Icon = isFlat ? Minus : isUp ? ArrowUp : ArrowDown

  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 rounded-md font-medium tabular-nums',
        {
          'bg-success/15 text-success': sentiment === 'good',
          'bg-destructive/15 text-destructive': sentiment === 'bad',
          'bg-foreground/10 text-foreground/60': sentiment === 'flat',
          'h-5 px-1.5 text-[10px]': size === 'sm',
          'h-6 px-2 text-xs': size === 'md',
        },
        className,
      )}
    >
      <Icon className={size === 'sm' ? 'h-2.5 w-2.5' : 'h-3 w-3'} />
      {isFlat ? '0%' : `${isUp ? '+' : ''}${absRound}%`}
    </span>
  )
}
