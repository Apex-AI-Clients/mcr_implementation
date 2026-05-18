import { cn } from '@/lib/utils'

interface Props {
  /** Values in chronological order (FY-ascending). `null` entries are skipped. */
  values: Array<number | null>
  /** Tailwind colour class used for the stroke (e.g. "text-success"). The
   *  stroke uses currentColor so any text-* class works. */
  className?: string
  width?: number
  height?: number
}

/**
 * Tiny inline SVG sparkline. Pure presentation — no deps, no axes, no labels.
 * Renders nothing if fewer than two non-null values are available.
 */
export function TrendSparkline({ values, className, width = 80, height = 24 }: Props) {
  const present = values
    .map((v, i) => ({ v, i }))
    .filter((p): p is { v: number; i: number } => p.v !== null)

  if (present.length < 2) {
    return <div className={cn('inline-block', className)} style={{ width, height }} />
  }

  const min = Math.min(...present.map((p) => p.v))
  const max = Math.max(...present.map((p) => p.v))
  const range = max - min || 1
  const stepX = width / (values.length - 1)

  const points = present.map((p) => {
    const x = p.i * stepX
    // Normalise to 0..1 then flip (SVG y grows down). 2px padding so dots don't clip.
    const yNorm = (p.v - min) / range
    const y = height - 2 - yNorm * (height - 4)
    return { x, y, v: p.v }
  })

  const path = points
    .map((pt, idx) => `${idx === 0 ? 'M' : 'L'} ${pt.x.toFixed(2)} ${pt.y.toFixed(2)}`)
    .join(' ')

  const last = points[points.length - 1]

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn('overflow-visible', className)}
      aria-hidden="true"
    >
      <path
        d={path}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={last.x} cy={last.y} r={2} fill="currentColor" />
    </svg>
  )
}
