import { ClientIntakeView } from './view'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ id: string }>
}

/** The intake form: client, company and accountant details (view.tsx). In the SBR workspace. */
export default async function ClientIntakePage({ params }: Props) {
  const { id } = await params
  return ClientIntakeView({ id, workspace: 'sbr' })
}
