import { DOCUMENT_CATEGORIES, isFinancialStatementCategory } from '@/lib/constants'
import { badgeText } from '@/lib/ica/view'
import type { DpnNoticeView } from '@/lib/dpn/view'
import type { PrintedComparison } from '@/lib/printed/compare'
import { comparisonProof, STATEMENTS_BADGE } from '@/lib/printed/proof'
import { columnTitle } from '@/lib/printed/csv'

/**
 * The client page's "Documents" proof list (Gabby, 18 Nov 2026): each uploaded ATO
 * file, notice and statement, with what was proven, or "Being prepared". Pure: the
 * proofs themselves are made elsewhere (src/lib/ica, dpn/proof.ts, printed/proof.ts);
 * this only says, per file, what they found.
 */

export type DocumentProofStatus =
  /** Proven: its figures are shown and used. */
  | 'proven'
  /** Shown as printed with a note; never blocks the prediction (an accountant's total that does not add up). */
  | 'as_printed'
  /** Not proven (yet): "Being prepared". */
  | 'being_prepared'
  /** Nothing to prove: an empty export, or a statement whose years later reports cover. */
  | 'not_used'

export interface DocumentProofRow {
  documentId: string
  filename: string
  kind: 'ato_account' | 'notice' | 'statement'
  /** "ATO activity statement", "Director penalty notice", "Financial statements". */
  kindLabel: string
  status: DocumentProofStatus
  /** What was proven ("Matches the ATO's own balance: …"), or why not, in plain words. */
  text: string
}

export interface DocumentProofInput {
  documents: { id: string; originalFilename: string; docCategory: string; uploadedAt: string }[]
  /** Each ATO file's newest check (lodgement_analyses / ato_account_analyses), by document id. */
  atoChecks: Map<string, { icaStatus: string | null; balance: number | null; balanceDate: string | null }>
  notices: DpnNoticeView[]
  comparison: PrintedComparison | null
}

export const BEING_PREPARED = 'Being prepared'

const ATO_KINDS: Record<string, string> = {
  [DOCUMENT_CATEGORIES.INTEGRATED_CLIENT_ACCOUNT]: 'ATO activity statement account',
  [DOCUMENT_CATEGORIES.ATO_INCOME_TAX_ACCOUNT]: 'ATO income tax account',
  [DOCUMENT_CATEGORIES.ATO_SUPER_GUARANTEE_ACCOUNT]: 'ATO super guarantee account',
}

export function documentProofs(input: DocumentProofInput): DocumentProofRow[] {
  const rows: DocumentProofRow[] = []
  const years = input.comparison ? comparisonProof(input.comparison) : []
  const noticeById = new Map(input.notices.map((n) => [n.documentId, n]))
  const useById = new Map((input.comparison?.documents ?? []).map((d) => [d.documentId, d]))

  for (const doc of [...input.documents].sort((a, b) => a.uploadedAt.localeCompare(b.uploadedAt))) {
    const base = { documentId: doc.id, filename: doc.originalFilename }

    const atoKind = ATO_KINDS[doc.docCategory]
    if (atoKind) {
      const check = input.atoChecks.get(doc.id)
      const row = { ...base, kind: 'ato_account' as const, kindLabel: atoKind }
      if (check?.icaStatus === 'verified' && check.balance !== null && check.balanceDate) {
        rows.push({ ...row, status: 'proven', text: badgeText(Math.round(check.balance * 100), check.balanceDate) })
      } else if (check?.icaStatus === 'empty') {
        rows.push({ ...row, status: 'not_used', text: 'The export has no rows' })
      } else {
        rows.push({ ...row, status: 'being_prepared', text: BEING_PREPARED })
      }
      continue
    }

    if (doc.docCategory === DOCUMENT_CATEGORIES.DIRECTOR_PENALTY_NOTICES) {
      const proof = noticeById.get(doc.id)?.proof ?? null
      const row = { ...base, kind: 'notice' as const, kindLabel: 'Director penalty notice' }
      if (proof?.status === 'verified') {
        rows.push({ ...row, status: 'proven', text: [proof.badges.join(' · '), proof.note].filter(Boolean).join('. ') })
      } else {
        rows.push({ ...row, status: 'being_prepared', text: BEING_PREPARED })
      }
      continue
    }

    if (isFinancialStatementCategory(doc.docCategory)) {
      const row = { ...base, kind: 'statement' as const, kindLabel: 'Financial statements' }
      const use = useById.get(doc.id)
      const own = years.filter((y) => y.documentIds.includes(doc.id))
      const title = (index: number) => columnTitle(input.comparison!.columns[index]).title
      if (!use || use.status === 'not_read' || use.status === 'scan_pending') {
        rows.push({ ...row, status: 'being_prepared', text: BEING_PREPARED })
      } else if (own.length === 0) {
        // Read, but no year's figures come from it (a later report prints them, or nothing was found).
        rows.push({ ...row, status: use.status === 'failed' ? 'being_prepared' : 'not_used', text: use.status === 'failed' ? BEING_PREPARED : (use.message ?? 'Not used: later reports cover its years') })
      } else if (own.some((y) => y.status === 'held')) {
        const held = own.filter((y) => y.status === 'held')
        rows.push({ ...row, status: 'being_prepared', text: `${BEING_PREPARED}: ${held.map((y) => title(y.index)).join(', ')} (${[...new Set(held.flatMap((y) => y.reasons))].join('; ')})` })
      } else if (own.some((y) => y.status === 'printed_error')) {
        const notes = own.flatMap((y) => y.notes)
        rows.push({ ...row, status: 'as_printed', text: `As printed: ${notes.length} printed total${notes.length === 1 ? ' does' : 's do'} not add up (${own.filter((y) => y.status === 'printed_error').map((y) => title(y.index)).join(', ')})` })
      } else {
        rows.push({ ...row, status: 'proven', text: `${STATEMENTS_BADGE} (${own.map((y) => title(y.index)).join(', ')})` })
      }
    }
  }
  return rows
}
