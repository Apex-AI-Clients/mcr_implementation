import { LineMappingView } from './view'

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ id: string }>
}

/** Which printed lines mean what, confirmed by staff (view.tsx). In the SBR workspace. */
export default async function LineMappingPage({ params }: Props) {
  const { id } = await params
  return LineMappingView({ id, workspace: 'sbr' })
}
