import { notFound } from 'next/navigation'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { IntakeClient } from '@/components/admin/intake/IntakeClient'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ id: string }>
}

export default async function ClientIntakePage({ params }: Props) {
  const { id } = await params
  const supabase = getSupabaseServerClient()

  const { data: client } = await supabase
    .from('clients')
    .select('id, name, email')
    .eq('id', id)
    .maybeSingle()

  if (!client) notFound()

  return (
    <IntakeClient clientId={client.id} initialName={client.name} initialEmail={client.email} />
  )
}
