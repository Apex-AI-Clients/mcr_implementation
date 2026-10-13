'use client'

import type { ImportHistoryEntry } from '@/lib/sbr/import/store'
import { formatDate } from '@/lib/utils'
import styles from './PredictionData.module.css'
import { IconFile, IconUndo, Pill, revealClass, useReveal } from './shared'

interface Props {
  history: ImportHistoryEntry[]
  /** Cases that came with the initial data, for the last row. */
  initialCases: number
  busyId: string | null
  onUndo: (entry: ImportHistoryEntry) => void
}

const COLS = '1fr 1.6fr 1fr .8fr .8fr .9fr .9fr 120px'
const cell = { color: 'var(--muted)', fontSize: 14.5 } as const

/**
 * The uploads in force, newest first, then the initial data. An undone upload
 * is left out: its cases are gone, so there is nothing of it to show (the
 * record stays in sbr_case_imports).
 */
export function UploadHistory({ history, initialCases, busyId, onUndo }: Props) {
  const [ref, seen] = useReveal<HTMLElement>()
  const inForce = history.filter((h) => h.undoneAt === null)

  return (
    <section
      ref={ref}
      aria-labelledby="history-title"
      className={`${styles.card} ${revealClass(seen)}`}
      style={{ padding: '32px 24px 20px', display: 'flex', flexDirection: 'column', gap: 20 }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '0 8px' }}>
        <h2 id="history-title" style={{ margin: 0, fontSize: 26 }}>
          Upload history
        </h2>
        <p style={{ margin: 0, color: 'var(--muted)', fontSize: 15.5, lineHeight: 1.5 }}>
          Any upload can be undone: the cases it added are removed and any figures it corrected are put back.
        </p>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: 960 }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: COLS,
              gap: 16,
              padding: '0 20px 12px',
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: '.06em',
              textTransform: 'uppercase',
              color: 'var(--faint)',
            }}
          >
            <span>Date</span>
            <span>File</span>
            <span>Uploaded by</span>
            <span title="New past cases added">Added</span>
            <span title="Stored cases whose figures were corrected">Corrected</span>
            <span title="Rows that failed a check and were not saved">Not imported</span>
            <span>Status</span>
            <span />
          </div>

          {inForce.map((h) => {
            const c = h.counts
            return (
              <div key={h.id} className={styles.hrow} style={{ gridTemplateColumns: COLS }}>
                <span className={styles.num} style={{ fontWeight: 600 }}>
                  {formatDate(h.uploadedAt)}
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                  <span
                    style={{
                      flex: 'none',
                      width: 34,
                      height: 34,
                      borderRadius: 9,
                      display: 'grid',
                      placeItems: 'center',
                      background: 'var(--card2)',
                      border: '1px solid var(--line2)',
                      color: 'var(--muted)',
                    }}
                  >
                    <IconFile size={16} />
                  </span>
                  <span title={h.fileName} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 14.5 }}>
                    {h.fileName}
                  </span>
                </span>
                <span style={cell}>{h.uploadedBy}</span>
                <span className={styles.num} style={{ fontWeight: 650 }}>
                  {c.added ?? 0}
                </span>
                <span className={styles.num} style={cell}>
                  {c.corrected ? c.corrected : '—'}
                </span>
                <span className={styles.num} style={cell}>
                  {c.rejected ? `${c.rejected} ${c.rejected === 1 ? 'row' : 'rows'}` : '—'}
                </span>
                <span>
                  <Pill tone="accent">In use</Pill>
                </span>
                <span style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    className={`${styles.btn} ${styles.quiet}`}
                    style={{ minHeight: 40, padding: '0 12px' }}
                    aria-label={`Undo upload ${h.fileName}`}
                    disabled={busyId !== null}
                    onClick={() => onUndo(h)}
                  >
                    <IconUndo size={16} />
                    {busyId === h.id ? 'Undoing…' : 'Undo'}
                  </button>
                </span>
              </div>
            )
          })}

          <div className={styles.hrow} style={{ gridTemplateColumns: COLS }}>
            <span style={{ fontWeight: 600, color: 'var(--muted)' }}>—</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span
                style={{
                  flex: 'none',
                  width: 34,
                  height: 34,
                  borderRadius: 9,
                  display: 'grid',
                  placeItems: 'center',
                  background: 'var(--card2)',
                  border: '1px solid var(--line2)',
                  color: 'var(--muted)',
                }}
              >
                <IconFile size={16} />
              </span>
              <span style={{ fontSize: 14.5 }}>Initial data</span>
            </span>
            <span style={cell}>—</span>
            <span className={styles.num} style={{ fontWeight: 650 }}>
              {initialCases}
            </span>
            <span style={cell}>—</span>
            <span style={cell}>—</span>
            <span>
              <Pill tone="accent">In use</Pill>
            </span>
            <span style={{ display: 'flex', justifyContent: 'flex-end', fontSize: 13, color: 'var(--faint)', paddingRight: 12 }}>
              Original data
            </span>
          </div>
        </div>
      </div>
    </section>
  )
}
