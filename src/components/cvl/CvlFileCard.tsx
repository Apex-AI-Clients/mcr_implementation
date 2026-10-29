import Link from 'next/link'
import { ArrowRight, FileText, Gavel } from 'lucide-react'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import { CURRENT_VERSION, FORM_CODES, formVersion } from '@/lib/forms/registry'
import { CVL_ORIGIN_LABELS, type CvlCase } from '@/lib/cvl/cases'
import { formatDate } from '@/lib/utils'

interface CvlFileCardProps {
  clientId: string
  cvlCase: CvlCase
}

/** "1 Aug 2022" from ASIC's "20220801"; a year alone as it is. */
function versionLabel(version: string): string {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(version)
  return m ? formatDate(`${m[1]}-${m[2]}-${m[3]}`) : version
}

/**
 * The CVL half of a CVL client page: where the file came from, the three ASIC
 * forms, and the analyses the forms draw on. The analyses open inside the
 * CVL workspace (/cvl/[id]/…), on the same pages SBR uses.
 */
export function CvlFileCard({ clientId, cvlCase }: CvlFileCardProps) {
  const base = `/cvl/${clientId}`
  const analyses = [
    { href: `${base}/financials-comparison`, label: 'Financial statements comparison' },
    { href: `${base}/lodgement-compliance-analysis`, label: 'ATO activity statement account' },
    { href: `${base}/director-penalty-notices`, label: 'Director penalty notices' },
  ]

  return (
    <Card className="mb-6">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Gavel className="h-4 w-4 text-foreground/50" />
          <CardTitle>CVL file</CardTitle>
        </div>
      </CardHeader>

      <p className="mb-4 text-xs text-foreground/50">
        {CVL_ORIGIN_LABELS[cvlCase.origin]}
        {cvlCase.origin === 'sbr_client' && cvlCase.sbrArchivedAt ? (
          <>
            {' '}
            on {formatDate(cvlCase.sbrArchivedAt)}. The SBR record is kept read-only in the{' '}
            <Link href={`/sbr/archive/${clientId}`} className="text-accent hover:underline">
              SBR Archive
            </Link>
            .
          </>
        ) : (
          <> on {formatDate(cvlCase.createdAt)}.</>
        )}
      </p>

      <div className="grid gap-6 text-xs sm:grid-cols-2">
        <div>
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-foreground/40">ASIC forms</p>
          <ul className="space-y-2">
            {FORM_CODES.map((code) => {
              const { map } = formVersion(code)
              return (
                <li key={code} className="flex items-start gap-2">
                  <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-foreground/40" aria-hidden="true" />
                  <span>
                    <span className="text-foreground/80">{map.title}</span>
                    <span className="block text-foreground/40">
                      Version {versionLabel(CURRENT_VERSION[code])} · not started
                    </span>
                  </span>
                </li>
              )
            })}
          </ul>
        </div>

        <div>
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-foreground/40">Analyses</p>
          <ul className="space-y-2">
            {analyses.map((a) => (
              <li key={a.href}>
                <Link href={a.href} className="inline-flex items-center gap-1.5 text-accent hover:underline">
                  {a.label}
                  <ArrowRight className="h-3 w-3" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-foreground/40">Income tax and super guarantee accounts are listed under ATO accounts below.</p>
        </div>
      </div>
    </Card>
  )
}
