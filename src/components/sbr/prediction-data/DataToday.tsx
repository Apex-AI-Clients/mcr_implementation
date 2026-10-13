'use client'

import { useEffect, useRef, useState } from 'react'
import type { PredictionDataStats } from '@/lib/sbr/predictionData'
import { formatDate } from '@/lib/utils'
import styles from './PredictionData.module.css'
import type { CaseFilter } from './CasesList'
import { Pill, Shape, revealClass, useReveal } from './shared'

interface Props {
  stats: PredictionDataStats
  /** Leave-one-out typical miss, points; null when too few cases. */
  accuracy: number | null
  /** Filter the case list and bring it into view. */
  onFilter: (filter: CaseFilter) => void
}

const big = { fontSize: 46, fontWeight: 700, lineHeight: 1, letterSpacing: '-.03em' } as const
const label = { fontSize: 14, fontWeight: 600, color: 'var(--muted)' } as const
const note = { margin: 'auto 0 0', fontSize: 13.5, lineHeight: 1.5, color: 'var(--muted)' } as const

/** "The data today": the four headline tiles. */
export function DataToday({ stats, accuracy, onFilter }: Props) {
  const [ref, seen] = useReveal<HTMLElement>()
  const acceptedPct = stats.total > 0 ? (stats.accepted / stats.total) * 100 : 0

  return (
    <section ref={ref} aria-labelledby="today-title" className={revealClass(seen)} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <h2 id="today-title" style={{ margin: 0, fontSize: 26 }}>
          The data today
        </h2>
        <p style={{ margin: 0, color: 'var(--muted)', fontSize: 15.5 }}>What predictions are using right now.</p>
      </div>
      <div className={styles.stagger} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(250px, 100%), 1fr))', gap: 20 }}>
        <div className={`${styles.card} ${styles.tile}`} style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={label}>Past cases in use</div>
          <div className={`${styles.display} ${styles.num}`} style={big}>
            <CountUp value={stats.total} run={seen} />
          </div>
          <div style={{ display: 'flex', gap: 3, height: 10, borderRadius: 99, overflow: 'hidden', marginTop: 'auto' }} aria-hidden="true">
            <span style={{ width: `${seen ? acceptedPct : 0}%`, background: 'var(--ok)', transition: 'width .9s cubic-bezier(.2,.8,.2,1) .2s' }} />
            <span style={{ flex: 1, background: 'var(--bad)' }} />
          </div>
          <div className={styles.num} style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px', fontSize: 13.5, color: 'var(--muted)' }}>
            <button type="button" className={styles.lnk} style={{ textDecoration: 'none', color: 'var(--muted)', fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: 6 }} onClick={() => onFilter('accepted')}>
              <Shape accepted size={9} />
              <strong style={{ color: 'var(--text)' }}>{stats.accepted}</strong> plans accepted
            </button>
            <button type="button" className={styles.lnk} style={{ textDecoration: 'none', color: 'var(--muted)', fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: 6 }} onClick={() => onFilter('rejected')}>
              <Shape accepted={false} size={9} />
              <strong style={{ color: 'var(--text)' }}>{stats.rejected}</strong> plans rejected
            </button>
          </div>
        </div>

        <div className={`${styles.card} ${styles.tile}`} style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={label}>Typical accuracy</div>
          {accuracy === null ? (
            <div className={styles.display} style={{ fontSize: 26, fontWeight: 700 }}>
              Not enough cases yet
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span className={`${styles.display} ${styles.num}`} style={big}>
                ±<CountUp value={accuracy} decimals={1} run={seen} />
              </span>
              <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--muted)' }}>points</span>
            </div>
          )}
          <p style={note}>How far a prediction usually lands from the real result, tested by predicting each past case from all the others.</p>
        </div>

        <div className={`${styles.card} ${styles.tile}`} style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={label}>Last upload</div>
          <div className={`${styles.display} ${styles.num}`} style={{ fontSize: 32, fontWeight: 700, lineHeight: 1.1, letterSpacing: '-.02em' }}>
            {stats.lastUploadAt ? formatDate(stats.lastUploadAt) : 'None yet'}
          </div>
          <p style={note}>
            {stats.lastUploadAt ? (
              <>
                by <strong style={{ color: 'var(--text)' }}>{stats.lastUploadBy}</strong>
                {stats.lastUploadAdded != null && <> · {stats.lastUploadAdded} cases added</>}
              </>
            ) : (
              <>Only the initial data so far. Upload a workbook to add the latest cases.</>
            )}
          </p>
        </div>

        <div className={`${styles.card} ${styles.tile}`} style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={label}>Data checks</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span className={`${styles.display} ${styles.num}`} style={{ ...big, color: stats.dataChecks ? 'var(--warn-text)' : 'var(--ok-text)' }}>
              <CountUp value={stats.dataChecks} run={seen} />
            </span>
            {stats.dataChecks > 0 ? <Pill tone="warn">To look at</Pill> : <Pill tone="ok">All clear</Pill>}
          </div>
          <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13.5, color: 'var(--muted)' }}>Payment and C/$ don&apos;t quite agree; still used</span>
            {stats.dataChecks > 0 && (
              <button type="button" className={styles.btn} style={{ minHeight: 40, padding: '0 14px' }} onClick={() => onFilter('checks')}>
                Show them
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}

const DURATION_MS = 1500

/**
 * A number that counts up from 0 the first time `run` turns true, then just
 * shows its value: new figures (after an upload or undo) appear at once. React
 * owns the text throughout; the first render shows the final value (server,
 * reduced motion).
 */
export function CountUp({ value, decimals = 0, run = true }: { value: number; decimals?: number; run?: boolean }) {
  const [frame, setFrame] = useState<number | null>(null)
  const played = useRef(false)

  useEffect(() => {
    if (!run || played.current) return
    played.current = true
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    let raf = 0
    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / DURATION_MS)
      setFrame(t < 1 ? 1 - (1 - t) ** 3 : null)
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      setFrame(null)
    }
  }, [run])

  return <>{(frame === null ? value : value * frame).toFixed(decimals)}</>
}
