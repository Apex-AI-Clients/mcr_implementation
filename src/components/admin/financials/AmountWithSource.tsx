'use client'

import { Info } from 'lucide-react'
import { Tooltip } from '@/components/ui/Tooltip'
import type { ValueSource } from '@/lib/financials/types'

const AUD = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
  maximumFractionDigits: 0,
})

function formatAud(v: number | null): string {
  if (v === null) return '—'
  return AUD.format(v)
}

/** The amount, with an info icon that shows how it was arrived at. */
export function AmountWithSource({ value, source }: { value: number | null; source: ValueSource | null }) {
  const text = value === null || !source ? '' : describeSource(source, value)
  return (
    <span className="inline-flex items-center justify-end gap-1">
      {formatAud(value)}
      {text ? (
        <Tooltip content={text} className="no-print inline-flex cursor-help rounded text-foreground/35 hover:text-foreground/70 focus:text-foreground/70 focus:outline-none">
          <Info className="h-3 w-3" aria-label="How this figure was worked out" />
        </Tooltip>
      ) : (
        <span className="no-print inline-block w-3" aria-hidden />
      )}
    </span>
  )
}

/** Formula lines past this many are summarised, so the tooltip stays readable. */
const MAX_TERMS = 12

function formula(terms: Array<{ label: string; value: number; sign: 1 | -1 }>, result: number): string {
  const shown = terms.slice(0, MAX_TERMS).map((t, i) => `${t.sign < 0 ? '− ' : i === 0 ? '  ' : '+ '}${t.label}  ${formatAud(t.value)}`)
  if (terms.length > MAX_TERMS) shown.push(`  … and ${terms.length - MAX_TERMS} more`)
  return [...shown, `= ${formatAud(result)}`].join('\n')
}

function describeSource(source: ValueSource, value: number): string {
  const file = source.sourceFilename ? `"${source.sourceFilename}"` : 'the uploaded statement'
  const parts: string[] = []
  if (source.kind === 'nil') return `Not listed in ${file}, so taken as $0.`
  if (source.kind === 'picked') {
    parts.push(`Picked from ${file}`)
    const printed = source.printed ?? []
    if (printed.length === 1) parts.push(`Printed as "${printed[0].label}": ${formatAud(printed[0].value)}`)
    if (printed.length > 1) parts.push(`Printed lines added together:\n${formula(printed.map((p) => ({ ...p, sign: 1 as const })), value)}`)
    if (source.terms?.length) parts.push(`Adds up:\n${formula(source.terms, value)}`)
  } else {
    parts.push(`Calculated:\n${formula(source.terms ?? [], value)}`)
    parts.push(`Figures from ${file}`)
  }
  if (source.note) parts.push(source.note)
  return parts.join('\n\n')
}
