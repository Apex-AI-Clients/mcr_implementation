'use client'

import type { LeaveOneOutResult } from '@/lib/sbr/accuracy'
import type { GrowthPoint } from '@/lib/sbr/predictionData'
import { RISK_BAND_LABELS, RISK_BAND_RULE, bandForRejectedNeighbours } from '@/lib/sbr/riskBands'
import type { SbrRiskBand } from '@/lib/sbr/types'
import styles from './PredictionData.module.css'
import { revealClass, useReveal } from './shared'

interface BandRow {
  band: SbrRiskBand
  rule: string
  cases: number
  accepted: number
}

/** The leave-one-out evidence grouped by band: how often each band's plans were accepted. */
export function bandRows(accuracy: LeaveOneOutResult | null): BandRow[] {
  const { likelyAcceptedMax: a, borderlineMax: b } = RISK_BAND_RULE
  const span = (from: number, to: number) => (from === to ? `${from}` : `${from}–${to}`)
  const rows: BandRow[] = [
    { band: 'likely_accepted', rule: `${span(0, a)} of 8 rejected`, cases: 0, accepted: 0 },
    { band: 'borderline', rule: `${span(a + 1, b)} of 8 rejected`, cases: 0, accepted: 0 },
    { band: 'high_rejection_risk', rule: `${b + 1}+ of 8 rejected`, cases: 0, accepted: 0 },
  ]
  for (const r of accuracy?.byRejectedNeighbours ?? []) {
    const row = rows.find((x) => x.band === bandForRejectedNeighbours(r.rejectedNeighbours))!
    row.cases += r.cases
    row.accepted += r.cases - r.actuallyRejected
  }
  return rows
}

const TONE: Record<SbrRiskBand, { soft: string; text: string; fill: string }> = {
  likely_accepted: { soft: 'var(--ok-soft)', text: 'var(--ok-text)', fill: 'var(--ok)' },
  borderline: { soft: 'var(--warn-soft)', text: 'var(--warn-text)', fill: 'var(--warn)' },
  high_rejection_risk: { soft: 'var(--bad-soft)', text: 'var(--bad-text)', fill: 'var(--bad)' },
}

export function BehindTheNumbers({ growth, accuracy }: { growth: GrowthPoint[]; accuracy: LeaveOneOutResult | null }) {
  const [ref, seen] = useReveal<HTMLElement>()
  const bands = bandRows(accuracy)

  // Growth scale: a little room above and below the totals.
  const totals = growth.map((g) => g.total)
  const lo = Math.max(0, Math.floor((Math.min(...totals) - 15) / 10) * 10)
  const hi = Math.ceil((Math.max(...totals) + 10) / 10) * 10
  const gx = (k: number) => (growth.length === 1 ? 50 : (k / (growth.length - 1)) * 100)
  const gy = (v: number) => 100 - ((v - lo) / Math.max(1, hi - lo)) * 100
  const line = growth.map((g, k) => `${gx(k)},${gy(g.total)}`).join(' ')
  const area = growth.length > 1 ? `0,100 ${line} 100,100` : ''

  return (
    <section ref={ref} aria-labelledby="behind-title" className={revealClass(seen)} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <h2 id="behind-title" style={{ margin: 0, fontSize: 26 }}>
          Behind the numbers
        </h2>
        <p style={{ margin: 0, color: 'var(--muted)', fontSize: 15.5 }}>For anyone who wants to check our working. Both update after every upload or undo.</p>
      </div>
      <div className={styles.stagger} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(440px, 100%), 1fr))', gap: 20 }}>
        <div className={styles.card} style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <h3 style={{ margin: 0, fontSize: 19 }}>How the data has grown</h3>
            <p style={{ margin: 0, fontSize: 14, color: 'var(--muted)', lineHeight: 1.5 }}>
              Past cases in use after each upload, with typical accuracy underneath.
            </p>
          </div>
          <div style={{ position: 'relative', height: 210, margin: '26px 30px 48px' }} role="img" aria-label={`Cases in use: ${growth.map((g) => `${g.label} ${g.total}`).join(', ')}.`}>
            <div style={{ position: 'absolute', left: 0, right: 0, top: 0, borderTop: '1px dashed var(--grid)' }} />
            <div style={{ position: 'absolute', left: 0, right: 0, top: '50%', borderTop: '1px dashed var(--grid)' }} />
            <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, borderTop: '1px solid var(--line)' }} />
            {growth.length > 1 && (
              <svg
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  height: '100%',
                  overflow: 'visible',
                  transition: 'clip-path 1.6s cubic-bezier(.4,0,.2,1) .3s',
                  clipPath: `inset(-10% ${seen ? '-2%' : '101%'} -10% -2%)`,
                }}
              >
                <polygon points={area} fill="#2563EB" fillOpacity={0.08} />
                <polyline points={line} fill="none" stroke="#2563EB" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
              </svg>
            )}
            {growth.map((g, k) => (
              <div
                key={`p${g.at}${k}`}
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  left: `${gx(k)}%`,
                  top: `${gy(g.total)}%`,
                  width: 12,
                  height: 12,
                  margin: '-6px 0 0 -6px',
                  transition: `opacity .4s ease ${0.4 + k * 0.32}s, transform .5s cubic-bezier(.2,.8,.2,1.4) ${0.4 + k * 0.32}s`,
                  opacity: seen ? 1 : 0,
                  transform: `scale(${seen ? 1 : 0.3})`,
                }}
              >
                <span className={styles.num} style={{ position: 'absolute', left: '50%', bottom: 16, transform: 'translateX(-50%)', fontSize: 13.5, fontWeight: 700 }}>
                  {g.total}
                </span>
                <span style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: 'var(--card)', border: '2.5px solid #2563EB' }} />
              </div>
            ))}
            {growth.map((g, k) => (
              <div
                key={`l${g.at}${k}`}
                className={styles.num}
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  left: `${gx(k)}%`,
                  top: 'calc(100% + 10px)',
                  transform: 'translateX(-50%)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 2,
                  whiteSpace: 'nowrap',
                }}
              >
                <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--muted)' }}>{g.label}</span>
                {g.accuracy !== null && <span style={{ fontSize: 12, color: 'var(--faint)' }}>±{g.accuracy}</span>}
              </div>
            ))}
          </div>
        </div>

        <div className={styles.card} style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <h3 style={{ margin: 0, fontSize: 19 }}>Do the risk bands hold up?</h3>
            <p style={{ margin: 0, fontSize: 14, color: 'var(--muted)', lineHeight: 1.5 }}>
              We predicted each past case using only the others, then compared with how creditors actually voted. Bands are
              indicative, not probabilities.
            </p>
          </div>
          {accuracy === null ? (
            <p style={{ margin: 0, color: 'var(--muted)' }}>Not enough cases yet.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1.3fr 1.1fr .6fr 1.6fr',
                  gap: 14,
                  padding: '0 4px 10px',
                  fontSize: 12,
                  fontWeight: 700,
                  letterSpacing: '.06em',
                  textTransform: 'uppercase',
                  color: 'var(--faint)',
                }}
              >
                <span>Band</span>
                <span>When</span>
                <span>Cases</span>
                <span>Plans accepted</span>
              </div>
              {bands.map((b) => {
                const pct = b.cases > 0 ? Math.round((b.accepted / b.cases) * 100) : 0
                const tone = TONE[b.band]
                return (
                  <div
                    key={b.band}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1.3fr 1.1fr .6fr 1.6fr',
                      gap: 14,
                      alignItems: 'center',
                      padding: '16px 4px',
                      borderTop: '1px solid var(--line2)',
                    }}
                  >
                    <span>
                      <span style={{ display: 'inline-flex', padding: '5px 11px', borderRadius: 999, fontSize: 13, fontWeight: 700, background: tone.soft, color: tone.text }}>
                        {RISK_BAND_LABELS[b.band]}
                      </span>
                    </span>
                    <span className={styles.num} style={{ fontSize: 14, color: 'var(--muted)' }}>
                      {b.rule}
                    </span>
                    <span className={styles.num} style={{ fontWeight: 650 }}>
                      {b.cases}
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ flex: 1, height: 8, borderRadius: 99, background: 'var(--card2)', border: '1px solid var(--line2)', overflow: 'hidden' }}>
                        <span
                          style={{
                            display: 'block',
                            height: '100%',
                            borderRadius: 99,
                            transition: 'width 1.2s cubic-bezier(.2,.8,.2,1) .5s',
                            width: `${seen ? pct : 0}%`,
                            background: tone.fill,
                          }}
                        />
                      </span>
                      <span className={styles.num} style={{ fontSize: 13.5, whiteSpace: 'nowrap' }}>
                        <strong>{pct}%</strong>{' '}
                        <span style={{ color: 'var(--faint)' }}>
                          ({b.accepted} of {b.cases})
                        </span>
                      </span>
                    </span>
                  </div>
                )
              })}
            </div>
          )}
          <p style={{ margin: 'auto 0 0', fontSize: 13, color: 'var(--faint)', lineHeight: 1.5 }}>
            Re-tested automatically after every upload.{accuracy ? ` Based on ${accuracy.sampleSize} cases.` : ''}
          </p>
        </div>
      </div>
    </section>
  )
}
