'use client'

import { useRef, useState } from 'react'
import { cn } from '@/lib/utils'

/**
 * The dashboard's charts: SVG coloured by theme tokens (text-chart-*,
 * bg-success …) through currentColor, with a tooltip on hover. The server
 * sends only numbers and labels; the drawing and the hover happen here.
 *
 * Keyboard: the time-series charts take focus and move with ← →; every
 * segment and slice is listed in the chart's aria-label as well.
 */

const nf = new Intl.NumberFormat('en-AU', { maximumFractionDigits: 0 })
const fmt = (n: number) => nf.format(n)
const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : '–')

// ── Tooltip ─────────────────────────────────────────────────────────────────

export interface TipRow {
  label: string
  value: string
  /** A bg-* class for the swatch. */
  swatch?: string
  strong?: boolean
}

/**
 * A bubble at (x, y) inside a `relative` box. It sits right of the point, or
 * left of it on the box's right half, so it never runs off the edge.
 */
function Tip({ x, y, width, title, rows }: { x: number; y: number; width: number; title?: string; rows: readonly TipRow[] }) {
  const flip = x > width / 2
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-20 min-w-40 max-w-64 rounded-xl border border-border bg-card px-3 py-2.5 text-xs shadow-lg"
      style={{ left: x, top: y, transform: `translate(${flip ? 'calc(-100% - 12px)' : '12px'}, -50%)` }}
    >
      {title && <p className="mb-1.5 font-semibold text-foreground">{title}</p>}
      <ul className="flex flex-col gap-1">
        {rows.map((r) => (
          <li key={r.label} className={cn('flex items-center gap-2', r.strong && 'mt-0.5 border-t border-border pt-1.5')}>
            {r.swatch && <span className={cn('h-2 w-2 shrink-0 rounded-[2px]', r.swatch)} aria-hidden="true" />}
            <span className="flex-1 text-muted">{r.label}</span>
            <span className={cn('tabular-nums text-foreground', r.strong ? 'font-semibold' : 'font-medium')}>{r.value}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Pointer position inside an element, and its width. */
function usePointer<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const read = (e: React.PointerEvent) => {
    const rect = ref.current?.getBoundingClientRect()
    if (!rect) return null
    return { x: e.clientX - rect.left, y: e.clientY - rect.top, width: rect.width, height: rect.height }
  }
  return { ref, read }
}

// ── Stacked area ────────────────────────────────────────────────────────────

export interface Series {
  name: string
  values: readonly number[]
  /** text-* class for the area. */
  colorClass: string
  /** bg-* class for the tooltip swatch. */
  swatchClass: string
}

/** A round step at or above `peak`, so the axis reads 0, 10, 20 … */
function niceMax(peak: number): number {
  const steps = [4, 8, 12, 16, 20, 24, 32, 40, 48, 60, 80, 100, 120, 160, 200, 240, 320, 400, 500, 600, 800, 1000]
  return steps.find((s) => s >= peak * 1.1) ?? Math.ceil((peak * 1.1) / 500) * 500
}

function smooth(pts: readonly (readonly [number, number])[]): string {
  let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1]
    const [bx, by] = pts[i]
    const dx = (bx - ax) / 2
    d += ` C${(ax + dx).toFixed(1)} ${ay.toFixed(1)} ${(bx - dx).toFixed(1)} ${by.toFixed(1)} ${bx.toFixed(1)} ${by.toFixed(1)}`
  }
  return d
}

/** Stacked areas over equally spaced buckets. Hover (or ← →) shows each bucket's split. */
export function StackedArea({
  series,
  labels,
  spans,
  unit,
  ariaLabel,
}: {
  series: readonly Series[]
  labels: readonly string[]
  /** Tooltip title per bucket: "12 – 14 Nov". */
  spans: readonly string[]
  /** "new leads" */
  unit: string
  ariaLabel: string
}) {
  const W = 640
  const H = 220
  const n = labels.length
  const totals = labels.map((_, i) => series.reduce((s, x) => s + (x.values[i] ?? 0), 0))
  const max = niceMax(Math.max(1, ...totals))
  const x = (i: number) => (n === 1 ? W / 2 : (i * W) / (n - 1))
  const y = (v: number) => H - (v / max) * H

  const [active, setActive] = useState<number | null>(null)
  const { ref, read } = usePointer<HTMLDivElement>()
  const [box, setBox] = useState({ width: 0, height: H })

  const layers: { area: string; top: string; colorClass: string; tops: number[] }[] = []
  const run = new Array<number>(n).fill(0)
  for (const s of series) {
    const below = run.slice()
    for (let i = 0; i < n; i++) run[i] += s.values[i] ?? 0
    const top = run.map((v, i) => [x(i), y(v)] as const)
    const bottom = below.map((v, i) => [x(i), y(v)] as const).reverse()
    const topD = smooth(top)
    layers.push({ area: `${topD} ${smooth(bottom).replace(/^M/, 'L')} Z`, top: topD, colorClass: s.colorClass, tops: run.slice() })
  }

  function onMove(e: React.PointerEvent) {
    const p = read(e)
    if (!p || p.width === 0) return
    setBox({ width: p.width, height: p.height })
    setActive(Math.max(0, Math.min(n - 1, Math.round((p.x / p.width) * (n - 1)))))
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    setBox({ width: ref.current?.clientWidth ?? 0, height: H })
    setActive((i) => {
      const from = i ?? (e.key === 'ArrowLeft' ? n : -1)
      return Math.max(0, Math.min(n - 1, from + (e.key === 'ArrowLeft' ? -1 : 1)))
    })
  }

  const step = n > 8 ? 2 : 1
  const ticks = [max, (max * 3) / 4, max / 2, max / 4, 0]
  const activeX = active === null ? 0 : (x(active) / W) * box.width

  return (
    <div className="flex gap-2.5">
      <div className="-my-1.5 flex h-[220px] min-w-7 flex-col justify-between text-right text-[11px] text-muted tabular-nums" aria-hidden="true">
        {ticks.map((t) => (
          <span key={t}>{Math.round(t)}</span>
        ))}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        <div
          ref={ref}
          tabIndex={0}
          role="img"
          aria-label={`${ariaLabel} Use the left and right arrow keys to read each period.`}
          onPointerMove={onMove}
          onPointerLeave={() => setActive(null)}
          onBlur={() => setActive(null)}
          onKeyDown={onKey}
          className="relative h-[220px] cursor-crosshair rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-4 focus-visible:ring-offset-card"
        >
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block h-full w-full overflow-visible" aria-hidden="true">
            {[0, 55, 110, 165].map((gy) => (
              <line key={gy} x1={0} y1={gy} x2={W} y2={gy} className="stroke-border" strokeOpacity={0.5} vectorEffect="non-scaling-stroke" />
            ))}
            <line x1={0} y1={H} x2={W} y2={H} className="stroke-border" vectorEffect="non-scaling-stroke" />
            {layers.map((l, i) => (
              <path key={`a${i}`} d={l.area} className={cn(l.colorClass, 'transition-opacity')} fill="currentColor" fillOpacity={active === null ? 0.85 : 0.7} />
            ))}
            {layers.map((l, i) => (
              <path key={`l${i}`} d={l.top} fill="none" className="stroke-card" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
            ))}
            {active !== null && (
              <line x1={x(active)} y1={0} x2={x(active)} y2={H} className="stroke-foreground" strokeOpacity={0.35} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
            )}
          </svg>
          {/* Dots in HTML, so they stay round however the SVG stretches. */}
          {active !== null &&
            layers.map((l, i) =>
              (series[i].values[active] ?? 0) > 0 ? (
                <span
                  key={i}
                  aria-hidden="true"
                  className={cn('pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card', series[i].swatchClass)}
                  style={{ left: activeX, top: (y(l.tops[active]) / H) * box.height }}
                />
              ) : null,
            )}
          {active !== null && box.width > 0 && (
            <Tip
              x={activeX}
              y={box.height / 2}
              width={box.width}
              title={spans[active] ?? labels[active]}
              rows={[
                ...series
                  .map((s) => ({ label: s.name, value: fmt(s.values[active] ?? 0), swatch: s.swatchClass }))
                  .reverse(),
                { label: `Total ${unit}`, value: fmt(totals[active]), strong: true },
              ]}
            />
          )}
        </div>
        <div className="flex justify-between text-[11px] text-muted" aria-hidden="true">
          {labels.map((label, i) => (
            <span key={i} className={cn(i % step !== 0 && i !== n - 1 && 'invisible', active === i && 'visible font-semibold text-foreground')}>
              {label}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Donut with legend ───────────────────────────────────────────────────────

export interface Slice {
  key: string
  label: string
  value: number
  /** text-* class for the ring. */
  colorClass: string
  /** bg-* class for the legend swatch. */
  swatchClass: string
}

/**
 * A ring split by share, with its legend. Hovering a slice or its legend row
 * picks it out and puts its figures in the middle.
 */
export function DonutWithLegend({ slices, caption, ariaLabel }: { slices: readonly Slice[]; caption: string; ariaLabel: string }) {
  const [active, setActive] = useState<string | null>(null)
  const r = 54
  const C = 2 * Math.PI * r
  const sum = slices.reduce((s, x) => s + x.value, 0)
  const picked = slices.find((s) => s.key === active) ?? null
  let offset = 0

  return (
    <div className="flex flex-wrap items-center gap-6">
      <div className="relative h-[140px] w-[140px] shrink-0" onPointerLeave={() => setActive(null)}>
        <svg viewBox="0 0 140 140" width={140} height={140} role="img" aria-label={ariaLabel} className="overflow-visible">
          <circle cx={70} cy={70} r={r} fill="none" className="stroke-primary" strokeWidth={14} />
          <g transform="rotate(-90 70 70)">
            {sum > 0 &&
              slices.map((s) => {
                const len = (s.value / sum) * C
                const shown = s.value === sum ? len : Math.max(len - 2, 0)
                const on = active === s.key
                const el =
                  s.value > 0 ? (
                    <circle
                      key={s.key}
                      cx={70}
                      cy={70}
                      r={r}
                      fill="none"
                      stroke="currentColor"
                      className={cn(s.colorClass, 'cursor-pointer transition-[stroke-width,opacity] duration-150')}
                      strokeWidth={on ? 20 : 14}
                      opacity={active && !on ? 0.35 : 1}
                      strokeDasharray={`${shown.toFixed(2)} ${(C - shown).toFixed(2)}`}
                      strokeDashoffset={(-offset).toFixed(2)}
                      onPointerEnter={() => setActive(s.key)}
                    />
                  ) : null
                offset += len
                return el
              })}
          </g>
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
          <span className="text-2xl font-semibold tracking-tight text-foreground tabular-nums">{fmt(picked ? picked.value : sum)}</span>
          <span className="line-clamp-2 text-[11px] leading-tight text-muted">
            {picked ? `${picked.label} · ${pct(picked.value, sum)}` : caption}
          </span>
        </div>
      </div>
      <ul className="flex flex-[1_1_140px] flex-col gap-1" onPointerLeave={() => setActive(null)}>
        {slices.map((s) => (
          <li key={s.key}>
            <button
              type="button"
              onPointerEnter={() => setActive(s.key)}
              onFocus={() => setActive(s.key)}
              onBlur={() => setActive(null)}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                active === s.key ? 'bg-surface' : active ? 'opacity-50' : '',
              )}
            >
              <span className={cn('h-2.5 w-2.5 shrink-0 rounded-[3px]', s.swatchClass)} aria-hidden="true" />
              <span className="flex-1 text-muted">{s.label}</span>
              <span className="font-semibold text-foreground tabular-nums">{fmt(s.value)}</span>
              <span className="w-9 text-right text-muted tabular-nums">{pct(s.value, sum)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ── Segment bar ─────────────────────────────────────────────────────────────

export interface Segment {
  label: string
  value: number
  bgClass: string
}

/** One bar split into segments. Hover a segment for its count and share. */
export function SegmentBar({
  segments,
  ariaLabel,
  height = 'h-2.5',
  unit = 'files',
}: {
  segments: readonly Segment[]
  ariaLabel: string
  height?: string
  unit?: string
}) {
  const [active, setActive] = useState<number | null>(null)
  const [at, setAt] = useState({ x: 0, y: 0, width: 0 })
  const { ref, read } = usePointer<HTMLDivElement>()
  const sum = segments.reduce((s, x) => s + x.value, 0)
  const shown = segments.map((s, i) => ({ ...s, i })).filter((s) => s.value > 0)

  return (
    <div ref={ref} className="relative" onPointerLeave={() => setActive(null)}>
      <div role="img" aria-label={ariaLabel} className={cn('flex w-full gap-0.5 overflow-hidden rounded-full bg-primary', height)}>
        {sum > 0 &&
          shown.map((s) => (
            <div
              key={s.i}
              className={cn('h-full cursor-pointer transition-opacity', s.bgClass, active !== null && active !== s.i && 'opacity-40')}
              style={{ width: `${(s.value / sum) * 100}%` }}
              onPointerMove={(e) => {
                const p = read(e)
                if (p) setAt({ x: p.x, y: p.y, width: p.width })
                setActive(s.i)
              }}
            />
          ))}
      </div>
      {active !== null && (
        <Tip
          x={at.x}
          y={at.y}
          width={at.width}
          rows={[{ label: segments[active].label, value: `${fmt(segments[active].value)} ${unit} · ${pct(segments[active].value, sum)}`, swatch: segments[active].bgClass }]}
        />
      )}
    </div>
  )
}

// ── Sparkline ───────────────────────────────────────────────────────────────

const SPARK_STROKE: Record<string, string> = {
  accent: 'text-chart-1',
  success: 'text-success',
  warning: 'text-warning',
  destructive: 'text-destructive',
}

/** A small trend line. With `labels`, hovering shows each point's period and value. */
export function Sparkline({
  values,
  labels,
  unit,
  tone = 'accent',
}: {
  values: readonly number[]
  labels?: readonly string[]
  unit?: string
  tone?: 'accent' | 'success' | 'warning' | 'destructive'
}) {
  const [active, setActive] = useState<number | null>(null)
  const [width, setWidth] = useState(0)
  const { ref, read } = usePointer<HTMLDivElement>()
  if (values.length < 2) return <div className="h-8" aria-hidden="true" />

  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const pts = values.map((v, i) => [(i * 100) / (values.length - 1), 28 - ((v - min) / range) * 22] as const)
  const line = smooth(pts)
  const area = `${line} L100 32 L0 32 Z`
  const hoverable = !!labels

  return (
    <div
      ref={ref}
      className={cn('relative h-8', hoverable && 'cursor-crosshair')}
      onPointerMove={(e) => {
        if (!hoverable) return
        const p = read(e)
        if (!p || p.width === 0) return
        setWidth(p.width)
        setActive(Math.max(0, Math.min(values.length - 1, Math.round((p.x / p.width) * (values.length - 1)))))
      }}
      onPointerLeave={() => setActive(null)}
    >
      <svg viewBox="0 0 100 32" preserveAspectRatio="none" className={cn('block h-8 w-full', SPARK_STROKE[tone])} aria-hidden="true">
        <path d={area} fill="currentColor" fillOpacity={0.1} />
        <path d={line} fill="none" stroke="currentColor" strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      </svg>
      {active !== null && labels && (
        <>
          <span
            aria-hidden="true"
            className={cn('pointer-events-none absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card bg-current', SPARK_STROKE[tone])}
            style={{ left: (pts[active][0] / 100) * width, top: pts[active][1] }}
          />
          <Tip x={(pts[active][0] / 100) * width} y={pts[active][1]} width={width} title={labels[active]} rows={[{ label: unit ?? 'Value', value: fmt(values[active]) }]} />
        </>
      )}
    </div>
  )
}

// ── Funnel ──────────────────────────────────────────────────────────────────

const FUNNEL_OPACITY = ['opacity-100', 'opacity-80', 'opacity-65', 'opacity-50']

/** Horizontal funnel bars. Hover a step for its share of the start and of the step before. */
export function Funnel({ steps }: { steps: readonly { label: string; count: number; pct: number }[] }) {
  const [active, setActive] = useState<number | null>(null)
  const [at, setAt] = useState({ x: 0, y: 0, width: 0 })
  const { ref, read } = usePointer<HTMLDivElement>()
  const first = steps[0]?.count ?? 0

  return (
    <div ref={ref} className="relative flex flex-col gap-3.5" onPointerLeave={() => setActive(null)}>
      {steps.map((f, i) => (
        <div
          key={f.label}
          className={cn('flex flex-col gap-1.5 transition-opacity', active !== null && active !== i && 'opacity-60')}
          onPointerMove={(e) => {
            const p = read(e)
            if (p) setAt({ x: p.x, y: p.y, width: p.width })
            setActive(i)
          }}
        >
          <div className="flex items-baseline justify-between gap-2 text-[13px]">
            <span className="font-medium text-foreground">{f.label}</span>
            <span>
              <span className="text-sm font-semibold text-foreground tabular-nums">{fmt(f.count)}</span>
              <span className="ml-2 text-muted tabular-nums">{f.pct}%</span>
            </span>
          </div>
          <div className="h-7 overflow-hidden rounded-lg bg-primary">
            <div className={cn('h-7 rounded-lg bg-accent', FUNNEL_OPACITY[i] ?? 'opacity-50')} style={{ width: `${f.pct}%` }} />
          </div>
        </div>
      ))}
      {active !== null && (
        <Tip
          x={at.x}
          y={at.y}
          width={at.width}
          title={steps[active].label}
          rows={[
            { label: 'Leads', value: fmt(steps[active].count) },
            { label: 'Of all new leads', value: pct(steps[active].count, first) },
            ...(active > 0 ? [{ label: `Of “${steps[active - 1].label}”`, value: pct(steps[active].count, steps[active - 1].count) }] : []),
          ]}
        />
      )}
    </div>
  )
}
