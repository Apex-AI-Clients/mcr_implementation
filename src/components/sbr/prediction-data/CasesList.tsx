'use client'

import type { RefObject } from 'react'
import { nameKey } from '@/lib/sbr/import/normalise'
import type { PredictionCaseRow } from '@/lib/sbr/predictionData'
import styles from './PredictionData.module.css'
import { IconChevron, IconSearch, IconWarn, ResultBadge, money, revealClass, useReveal } from './shared'

export type CaseFilter = 'all' | 'accepted' | 'rejected' | 'checks' | 'uploads'

export const CASE_FILTERS: { key: CaseFilter; label: string; test: (c: PredictionCaseRow) => boolean }[] = [
  { key: 'all', label: 'All', test: () => true },
  { key: 'accepted', label: 'Plan accepted', test: (c) => c.accepted },
  { key: 'rejected', label: 'Plan rejected', test: (c) => !c.accepted },
  { key: 'checks', label: 'Data checks', test: (c) => c.dataCheck },
  { key: 'uploads', label: 'Added by uploads', test: (c) => c.importId !== null },
]

/** The cases a filter and search leave, newest upload first. */
export function matchCases(cases: PredictionCaseRow[], filter: CaseFilter, query: string): PredictionCaseRow[] {
  const test = CASE_FILTERS.find((f) => f.key === filter)!.test
  const q = nameKey(query)
  const raw = query.trim().toLowerCase()
  return cases.filter(
    (c) =>
      test(c) &&
      (q === '' ||
        nameKey(c.clientName).includes(q) ||
        (c.businessType ?? '').toLowerCase().includes(raw) ||
        c.sourceLabel.toLowerCase().includes(raw)),
  )
}

/** What the prediction knows about a case: the 7 facts, plus what it owed and paid. */
export function caseFacts(c: PredictionCaseRow): { label: string; value: string }[] {
  const f = c.factors
  return [
    { label: 'Director Penalty Notice', value: f.dpn ? 'Yes' : 'No' },
    { label: 'Payment', value: f.paymentPlanType === 'plan' ? 'Payment plan' : 'Upfront' },
    { label: 'Director loan at appointment', value: f.directorLoanAtAppointment ? 'Yes' : 'No' },
    { label: 'Director loan amount', value: money(f.directorLoanReceivableAmount) },
    { label: 'Days late (total)', value: f.cumulativeDaysLate.toLocaleString('en-AU') },
    { label: 'Late lodgements', value: String(f.numberOfLateLodgements) },
    {
      label: 'Days since last payment',
      value: f.daysSinceLastPayment === null ? 'No payments ever' : f.daysSinceLastPayment.toLocaleString('en-AU'),
    },
  ]
}

export function dataCheckText(c: PredictionCaseRow): string {
  return `the SBR payment and C/$ mean creditors would get ${Math.round(c.share * 100)}% of the payment (expected 80–110%). The case is still used; worth checking the figures in the source file.`
}

const GRID = '2fr .75fr .95fr 1.1fr 1.25fr 32px'

interface Props {
  sectionRef: RefObject<HTMLElement | null>
  cases: PredictionCaseRow[]
  filter: CaseFilter
  onFilter: (f: CaseFilter) => void
  query: string
  onQuery: (q: string) => void
  openId: string | null
  onToggle: (id: string) => void
  limit: number
  onMore: () => void
  onClear: () => void
}

export function CasesList({ sectionRef, cases, filter, onFilter, query, onQuery, openId, onToggle, limit, onMore, onClear }: Props) {
  const [revealRef, seen] = useReveal<HTMLDivElement>()
  const matches = matchCases(cases, filter, query)
  const shown = matches.slice(0, limit)

  return (
    <section
      ref={sectionRef}
      id="past-cases"
      aria-labelledby="cases-title"
      style={{ scrollMarginTop: 24 }}
    >
      <div
        ref={revealRef}
        className={`${styles.card} ${revealClass(seen)}`}
        style={{ padding: '32px 24px 24px', display: 'flex', flexDirection: 'column', gap: 22 }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16, padding: '0 8px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <h2 id="cases-title" style={{ margin: 0, fontSize: 26 }}>
              Past cases
            </h2>
            <p style={{ margin: 0, color: 'var(--muted)', fontSize: 15.5 }}>
              Every case behind the predictions. Open a row to see its seven facts.
            </p>
          </div>
          <div style={{ position: 'relative', flex: '0 1 320px', minWidth: 220 }}>
            <label htmlFor="case-search" className="sr-only">
              Search cases
            </label>
            <span style={{ position: 'absolute', left: 14, top: 13, color: 'var(--faint)' }}>
              <IconSearch />
            </span>
            <input
              id="case-search"
              className={styles.search}
              type="search"
              placeholder="Search company, business type or upload"
              value={query}
              onChange={(e) => onQuery(e.target.value)}
            />
          </div>
        </div>

        <div role="group" aria-label="Filter cases" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: '0 8px' }}>
          {CASE_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              className={`${styles.chip}${filter === f.key ? ` ${styles.chipOn}` : ''}`}
              aria-pressed={filter === f.key}
              onClick={() => onFilter(f.key)}
            >
              {f.label} <span className={`${styles.ct} ${styles.num}`}>{cases.filter(f.test).length}</span>
            </button>
          ))}
        </div>

        <div style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: 860 }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: GRID,
                gap: 16,
                padding: '0 20px 12px',
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: '.06em',
                textTransform: 'uppercase',
                color: 'var(--faint)',
              }}
            >
              <span>Company</span>
              <span>Offer</span>
              <span>Total debt</span>
              <span>Creditors&apos; vote</span>
              <span>Came from</span>
              <span />
            </div>

            {shown.map((c) => {
              const open = openId === c.id
              return (
                <div key={c.id} className={styles.trow}>
                  <button type="button" className={styles.rowbtn} aria-expanded={open} onClick={() => onToggle(c.id)}>
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 650, fontSize: 15 }}>
                        {c.clientName}
                        {c.dataCheck && (
                          <span
                            title="Data check"
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4,
                              padding: '2px 8px',
                              borderRadius: 999,
                              background: 'var(--warn-soft)',
                              color: 'var(--warn-text)',
                              fontSize: 12,
                              fontWeight: 700,
                            }}
                          >
                            <IconWarn size={12} />
                            Check
                          </span>
                        )}
                        {c.excluded && <span style={{ fontSize: 12, color: 'var(--faint)' }}>Excluded</span>}
                      </span>
                      <span style={{ fontSize: 13, color: 'var(--faint)' }}>{c.businessType ?? 'Business type not recorded'}</span>
                    </span>
                    <span className={styles.num} style={{ fontWeight: 650 }}>
                      {c.outcomePercent.toFixed(1)}c
                    </span>
                    <span className={styles.num} style={{ color: 'var(--muted)', fontSize: 14.5 }}>
                      {money(c.creditorAmount)}
                    </span>
                    <span>
                      <ResultBadge accepted={c.accepted} />
                    </span>
                    <span style={{ color: 'var(--muted)', fontSize: 14 }}>{c.importId ? `Upload, ${c.sourceLabel.split(' · ').pop()}` : 'Initial data'}</span>
                    <span style={{ color: 'var(--faint)', transition: 'transform .25s ease', transform: `rotate(${open ? 180 : 0}deg)`, display: 'inline-flex' }}>
                      <IconChevron />
                    </span>
                  </button>
                  {open && (
                    <div className={styles.rise} style={{ padding: '4px 20px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                      {c.dataCheck && (
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 14,
                            padding: '14px 16px',
                            borderRadius: 14,
                            background: 'var(--warn-soft)',
                          }}
                        >
                          <span style={{ color: 'var(--warn-text)', flex: 'none', display: 'inline-flex' }}>
                            <IconWarn size={20} />
                          </span>
                          <span style={{ fontSize: 14.5, lineHeight: 1.45 }}>
                            <strong>Data check:</strong> {dataCheckText(c)}
                          </span>
                        </div>
                      )}
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
                        {caseFacts(c).map((fa) => (
                          <div
                            key={fa.label}
                            style={{
                              padding: '14px 16px',
                              borderRadius: 14,
                              background: 'var(--card2)',
                              border: '1px solid var(--line2)',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 5,
                            }}
                          >
                            <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--faint)' }}>{fa.label}</span>
                            <span className={styles.num} style={{ fontSize: 16, fontWeight: 650 }}>
                              {fa.value}
                            </span>
                          </div>
                        ))}
                      </div>
                      <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: 'var(--muted)' }}>
                        Owed creditors <strong style={{ color: 'var(--text)' }}>{money(c.creditorAmount)}</strong> and offered an SBR
                        payment of <strong style={{ color: 'var(--text)' }}>{money(c.sbrPayment)}</strong>, which is{' '}
                        <strong style={{ color: 'var(--text)' }}>{c.outcomePercent.toFixed(1)}c</strong> in the dollar to creditors.
                        Came from: {c.sourceLabel}.
                      </p>
                    </div>
                  )}
                </div>
              )
            })}

            {matches.length === 0 && (
              <div
                style={{
                  borderTop: '1px solid var(--line2)',
                  padding: '48px 20px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 12,
                  textAlign: 'center',
                }}
              >
                <span style={{ fontWeight: 650, fontSize: 16 }}>No cases match</span>
                <span style={{ color: 'var(--muted)', fontSize: 14.5 }}>Try a different search or filter.</span>
                <button type="button" className={styles.btn} onClick={onClear}>
                  Clear search and filters
                </button>
              </div>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '0 8px' }}>
          <span className={styles.num} style={{ fontSize: 14, color: 'var(--muted)' }}>
            Showing {shown.length} of {matches.length}
          </span>
          {matches.length > limit && (
            <button type="button" className={styles.btn} onClick={onMore}>
              Show 8 more
            </button>
          )}
        </div>
      </div>
    </section>
  )
}
