import { Bricolage_Grotesque, Figtree } from 'next/font/google'
import { PredictionDataClient } from '@/components/sbr/prediction-data/PredictionDataClient'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { loadPredictionData } from '@/lib/sbr/predictionData'

export const dynamic = 'force-dynamic'

// The page's own type, from its design: a display face for headings and
// numbers, Figtree for everything else. Loaded only on this page.
const display = Bricolage_Grotesque({ subsets: ['latin'], weight: ['500', '600', '700'], variable: '--font-pd-display' })
const body = Figtree({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-pd-body' })

/**
 * Prediction Data: the historical SBR cases the outcome prediction learns
 * from. Staff upload Gabby's workbook (or a CSV) to add cases; every upload
 * can be undone. Staff only, like the rest of the SBR workspace (proxy.ts).
 */
export default async function PredictionDataPage() {
  const data = await loadPredictionData(getSupabaseServerClient())

  return (
    <div className={`${display.variable} ${body.variable} min-h-full`}>
      <PredictionDataClient data={data} />
    </div>
  )
}
