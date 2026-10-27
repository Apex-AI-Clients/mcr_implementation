'use client'

import { useEffect, useId, useRef, useState } from 'react'
import Link from 'next/link'
import { Info } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { AmountSource, SourceLink } from '@/lib/sources'

const AUD = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' })
const AUD_WHOLE = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 })

const PANEL_WIDTH = 340
const GAP = 6

interface SourcedAmountProps {
  /** The amount; null shows a dash. */
  value: number | null
  /** Where it comes from. Required: an amount without a source is a bug (warned in development, failed by tests). */
  source: AmountSource | null | undefined
  /** How to show it; whole dollars by default, cents with `cents`. */
  format?: (value: number) => string
  /** The amount already formatted (from a server component, which cannot pass `format`). */
  text?: string
  cents?: boolean
  className?: string
}

/**
 * Every dollar amount on the SBR pages, with an ⓘ that says where it comes
 * from: the document, statement, period, page and printed line (or the ATO
 * account rows), the reading rule applied, the sum with the actual numbers
 * for a calculated amount, and a way to see it — "Open PDF at this page",
 * "Show the ATO rows", "Confirm key figures". Hover or click; Escape closes.
 *
 * The panel is positioned `fixed` (as Tooltip) so tables with overflow
 * clipping cannot cut it off. Marked `data-sourced` so a test can check that
 * no amount on a page is shown without one (test/sourcedAmounts.ts).
 */
export function SourcedAmount({ value, source, format, text: preformatted, cents = false, className }: SourcedAmountProps) {
  const text = preformatted ?? (value === null ? '—' : format ? format(value) : (cents ? AUD : AUD_WHOLE).format(value))
  if (!source && process.env.NODE_ENV !== 'production') {
    console.warn(`[SourcedAmount] ${text} is shown without a source: say where it comes from.`)
  }
  return (
    <span className={cn('inline-flex items-baseline gap-0.5 whitespace-nowrap', className)} data-sourced={source ? 'yes' : 'missing'}>
      <span className={cn(!source && 'underline decoration-destructive decoration-dashed')}>{text}</span>
      {source && <SourceButton source={source} label={text} />}
    </span>
  )
}

/** The ⓘ and its panel, for an amount shown some other way (a typed input, a tile heading). */
export function SourceButton({ source, label }: { source: AmountSource; label: string }) {
  const id = useId()
  const button = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<{ top: number; left: number; above: boolean } | null>(null)
  const [pinned, setPinned] = useState(false)

  function open() {
    const rect = button.current?.getBoundingClientRect()
    if (!rect) return
    const above = window.innerHeight - rect.bottom < 220
    setPosition({
      top: above ? rect.top - GAP : rect.bottom + GAP,
      left: Math.min(Math.max(GAP, rect.left - PANEL_WIDTH / 2), window.innerWidth - PANEL_WIDTH - GAP),
      above,
    })
  }
  function close() {
    setPosition(null)
    setPinned(false)
  }

  useEffect(() => {
    if (!position) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    const onDown = (e: MouseEvent) => {
      if (!panel.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) close()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [position])

  return (
    <>
      <button
        ref={button}
        type="button"
        aria-label={`Where ${label} comes from`}
        aria-expanded={!!position}
        aria-controls={id}
        onMouseEnter={open}
        onMouseLeave={() => !pinned && setTimeout(() => !panel.current?.matches(':hover') && setPosition(null), 120)}
        onFocus={open}
        onClick={(e) => {
          // Inside a clickable row or a link: the ⓘ only opens its panel.
          e.preventDefault()
          e.stopPropagation()
          if (pinned) close()
          else {
            open()
            setPinned(true)
          }
        }}
        className="no-print inline-flex h-3.5 w-3.5 shrink-0 translate-y-[1px] items-center justify-center rounded-full text-foreground/35 transition-colors hover:text-accent focus-visible:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <Info className="h-3 w-3" aria-hidden="true" />
      </button>
      {position && (
        <div
          ref={panel}
          id={id}
          role="dialog"
          aria-label={`Where ${label} comes from`}
          onMouseLeave={() => !pinned && setPosition(null)}
          style={{ top: position.top, left: position.left, width: PANEL_WIDTH, transform: position.above ? 'translateY(-100%)' : undefined }}
          className="fixed z-[70] space-y-1.5 whitespace-normal break-words rounded-lg border border-border bg-card px-3 py-2 text-left text-xs font-normal leading-relaxed text-foreground shadow-xl"
        >
          <SourceBody source={source} />
        </div>
      )}
    </>
  )
}

/** The panel's contents; also used where the source is shown inline (the PDF). */
export function SourceBody({ source }: { source: AmountSource }) {
  return (
    <>
      {source.from.map((line, i) => (
        <p key={i} className={i === 0 ? 'font-medium text-foreground' : 'text-foreground/70'}>
          {line}
        </p>
      ))}
      {source.rule && <p className="text-foreground/70">Rule: {source.rule}</p>}
      {source.calculation && <p className="whitespace-pre-line tabular-nums text-foreground/70">{source.calculation}</p>}
      {source.link && <SourceLinkView link={source.link} />}
    </>
  )
}

function SourceLinkView({ link }: { link: SourceLink }) {
  const [opening, setOpening] = useState(false)
  if (link.kind === 'href') {
    return (
      <Link href={link.href} className="inline-block text-accent hover:text-accent/80">
        {link.label}
      </Link>
    )
  }
  return (
    <button
      type="button"
      disabled={opening}
      onClick={async () => {
        setOpening(true)
        try {
          // A signed link, a few minutes long, made only when asked for.
          const res = await fetch(`/api/admin/documents/${link.documentId}/download`)
          const body = res.ok ? ((await res.json()) as { url?: string }) : null
          if (body?.url) window.open(`${body.url}${link.page ? `#page=${link.page}` : ''}`, '_blank', 'noopener,noreferrer')
        } finally {
          setOpening(false)
        }
      }}
      className="text-accent hover:text-accent/80 disabled:opacity-50"
    >
      {link.label ?? (link.page ? 'Open PDF at this page' : 'Open the PDF')}
    </button>
  )
}
