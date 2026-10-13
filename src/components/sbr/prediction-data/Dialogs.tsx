'use client'

import { Dialog } from '@/components/ui/Dialog'
import type { ImportHistoryEntry } from '@/lib/sbr/import/store'
import type { PredictionCaseRow } from '@/lib/sbr/predictionData'
import { formatDate } from '@/lib/utils'
import { caseFacts, dataCheckText } from './CasesList'
import styles from './PredictionData.module.css'
import { IconUndo, ResultBadge, money } from './shared'

const eyebrow = (text: string, colour = 'var(--accent-text)') => (
  <div className={styles.eyebrow} style={{ color: colour, marginBottom: 6 }}>
    {text}
  </div>
)
const titleClass = `${styles.display} text-2xl`

/**
 * The words this page uses, in plain English. Two things are easy to mix up,
 * so they never share a word: a past case's result is "plan accepted / plan
 * rejected" (the creditors' vote), and an uploaded row that fails a check is
 * "not imported".
 */
export const GLOSSARY: { term: string; def: string }[] = [
  { term: 'SBR', def: 'Small Business Restructuring: an eligible business offers creditors a plan to pay part of what it owes.' },
  { term: 'Plan accepted', def: 'Creditors (usually the ATO) voted for the restructuring plan. Shown as a green circle.' },
  { term: 'Plan rejected', def: 'Creditors voted against the plan. Shown as a red triangle. These are kept on purpose: they teach the prediction what a risky profile looks like.' },
  { term: 'Cents in the dollar (C/$)', def: 'How much of each dollar owed the plan offered creditors, after the practitioner fee. 39c means 39 cents for every dollar.' },
  { term: 'The seven facts', def: 'DPN issued, upfront or payment plan, director loan at appointment, director loan amount, days late (total), late lodgements, and days since the last payment. Similarity is measured on all seven at once.' },
  { term: 'Nearest matches', def: 'The 8 past cases most similar to a new client. Their average offer is the recommended offer; how many were rejected sets the risk band.' },
  { term: 'Risk band', def: 'Likely accepted, Borderline or High rejection risk, from how many of the 8 nearest matches were rejected. Indicative, not a probability.' },
  { term: 'Typical accuracy', def: 'How far a prediction usually lands from the real result, measured by predicting each past case from all the others.' },
  { term: 'Data check', def: "A case whose SBR payment and C/$ don't quite agree. It is still used; worth checking the figures." },
  { term: 'Not imported', def: 'A row in an upload that failed a check, so it was left out. It is about the row, not the result. Fix it in your file and upload again.' },
  { term: 'Correction', def: 'A case we already have, with different figures in your file. Only applied if you tick it.' },
]

export function GlossaryDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} title="What the words mean" titleClassName={titleClass} eyebrow={eyebrow('Glossary')} className="max-w-[660px] rounded-3xl p-8">
      <dl style={{ margin: '6px 0 0', display: 'flex', flexDirection: 'column' }}>
        {GLOSSARY.map((g) => (
          <div key={g.term} style={{ display: 'grid', gridTemplateColumns: 'minmax(140px, 190px) 1fr', gap: 16, padding: '14px 0', borderTop: '1px solid var(--line2)' }}>
            <dt style={{ fontWeight: 700, fontSize: 14.5, color: 'var(--text)' }}>{g.term}</dt>
            <dd style={{ margin: 0, fontSize: 14.5, lineHeight: 1.55, color: 'var(--muted)' }}>{g.def}</dd>
          </div>
        ))}
      </dl>
    </Dialog>
  )
}

export function CaseDialog({
  c,
  onClose,
  onFind,
}: {
  c: PredictionCaseRow | null
  onClose: () => void
  onFind: (id: string) => void
}) {
  return (
    <Dialog
      open={c !== null}
      onClose={onClose}
      title={c?.clientName ?? ''}
      titleClassName={titleClass}
      eyebrow={c ? eyebrow(`${c.businessType ?? 'Past case'} · creditors ${c.accepted ? 'accepted' : 'rejected'} the plan`, 'var(--faint)') : null}
      className="max-w-[580px] rounded-3xl p-8"
    >
      {c && (
        <>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: 18,
              margin: '4px 0 20px',
              padding: '18px 20px',
              borderRadius: 16,
              background: 'var(--card2)',
              border: '1px solid var(--line2)',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span className={`${styles.display} ${styles.num}`} style={{ fontSize: 40, fontWeight: 700, lineHeight: 1, letterSpacing: '-.03em', color: 'var(--text)' }}>
                {c.outcomePercent.toFixed(1)}c
              </span>
              <span style={{ fontSize: 13, color: 'var(--muted)' }}>
                in the dollar · {money(c.sbrPayment)} on {money(c.creditorAmount)} owed
              </span>
            </div>
            <span style={{ marginLeft: 'auto' }}>
              <ResultBadge accepted={c.accepted} />
            </span>
          </div>
          {c.dataCheck && (
            <div style={{ marginBottom: 16, padding: '14px 16px', borderRadius: 14, background: 'var(--warn-soft)', fontSize: 14.5, lineHeight: 1.45, color: 'var(--text)' }}>
              <strong>Data check:</strong> {dataCheckText(c)}
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
            {caseFacts(c).map((fa) => (
              <div key={fa.label} style={{ padding: '12px 14px', borderRadius: 12, border: '1px solid var(--line2)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--faint)' }}>{fa.label}</span>
                <span className={styles.num} style={{ fontSize: 15.5, fontWeight: 650, color: 'var(--text)' }}>
                  {fa.value}
                </span>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginTop: 22 }}>
            <span style={{ fontSize: 13.5, color: 'var(--muted)' }}>{c.importId ? `Added by upload: ${c.sourceLabel}` : 'Part of the initial data'}</span>
            <button type="button" className={styles.btn} onClick={() => onFind(c.id)}>
              Find in table
            </button>
          </div>
        </>
      )}
    </Dialog>
  )
}

export function UndoDialog({
  entry,
  busy,
  error,
  onClose,
  onConfirm,
}: {
  entry: ImportHistoryEntry | null
  busy: boolean
  error: string | null
  onClose: () => void
  onConfirm: () => void
}) {
  const added = entry?.counts.added ?? 0
  const corrected = entry?.counts.corrected ?? 0
  return (
    <Dialog
      open={entry !== null}
      onClose={busy ? () => {} : onClose}
      title="Undo this upload?"
      titleClassName={titleClass}
      eyebrow={
        <span style={{ width: 48, height: 48, borderRadius: 14, display: 'grid', placeItems: 'center', background: 'var(--bad-soft)', color: 'var(--bad-text)', marginBottom: 14 }}>
          <IconUndo size={22} />
        </span>
      }
      className="max-w-[480px] rounded-3xl p-8"
    >
      {entry && (
        <>
          <p style={{ margin: 0, fontSize: 15, lineHeight: 1.55, color: 'var(--muted)' }}>
            The <strong style={{ color: 'var(--text)' }}>{added} cases</strong> from {entry.fileName} ({formatDate(entry.uploadedAt)}) will be removed
            {corrected > 0 && (
              <>
                {' '}
                and the <strong style={{ color: 'var(--text)' }}>{corrected} figures</strong> it corrected put back
              </>
            )}
            . Predictions stop using them straight away and should be re-run. To add them again, upload the file again.
          </p>
          {error && (
            <p role="alert" style={{ margin: '14px 0 0', fontSize: 14, color: 'var(--bad-text)' }}>
              {error}
            </p>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 26 }}>
            <button type="button" className={styles.btn} onClick={onClose} disabled={busy}>
              Keep it
            </button>
            <button type="button" className={`${styles.btn} ${styles.danger}`} onClick={onConfirm} disabled={busy}>
              {busy ? 'Undoing…' : 'Undo upload'}
            </button>
          </div>
        </>
      )}
    </Dialog>
  )
}
