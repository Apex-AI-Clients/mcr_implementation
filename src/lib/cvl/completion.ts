import type { getSupabaseServerClient } from '@/lib/supabase/server'

type ServerClient = ReturnType<typeof getSupabaseServerClient>

/**
 * CVL forms marked complete (migration 0063, 18 Nov 2026): a completed form cannot be edited until
 * "Unlock forms". Keys are `${formCode}|${subject}`. Server only.
 */
export const completionKey = (formCode: string, subject: string) => `${formCode}|${subject}`

/** The case's completed forms; none before 0063 is applied. */
export async function loadCompletedForms(supabase: ServerClient, caseId: string): Promise<Map<string, { by: string; at: string }>> {
  const { data, error } = await supabase.from('cvl_form_completions').select('form_code, subject, completed_by, completed_at').eq('case_id', caseId)
  if (error) return new Map()
  return new Map((data ?? []).map((r) => [completionKey(r.form_code, r.subject), { by: r.completed_by, at: r.completed_at }]))
}

export async function isFormCompleted(supabase: ServerClient, caseId: string, formCode: string, subject: string): Promise<boolean> {
  return (await loadCompletedForms(supabase, caseId)).has(completionKey(formCode, subject))
}
