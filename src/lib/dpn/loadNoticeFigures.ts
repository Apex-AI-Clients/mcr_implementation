import type { getSupabaseServerClient } from '@/lib/supabase/server'
import { DOCUMENT_CATEGORIES } from '@/lib/constants'
import { readDirectors } from '@/lib/clients/companyDetails'
import { buildDpnPanel, sydneyToday } from './view'
import { summariseNotices } from './summary'
import { dpnNoticeFigures, type DpnNoticeFigures } from './noticeFigures'

type ServerClient = ReturnType<typeof getSupabaseServerClient>

/**
 * The client's director penalty notices' figures (noticeFigures.ts), read
 * from storage the same way the DPN page reads them. Null when no notice on
 * file has figures. Server only.
 */
export async function loadDpnNoticeFigures(supabase: ServerClient, clientId: string): Promise<DpnNoticeFigures | null> {
  const [{ data: docs }, { data: noticeRows }, { data: company }] = await Promise.all([
    supabase
      .from('documents')
      .select('id, original_filename')
      .eq('client_id', clientId)
      .eq('doc_category', DOCUMENT_CATEGORIES.DIRECTOR_PENALTY_NOTICES),
    supabase.from('director_penalty_notices').select('*').eq('client_id', clientId),
    supabase.from('company_details').select('acn_number, directors').eq('client_id', clientId).maybeSingle(),
  ])
  if (!docs?.length || !noticeRows?.length) return null
  const todayIso = sydneyToday()
  const panel = buildDpnPanel({
    documents: docs.map((d) => ({ id: d.id, originalFilename: d.original_filename })),
    noticeRows,
    client: { no_dpn_confirmed_at: null, no_dpn_confirmed_by: null, no_dpn_cleared_note: null },
    file: { acn: company?.acn_number ?? null, directors: readDirectors(company?.directors) },
    todayIso,
  })
  return dpnNoticeFigures(summariseNotices(panel.notices, todayIso))
}
