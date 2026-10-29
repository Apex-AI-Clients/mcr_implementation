import { notFound, redirect } from 'next/navigation'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { IntakeClient } from '@/components/admin/intake/IntakeClient'
import { clientBase, sharedPageRedirect, type ClientPageView } from '@/lib/clients/workspace'

export async function ClientIntakeView({ id, workspace }: ClientPageView) {
  const supabase = getSupabaseServerClient()

  const { data: client } = await supabase
    .from('clients')
    .select('id, name, email, phone, archived_at, workflow')
    .eq('id', id)
    .maybeSingle()

  if (!client) notFound()
  // An archived file is read in the Archive; a file in the other workspace
  // opens this page there.
  const elsewhere = sharedPageRedirect(client, workspace, '/intake')
  if (elsewhere) redirect(elsewhere)

  return (
    <IntakeClient
      clientId={client.id}
      basePath={clientBase(client.id, workspace)}
      initialName={client.name}
      initialEmail={client.email}
      initialPhone={client.phone ?? ''}
    />
  )
}
