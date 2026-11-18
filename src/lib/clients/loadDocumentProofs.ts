import type { getSupabaseServerClient } from '@/lib/supabase/server'
import { isFinancialStatementCategory } from '@/lib/constants'
import type { DpnNoticeView } from '@/lib/dpn/view'
import { loadPrintedComparison } from '@/lib/printed/store'
import { documentProofs, type DocumentProofInput, type DocumentProofRow } from './documentProofs'

type ServerClient = ReturnType<typeof getSupabaseServerClient>

/**
 * The stored proofs behind the client page's "Documents" list (documentProofs.ts): each ATO
 * file's check, and the comparison from the stored reads (no PDF is read here). The notices'
 * proofs come with the page's notice views.
 */
export async function loadDocumentProofs(
  supabase: ServerClient,
  clientId: string,
  { documents, notices }: { documents: DocumentProofInput['documents']; notices: DpnNoticeView[] },
): Promise<DocumentProofRow[]> {
  const select = 'document_id, analysed_at, ica_status, ica_balance, ica_balance_date'
  const [{ data: lodgement }, { data: accounts }, comparison] = await Promise.all([
    supabase.from('lodgement_analyses').select(select).eq('client_id', clientId),
    supabase.from('ato_account_analyses').select(select).eq('client_id', clientId),
    documents.some((d) => isFinancialStatementCategory(d.docCategory))
      ? loadPrintedComparison(supabase, clientId).then((p) => p.comparison)
      : Promise.resolve(null),
  ])
  const atoChecks: DocumentProofInput['atoChecks'] = new Map()
  const newest = new Map<string, string>()
  for (const row of [...(lodgement ?? []), ...(accounts ?? [])]) {
    if ((newest.get(row.document_id) ?? '') > (row.analysed_at ?? '')) continue
    newest.set(row.document_id, row.analysed_at ?? '')
    atoChecks.set(row.document_id, {
      icaStatus: row.ica_status,
      balance: row.ica_balance === null ? null : Number(row.ica_balance),
      balanceDate: row.ica_balance_date,
    })
  }
  return documentProofs({ documents, atoChecks, notices, comparison })
}
