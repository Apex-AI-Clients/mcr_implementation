import type { getSupabaseServerClient } from '@/lib/supabase/server'
import { reanalyseStoredRows } from '@/lib/analysis/computeLateLodgement'
import { storedUnparsedDateRows, type AtoAccountsOverview } from '@/lib/analysis/atoAccount/store'
import { unparsedDateRows } from '@/lib/analysis/config'
import type { SuperGuaranteeSummary } from '@/lib/analysis/atoAccount/superGuarantee'
import { loadPrintedComparison } from '@/lib/printed/store'
import { loadMapping, withAutoMapping } from '@/lib/printed/mappingStore'
import { resolveMeaning } from '@/lib/printed/mapping'
import { summariseNotices } from '@/lib/dpn/summary'
import type { DpnPanelData } from '@/lib/dpn/view'
import {
  activityStatementExposure,
  directorLoanHistory,
  issuedByDirector,
  sgcExposure,
  type IssuedByDirector,
  type LoanYear,
  type PotentialByType,
} from './directorRisk'

type ServerClient = ReturnType<typeof getSupabaseServerClient>

/** Everything the director's risk panel shows, from what the app has already read. */
export interface DirectorRiskData {
  issued: IssuedByDirector[]
  /** PAYG withholding, GST and SGC, in that order. */
  potential: PotentialByType[]
  /** The activity statement the PAYG withholding and GST come from, when there is one. */
  activityStatement: { label: string | null; analysedAt: string } | null
  /** The super guarantee accounts the SGC comes from. */
  sgAccounts: string[]
  loans: LoanYear[]
  /** Null when any account's dates could not be read (`unreadable`): a total without it would be wrong. */
  totalAtoDebt: number | null
  /** unparsedDateRows above 0: the account's dates could not be read; balance and date are null. */
  accounts: { label: string; balance: number | null; balanceDate: string | null; unparsedDateRows: number }[]
  /** Every file whose dates could not be read, by account: shown as failed, never as figures. */
  unreadable: { label: string; rows: number }[]
}

export async function loadDirectorRisk(
  supabase: ServerClient,
  clientId: string,
  { dpn, atoAccounts }: { dpn: DpnPanelData; atoAccounts: AtoAccountsOverview },
): Promise<DirectorRiskData> {
  const sgIds = atoAccounts.accounts.filter((a) => a.kind === 'super_guarantee').map((a) => a.id)
  const [{ data: lodgement }, { data: sgRows }, comparison, stored] = await Promise.all([
    supabase
      .from('lodgement_analyses')
      // All columns: the unread-date count (0048) where it exists.
      .select('*')
      .eq('client_id', clientId)
      .order('analysed_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    sgIds.length
      ? supabase.from('ato_account_analyses').select('*').in('id', sgIds)
      : Promise.resolve({ data: [] as { account_label: string; summary: unknown; rows: unknown; unparsed_date_rows?: number }[] }),
    loadPrintedComparison(supabase, clientId),
    loadMapping(supabase, clientId),
  ])
  const { mapping } = await withAutoMapping(supabase, clientId, comparison, stored)

  // Today's code over the saved rows, as the lodgement report does.
  const fresh = lodgement ? reanalyseStoredRows(lodgement.rows) : null
  // Dates that could not be read: PAYG withholding and GST are not worked out from it (never read as on time).
  const asUnread = lodgement
    ? Math.max(fresh?.unparsedDateRows ?? unparsedDateRows(lodgement.rows), (lodgement as { unparsed_date_rows?: number }).unparsed_date_rows ?? 0)
    : 0
  const rows = asUnread > 0 ? [] : (fresh?.rows ?? [])
  // Super guarantee: an account whose dates could not be read gives no SGC figure at all.
  const sgUnread = (sgRows ?? []).reduce((n, r) => n + storedUnparsedDateRows(r as never), 0)
  const sgSummaries = (sgRows ?? [])
    .map((r) => r.summary as SuperGuaranteeSummary | null)
    .filter((s): s is SuperGuaranteeSummary => !!s && Array.isArray(s.quarters))

  const failed = (p: ReturnType<typeof sgcExposure>, unreadableRows: number) =>
    unreadableRows > 0 ? { ...p, onTime: 0, late: 0, items: [], unreadableRows } : p
  const potential = [
    ...activityStatementExposure(rows).map((p) => failed(p, asUnread)),
    failed(sgUnread > 0 ? sgcExposure([]) : sgcExposure(sgSummaries), sgUnread),
  ]

  const unreadable = [...atoAccounts.unreadable]
  if (asUnread > 0 && lodgement && !unreadable.some((u) => u.label.trim().toLowerCase() === (lodgement.statement_label ?? '').trim().toLowerCase())) {
    unreadable.push({ label: lodgement.statement_label ?? 'Activity statement', rows: asUnread })
  }

  return {
    issued: issuedByDirector(summariseNotices(dpn.notices, dpn.todayIso)),
    potential,
    activityStatement: lodgement ? { label: lodgement.statement_label, analysedAt: lodgement.analysed_at } : null,
    sgAccounts: (sgRows ?? []).map((r) => r.account_label),
    loans: directorLoanHistory((meaning) => resolveMeaning(comparison.comparison, mapping, meaning)),
    totalAtoDebt: unreadable.length > 0 ? null : atoAccounts.totalDebt,
    accounts: atoAccounts.accounts.map((a) => ({ label: a.label, balance: a.balance, balanceDate: a.balanceDate, unparsedDateRows: a.unparsedDateRows })),
    unreadable,
  }
}
