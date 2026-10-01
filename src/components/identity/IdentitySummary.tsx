'use client'

import { identityDisplay, type StoredIdentity } from '@/lib/clients/identityDisplay'

/**
 * Who the client is, as saved on the company step: the company and, for a
 * trustee, the trust — each with its own ABN.
 */
export function IdentitySummary({
  details,
  onEdit,
}: {
  details: StoredIdentity
  onEdit: () => void
}) {
  const identity = identityDisplay(details)
  const groups = [
    { heading: 'Company', rows: identity.company },
    ...(identity.trust ? [{ heading: 'Trust', rows: identity.trust }] : []),
  ]

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-foreground">Company and trust</h4>
        <button
          type="button"
          onClick={onEdit}
          className="text-xs font-medium text-accent hover:underline"
        >
          Edit
        </button>
      </div>
      <div className="grid gap-3 rounded-xl border border-border bg-surface/30 p-4 sm:grid-cols-2">
        {groups.map((group) => (
          <section key={group.heading} aria-label={group.heading}>
            <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-foreground/40">
              {group.heading}
            </p>
            <dl className="space-y-1.5 text-xs">
              {group.rows.map((row) => (
                <div key={row.label} className="flex justify-between gap-3">
                  <dt className="text-foreground/40">{row.label}</dt>
                  <dd
                    className={`min-w-0 break-words text-right text-foreground/80 ${
                      row.numeric ? 'tabular-nums' : ''
                    }`}
                  >
                    {row.value || '—'}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </div>
  )
}
