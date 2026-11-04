import type { getSupabaseServerClient } from '@/lib/supabase/server'
import { reanalyseStoredRows } from '@/lib/analysis/computeLateLodgement'
import type { AtoAccountsOverview } from '@/lib/analysis/atoAccount/store'
import type { SuperGuaranteeSummary } from '@/lib/analysis/atoAccount/superGuarantee'
import { loadPrintedComparison } from '@/lib/printed/store'
import { loadMapping } from '@/lib/printed/mappingStore'
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
  totalAtoDebt: number | null
  accounts: { label: string; balance: number | null; balanceDate: string | null }[]
}

export async function loadDirectorRisk(
  supabase: ServerClient,
  clientId: string,
  { dpn, atoAccounts }: { dpn: DpnPanelData; atoAccounts: AtoAccountsOverview },
): Promise<DirectorRiskData> {
  const sgIds = atoAccounts.accounts.filter((a) => a.kind === 'super_guarantee').map((a) => a.id)
  const [{ data: lodgement }, { data: sgRows }, comparison, mapping] = await Promise.all([
    supabase
      .from('lodgement_analyses')
      .select('rows, statement_label, analysed_at')
      .eq('client_id', clientId)
      .order('analysed_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    sgIds.length
      ? supabase.from('ato_account_analyses').select('account_label, summary').in('id', sgIds)
      : Promise.resolve({ data: [] as { account_label: string; summary: unknown }[] }),
    loadPrintedComparison(supabase, clientId),
    loadMapping(supabase, clientId),
  ])

  // Today's code over the saved rows, as the lodgement report does.
  const rows = lodgement ? (reanalyseStoredRows(lodgement.rows)?.rows ?? []) : []
  const sgSummaries = (sgRows ?? [])
    .map((r) => r.summary as SuperGuaranteeSummary | null)
    .filter((s): s is SuperGuaranteeSummary => !!s && Array.isArray(s.quarters))

  return {
    issued: issuedByDirector(summariseNotices(dpn.notices, dpn.todayIso)),
    potential: [...activityStatementExposure(rows), sgcExposure(sgSummaries)],
    activityStatement: lodgement ? { label: lodgement.statement_label, analysedAt: lodgement.analysed_at } : null,
    sgAccounts: (sgRows ?? []).map((r) => r.account_label),
    loans: directorLoanHistory((meaning) => resolveMeaning(comparison.comparison, mapping, meaning)),
    totalAtoDebt: atoAccounts.totalDebt,
    accounts: atoAccounts.accounts.map((a) => ({ label: a.label, balance: a.balance, balanceDate: a.balanceDate })),
  }
}
