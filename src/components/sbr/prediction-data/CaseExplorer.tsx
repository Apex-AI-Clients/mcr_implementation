'use client'

import { useMemo, useState, type CSSProperties } from 'react'
import { NO_PAYMENTS_EVER_DAYS } from '@/lib/sbr/import/config'
import type { PredictionCaseRow } from '@/lib/sbr/predictionData'
import { nearestCaseIds } from '@/lib/sbr/similarity'
import type { HistoricalSbrCase } from '@/lib/sbr/types'
import styles from './PredictionData.module.css'
import { ResultBadge, Shape, money, revealClass, useReveal } from './shared'

/**
 * "Explore the cases": every past case in use, cents in the dollar (up)
 * against a factor (across). Hover or focus a case to see it and the 8 cases
 * most similar to it — worked out exactly as a prediction would
 * (similarity.ts) — joined by blue lines. Click to open it. The filters and
 * search above the case list highlight their matches here too.
 */

type FactorKey = 'debt' | 'daysLate' | 'late' | 'payment' | 'loan'

interface Factor {
  label: string
  value: (c: PredictionCaseRow) => number
  show: (c: PredictionCaseRow) => string
  /** Square-root scale for long-tailed figures, so the crowd near 0 spreads out. */
  sqrt: boolean
  ticks: (max: number) => number[]
  fmt: (v: number) => string
}

const kfmt = (v: number) => (v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(1).replace('.0', '')}m` : v === 0 ? '$0' : `$${Math.round(v / 1000)}k`)
const nfmt = (v: number) => v.toLocaleString('en-AU')
const upTo = (list: number[]) => (max: number) => list.filter((v) => v <= max * 1.02)

export const FACTORS: Record<FactorKey, Factor> = {
  debt: {
    label: 'Total debt',
    value: (c) => c.creditorAmount,
    show: (c) => money(c.creditorAmount),
    sqrt: false,
    ticks: (max) => Array.from({ length: Math.floor(max / 200_000) + 1 }, (_, i) => i * 200_000),
    fmt: kfmt,
  },
  daysLate: {
    label: 'Days late (total)',
    value: (c) => c.factors.cumulativeDaysLate,
    show: (c) => `${nfmt(c.factors.cumulativeDaysLate)} days`,
    sqrt: true,
    ticks: upTo([0, 500, 2_000, 5_000, 10_000, 25_000, 50_000, 80_000]),
    fmt: nfmt,
  },
  late: {
    label: 'Late lodgements',
    value: (c) => c.factors.numberOfLateLodgements,
    show: (c) => String(c.factors.numberOfLateLodgements),
    sqrt: true,
    ticks: upTo([0, 5, 15, 30, 60, 100, 150, 200]),
    fmt: nfmt,
  },
  payment: {
    label: 'Days since last payment',
    value: (c) => c.factors.daysSinceLastPayment ?? Number.NaN,
    show: (c) => (c.factors.daysSinceLastPayment === null ? 'No payments ever' : `${nfmt(c.factors.daysSinceLastPayment)} days`),
    sqrt: false,
    ticks: (max) => Array.from({ length: Math.floor(max / 500) + 1 }, (_, i) => i * 500),
    fmt: nfmt,
  },
  loan: {
    label: 'Director loan',
    value: (c) => c.factors.directorLoanReceivableAmount,
    show: (c) => money(c.factors.directorLoanReceivableAmount),
    sqrt: true,
    ticks: upTo([0, 25_000, 100_000, 250_000, 500_000, 1_000_000, 1_500_000]),
    fmt: kfmt,
  },
}

const ORDER: FactorKey[] = ['debt', 'daysLate', 'late', 'payment', 'loan']

function toHistorical(c: PredictionCaseRow): HistoricalSbrCase {
  return {
    id: c.id,
    clientName: c.clientName,
    features: {
      dpn: c.factors.dpn,
      paymentPlanType: c.factors.paymentPlanType,
      directorLoanAtAppointment: c.factors.directorLoanAtAppointment,
      directorLoanReceivableAmount: c.factors.directorLoanReceivableAmount,
      cumulativeDaysLate: c.factors.cumulativeDaysLate,
      numberOfLateLodgements: c.factors.numberOfLateLodgements,
      daysSinceLastPayment: c.factors.daysSinceLastPayment ?? NO_PAYMENTS_EVER_DAYS,
    },
    outcomePercent: c.outcomePercent,
    accepted: c.accepted,
    creditorAmount: c.creditorAmount,
    sbrPayment: c.sbrPayment,
  }
}

interface Props {
  cases: PredictionCaseRow[]
  /** Ids the list's filter / search matches, or null when none is set. */
  highlight: Set<string> | null
  highlightLabel: string
  onClearHighlight: () => void
  onOpen: (id: string) => void
}

export function CaseExplorer({ cases, highlight, highlightLabel, onClearHighlight, onOpen }: Props) {
  const [ref, seen] = useReveal<HTMLElement>()
  const [factor, setFactor] = useState<FactorKey>('debt')
  const [hover, setHover] = useState<string | null>(null)
  const f = FACTORS[factor]

  const used = useMemo(() => cases.filter((c) => !c.excluded), [cases])
  const historical = useMemo(() => used.map(toHistorical), [used])

  // x: "no payments ever" sits at the longest real gap, as in the distance.
  const xOf = useMemo(() => {
    const cap = Math.max(0, ...used.map((c) => c.factors.daysSinceLastPayment ?? 0))
    return (c: PredictionCaseRow) => {
      const v = f.value(c)
      return Number.isNaN(v) ? cap : v
    }
  }, [used, f])
  const xMax = useMemo(() => Math.max(1, ...used.map(xOf)), [used, xOf])
  const ticks = f.ticks(xMax)
  const domainMax = Math.max(xMax, ticks[ticks.length - 1] ?? 1)
  const scale = (v: number) => (f.sqrt ? Math.sqrt(Math.max(0, v)) / Math.sqrt(domainMax) : Math.max(0, v) / domainMax) * 100
  const yMax = Math.max(70, Math.ceil(Math.max(0, ...used.map((c) => c.outcomePercent)) / 10) * 10)
  const pos = (c: PredictionCaseRow) => ({ left: scale(xOf(c)), top: 100 - (c.outcomePercent / yMax) * 100 })

  const hovered = hover ? used.find((c) => c.id === hover) ?? null : null
  const nearIds = useMemo(() => (hover ? nearestCaseIds(hover, historical, 8) : []), [hover, historical])
  const near = new Set(nearIds)
  const nearCases = nearIds.map((id) => used.find((c) => c.id === id)!).filter(Boolean)

  const yTicks = Array.from({ length: yMax / 10 + 1 }, (_, i) => i * 10)

  return (
    <section
      ref={ref}
      aria-labelledby="explore-title"
      className={`${styles.card} ${revealClass(seen)}`}
      style={{ padding: 32, display: 'flex', flexDirection: 'column', gap: 26 }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-end', gap: 18 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 520 }}>
          <h2 id="explore-title" style={{ margin: 0, fontSize: 26 }}>
            Explore the cases
          </h2>
          <p style={{ margin: 0, color: 'var(--muted)', fontSize: 15.5, lineHeight: 1.5 }}>
            Each shape is one past case. Hover to see it and its 8 most similar cases, click to open it.
          </p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--faint)' }}>Compare the offer against</span>
          <div className={styles.seg} role="group" aria-label="Factor on the horizontal axis">
            {ORDER.map((k) => (
              <button
                key={k}
                type="button"
                className={k === factor ? styles.segOn : undefined}
                aria-pressed={k === factor}
                onClick={() => {
                  setFactor(k)
                  setHover(null)
                }}
              >
                {FACTORS[k].label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 10, minHeight: 40 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--faint)' }}>Cents in the dollar offered to creditors ↑</div>
          {highlight && (
            <div
              className={styles.fade}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 10,
                padding: '4px 4px 4px 14px',
                borderRadius: 999,
                background: 'var(--accent-soft)',
                color: 'var(--accent-text)',
                fontSize: 13.5,
                fontWeight: 600,
              }}
            >
              <span>
                Highlighting {highlightLabel} · <span className={styles.num}>{highlight.size}</span> cases
              </span>
              <button
                type="button"
                className={`${styles.btn} ${styles.quiet}`}
                style={{ minHeight: 32, padding: '0 12px', fontSize: 13, color: 'var(--accent-text)' }}
                onClick={onClearHighlight}
              >
                Clear
              </button>
            </div>
          )}
        </div>

        <div style={{ position: 'relative', height: 400, margin: '10px 8px 40px 48px' }}>
          {yTicks.map((v) => (
            <div
              key={v}
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                top: `${100 - (v / yMax) * 100}%`,
                borderTop: v === 0 ? '1px solid var(--line)' : '1px dashed var(--grid)',
              }}
            >
              <span className={styles.num} style={{ position: 'absolute', left: -48, top: -9, width: 38, textAlign: 'right', fontSize: 12.5, color: 'var(--faint)' }}>
                {v}c
              </span>
            </div>
          ))}
          {ticks.map((v) => (
            <span
              key={v}
              className={styles.num}
              style={{
                position: 'absolute',
                bottom: -30,
                left: `${scale(v)}%`,
                transform: 'translateX(-50%)',
                fontSize: 12.5,
                color: 'var(--faint)',
                whiteSpace: 'nowrap',
              }}
            >
              {f.fmt(v)}
            </span>
          ))}

          {hovered && (
            <>
              <div
                className={styles.fade}
                style={{
                  position: 'absolute',
                  zIndex: 1,
                  pointerEvents: 'none',
                  left: `${pos(hovered).left}%`,
                  top: `${pos(hovered).top}%`,
                  bottom: 0,
                  borderLeft: '1.5px dashed var(--faint)',
                  opacity: 0.55,
                }}
              />
              <div
                className={styles.fade}
                style={{
                  position: 'absolute',
                  zIndex: 1,
                  pointerEvents: 'none',
                  left: 0,
                  width: `${pos(hovered).left}%`,
                  top: `${pos(hovered).top}%`,
                  borderTop: '1.5px dashed var(--faint)',
                  opacity: 0.55,
                }}
              />
              <svg
                key={hovered.id}
                className={styles.nbgrow}
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                aria-hidden="true"
                style={
                  {
                    '--cx': `${pos(hovered).left}%`,
                    '--cy': `${pos(hovered).top}%`,
                    position: 'absolute',
                    inset: 0,
                    width: '100%',
                    height: '100%',
                    overflow: 'visible',
                    zIndex: 1,
                    pointerEvents: 'none',
                    opacity: 0.7,
                  } as CSSProperties
                }
              >
                <path
                  d={nearCases.map((n) => `M${pos(hovered).left.toFixed(2)} ${pos(hovered).top.toFixed(2)} L${pos(n).left.toFixed(2)} ${pos(n).top.toFixed(2)}`).join(' ') || 'M0 0'}
                  fill="none"
                  stroke="#2563EB"
                  strokeWidth={1.5}
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
              <span
                className={styles.num}
                style={{
                  position: 'absolute',
                  zIndex: 7,
                  left: -50,
                  top: `${pos(hovered).top}%`,
                  transform: 'translateY(-50%)',
                  padding: '3px 7px',
                  borderRadius: 7,
                  background: 'var(--inv)',
                  color: 'var(--on-inv)',
                  fontSize: 12,
                  fontWeight: 700,
                  pointerEvents: 'none',
                }}
              >
                {hovered.outcomePercent.toFixed(1)}c
              </span>
              <span
                className={`${styles.num} ${styles.fade}`}
                style={{
                  position: 'absolute',
                  zIndex: 7,
                  bottom: -32,
                  left: `${pos(hovered).left}%`,
                  transform: 'translateX(-50%)',
                  padding: '3px 8px',
                  borderRadius: 7,
                  background: 'var(--inv)',
                  color: 'var(--on-inv)',
                  fontSize: 12,
                  fontWeight: 700,
                  whiteSpace: 'nowrap',
                  pointerEvents: 'none',
                }}
              >
                {f.show(hovered)}
              </span>
            </>
          )}

          {used.map((c, j) => {
            const p = pos(c)
            const isHover = hover === c.id
            const isNear = near.has(c.id)
            let opacity = 1
            if (hovered) opacity = isHover || isNear ? 1 : 0.18
            else if (highlight) opacity = highlight.has(c.id) ? 1 : 0.13
            if (!seen) opacity = 0
            const scaleBy = isHover ? 1.7 : isNear ? 1.3 : highlight && !hovered && highlight.has(c.id) ? 1.15 : 1
            const delay = seen ? (j % 46) * 14 : 0
            const ring = isNear
              ? '0 0 0 2px var(--card), 0 0 0 4px #2563EB'
              : highlight && highlight.has(c.id) && c.dataCheck
                ? '0 0 0 2px var(--card), 0 0 0 4px var(--warn)'
                : '0 0 0 2px var(--card)'
            const style: CSSProperties = {
              left: `${p.left}%`,
              top: `${seen ? p.top : 100}%`,
              transition: `left .8s cubic-bezier(.2,.8,.2,1), top 1s cubic-bezier(.2,.9,.25,1.15) ${delay}ms, opacity .35s ease ${hover ? 0 : delay}ms, transform .2s ease`,
              opacity,
              transform: `scale(${scaleBy})`,
              zIndex: isHover ? 6 : isNear ? 5 : c.accepted ? 2 : 3,
              ...(c.accepted
                ? { width: 14, height: 14, margin: '-7px 0 0 -7px', borderRadius: '50%', background: 'var(--ok)', boxShadow: ring }
                : { width: 16, height: 14, margin: '-8px 0 0 -8px', background: 'var(--bad)', clipPath: 'polygon(50% 0, 100% 100%, 0 100%)' }),
            }
            return (
              <button
                key={c.id}
                type="button"
                className={styles.pt}
                style={style}
                aria-label={`${c.clientName}, ${c.outcomePercent.toFixed(1)} cents, ${c.accepted ? 'plan accepted' : 'plan rejected'}. Open case.`}
                onMouseEnter={() => setHover(c.id)}
                onMouseLeave={() => setHover((h) => (h === c.id ? null : h))}
                onFocus={() => setHover(c.id)}
                onBlur={() => setHover((h) => (h === c.id ? null : h))}
                onClick={() => onOpen(c.id)}
              />
            )
          })}

          {hovered && (
            <Tooltip c={hovered} left={pos(hovered).left} top={pos(hovered).top} factorLabel={f.label} factorValue={f.show(hovered)} near={nearCases} />
          )}
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 12, alignItems: 'center', paddingLeft: 48 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, fontSize: 13.5, color: 'var(--muted)', fontWeight: 600 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
              <Shape accepted size={12} />
              Plan accepted
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
              <Shape accepted={false} size={12} />
              Plan rejected
            </span>
          </div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--faint)' }}>{f.label} →</div>
        </div>
      </div>
    </section>
  )
}

function Tooltip({
  c,
  left,
  top,
  factorLabel,
  factorValue,
  near,
}: {
  c: PredictionCaseRow
  left: number
  top: number
  factorLabel: string
  factorValue: string
  near: PredictionCaseRow[]
}) {
  const below = top < 40
  const nearAccepted = near.filter((n) => n.accepted).length
  return (
    <div
      role="tooltip"
      style={{
        position: 'absolute',
        zIndex: 10,
        pointerEvents: 'none',
        left: `${Math.max(15, Math.min(85, left))}%`,
        top: `${top}%`,
        transform: `translate(-50%, ${below ? '18px' : 'calc(-100% - 18px)'})`,
        width: 250,
        padding: '14px 16px',
        borderRadius: 14,
        background: 'var(--card)',
        border: '1px solid var(--line)',
        boxShadow: 'var(--shadow-lg)',
      }}
    >
      <div style={{ fontWeight: 700, fontSize: 14 }}>{c.clientName}</div>
      {c.businessType && <div style={{ fontSize: 12.5, color: 'var(--faint)', marginTop: 2 }}>{c.businessType}</div>}
      <div className={styles.num} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '4px 16px', marginTop: 10, fontSize: 13 }}>
        <span style={{ color: 'var(--muted)' }}>Offer</span>
        <strong>{c.outcomePercent.toFixed(1)}c in the dollar</strong>
        <span style={{ color: 'var(--muted)' }}>{factorLabel}</span>
        <strong>{factorValue}</strong>
      </div>
      <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--line2)', display: 'flex', flexDirection: 'column', gap: 7 }}>
        <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>Its 8 most similar cases (blue lines)</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          {near.map((n) => (
            <Shape key={n.id} accepted={n.accepted} size={9} />
          ))}
          <span className={styles.num} style={{ marginLeft: 6, fontSize: 12.5, fontWeight: 700 }}>
            {nearAccepted} of {near.length} accepted
          </span>
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 10 }}>
        <ResultBadge accepted={c.accepted} />
        <span style={{ fontSize: 12, color: 'var(--faint)' }}>Click to open</span>
      </div>
    </div>
  )
}
