'use client'

import { useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useToast } from '@/components/ui/Toast'
import type { ImportHistoryEntry } from '@/lib/sbr/import/store'
import type { PredictionData } from '@/lib/sbr/predictionData'
import { BehindTheNumbers } from './BehindTheNumbers'
import { CaseExplorer } from './CaseExplorer'
import { CASE_FILTERS, CasesList, matchCases, type CaseFilter } from './CasesList'
import { DataToday } from './DataToday'
import { CaseDialog, GlossaryDialog, UndoDialog } from './Dialogs'
import { HeroExplainer } from './HeroExplainer'
import styles from './PredictionData.module.css'
import { IconDownload, IconInfo, IconUpload } from './shared'
import { GUIDED_UPLOAD } from './config'
import { SimpleUploadDialog } from './SimpleUploadDialog'
import { UploadDialog } from './UploadDialog'
import { UploadHistory } from './UploadHistory'

/**
 * The Prediction Data page (design: Claude Design, 13 Oct 2026). The past
 * SBRs the outcome prediction learns from: how they are used, the headline
 * numbers, a chart to explore them, the list, the upload history with undo,
 * and the working behind the accuracy and risk bands. Light and dark follow
 * the app's theme (switched from the sidebar).
 */
export function PredictionDataClient({ data }: { data: PredictionData }) {
  const router = useRouter()
  const { toast } = useToast()

  const [uploadOpen, setUploadOpen] = useState(false)
  const [glossaryOpen, setGlossaryOpen] = useState(false)
  const [caseId, setCaseId] = useState<string | null>(null)
  const [undoTarget, setUndoTarget] = useState<ImportHistoryEntry | null>(null)
  const [undoing, setUndoing] = useState<string | null>(null)
  const [undoError, setUndoError] = useState<string | null>(null)

  // Shared by the chart (highlight) and the list.
  const [filter, setFilter] = useState<CaseFilter>('all')
  const [query, setQuery] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [limit, setLimit] = useState(8)
  const casesRef = useRef<HTMLElement>(null)

  const highlight = useMemo(() => {
    if (filter === 'all' && query.trim() === '') return null
    return new Set(matchCases(data.cases, filter, query).map((c) => c.id))
  }, [data.cases, filter, query])
  const filterLabel = CASE_FILTERS.find((f) => f.key === filter)!.label
  const highlightLabel = filter !== 'all' ? `“${filterLabel}”${query.trim() ? ' + search' : ''}` : `search “${query.trim()}”`

  const scrollToCases = () => casesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  const pickFilter = (f: CaseFilter) => {
    setFilter(f)
    setLimit(8)
    setOpenId(null)
  }
  const clearFilters = () => {
    setFilter('all')
    setQuery('')
    setLimit(8)
  }
  const findInTable = (id: string) => {
    setCaseId(null)
    clearFilters()
    // Bring the case into the shown rows and open it.
    const index = data.cases.findIndex((c) => c.id === id)
    setLimit(Math.max(8, Math.ceil((index + 1) / 8) * 8))
    setOpenId(id)
    setTimeout(scrollToCases, 50)
  }

  async function undo() {
    if (!undoTarget) return
    setUndoing(undoTarget.id)
    setUndoError(null)
    try {
      const res = await fetch(`/api/admin/sbr/case-imports/${undoTarget.id}/undo`, { method: 'POST' })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        setUndoError(body?.error ?? 'The upload could not be undone. Nothing was changed.')
        return
      }
      const { deleted, restored } = (await res.json()) as { deleted: number; restored: number }
      setUndoTarget(null)
      toast(`Upload undone: ${deleted} ${deleted === 1 ? 'case' : 'cases'} removed${restored ? `, ${restored} put back` : ''}.`)
      router.refresh()
    } catch {
      setUndoError('The upload could not be undone. Nothing was changed.')
    } finally {
      setUndoing(null)
    }
  }

  const modalOpen = uploadOpen || glossaryOpen || caseId !== null || undoTarget !== null
  const openCase = caseId ? (data.cases.find((c) => c.id === caseId) ?? null) : null

  return (
    <div className={styles.pd}>
      <main className={styles.main}>
        {/* 1 · Header */}
        <header style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-start', gap: 28 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, flex: '1 1 420px', minWidth: 0 }}>
            <div className={styles.eyebrow} style={{ color: 'var(--accent-text)' }}>
              SBR outcome predictions
            </div>
            <h1 style={{ margin: 0, fontSize: 46, lineHeight: 1.04 }}>Prediction data</h1>
            <p style={{ margin: 0, fontSize: 17, lineHeight: 1.55, color: 'var(--muted)', maxWidth: 600 }}>
              The past Small Business Restructurings our predictions are built from. Add new cases, check them, and see
              exactly how they are used.
            </p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 14, maxWidth: '100%' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'flex-end' }}>
              <a className={styles.btn} href="/api/admin/sbr/case-imports/template">
                <IconDownload />
                Download template
              </a>
              <button type="button" className={`${styles.btn} ${styles.primary}`} onClick={() => setUploadOpen(true)}>
                <IconUpload />
                Upload data <span style={{ fontWeight: 500, opacity: 0.82 }}>(CSV or Excel)</span>
              </button>
              <button
                type="button"
                className={`${styles.btn} ${styles.iconBtn}`}
                aria-label="Glossary: what the words on this page mean"
                title="Glossary"
                onClick={() => setGlossaryOpen(true)}
              >
                <IconInfo size={20} />
              </button>
            </div>
            <ol
              aria-label="How uploading works"
              style={{
                listStyle: 'none',
                margin: 0,
                padding: 0,
                display: 'flex',
                flexWrap: 'wrap',
                justifyContent: 'flex-end',
                alignItems: 'center',
                gap: 8,
                fontSize: 13,
                color: 'var(--faint)',
              }}
            >
              <li>Upload</li>
              <li aria-hidden="true" style={{ opacity: 0.6 }}>
                ›
              </li>
              <li>We check every row</li>
              <li aria-hidden="true" style={{ opacity: 0.6 }}>
                ›
              </li>
              {GUIDED_UPLOAD ? (
                <>
                  <li>You review</li>
                  <li aria-hidden="true" style={{ opacity: 0.6 }}>
                    ›
                  </li>
                  <li>Confirm</li>
                </>
              ) : (
                <li>Saved, and can be undone</li>
              )}
            </ol>
          </div>
        </header>

        {/* 2 · Hero */}
        <HeroExplainer
          total={data.stats.total}
          accepted={data.stats.accepted}
          rejected={data.stats.rejected}
          accuracy={data.accuracy?.meanAbsoluteError ?? null}
          hold={modalOpen}
        />

        {/* 3 · The data today */}
        <DataToday
          stats={data.stats}
          accuracy={data.accuracy?.meanAbsoluteError ?? null}
          onFilter={(f) => {
            pickFilter(f)
            setQuery('')
            scrollToCases()
          }}
        />

        {/* 4 · Explore */}
        <CaseExplorer
          cases={data.cases}
          highlight={highlight}
          highlightLabel={highlightLabel}
          onClearHighlight={clearFilters}
          onOpen={setCaseId}
        />

        {/* 5 · Past cases */}
        <CasesList
          sectionRef={casesRef}
          cases={data.cases}
          filter={filter}
          onFilter={pickFilter}
          query={query}
          onQuery={(q) => {
            setQuery(q)
            setLimit(8)
            setOpenId(null)
          }}
          openId={openId}
          onToggle={(id) => setOpenId((o) => (o === id ? null : id))}
          limit={limit}
          onMore={() => setLimit((l) => l + 8)}
          onClear={clearFilters}
        />

        {/* 6 · Upload history */}
        <UploadHistory
          history={data.history}
          initialCases={data.stats.initialCases}
          busyId={undoing}
          onUndo={(entry) => {
            setUndoError(null)
            setUndoTarget(entry)
          }}
        />

        {/* 7 · Behind the numbers */}
        <BehindTheNumbers growth={data.growth} accuracy={data.accuracy} />
      </main>

      {GUIDED_UPLOAD ? (
        <UploadDialog
          open={uploadOpen}
          onClose={() => setUploadOpen(false)}
          onImported={({ importId, counts }) => {
            setUploadOpen(false)
            toast(
              importId
                ? `${counts.added} ${counts.added === 1 ? 'case' : 'cases'} added${counts.corrected ? `, ${counts.corrected} corrected` : ''}. Predictions now use them.`
                : 'Nothing to import: the file matches the stored cases.',
            )
            router.refresh()
          }}
        />
      ) : (
        // The simple upload for the demo: it shows its own result, then the
        // page's figures refresh behind it.
        <SimpleUploadDialog open={uploadOpen} onClose={() => setUploadOpen(false)} onImported={() => router.refresh()} />
      )}
      <GlossaryDialog open={glossaryOpen} onClose={() => setGlossaryOpen(false)} />
      <CaseDialog c={openCase} onClose={() => setCaseId(null)} onFind={findInTable} />
      <UndoDialog
        entry={undoTarget}
        busy={undoing !== null}
        error={undoError}
        onClose={() => setUndoTarget(null)}
        onConfirm={() => void undo()}
      />
    </div>
  )
}
