/**
 * The company and the trust, as read-only screens show them: the lead record
 * card, the client page and the intake review. Kept apart, because they never
 * share a number — see src/lib/clients/identity.ts.
 *
 * The numbers are shown as stored: nothing in this app reformats an ACN or ABN
 * on display (see src/lib/abr/prefill.ts).
 */

/** Said instead of a blank, so a trustee with no ABN never reads as missing data. */
export const NO_OWN_ABN = 'No ABN of its own'

export interface StoredIdentity {
  entityType?: string | null
  companyName?: string | null
  acnNumber?: string | null
  abnNumber?: string | null
  trustName?: string | null
  trustAbnNumber?: string | null
}

export interface IdentityRow {
  label: string
  /** null when nothing is recorded. */
  value: string | null
  numeric: boolean
}

export interface IdentityDisplay {
  company: IdentityRow[]
  /** null when there is no trust: a Company with nothing recorded for one. */
  trust: IdentityRow[] | null
}

function text(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

export function identityDisplay(details: StoredIdentity): IdentityDisplay {
  const trustee = details.entityType === 'trust'
  const trustName = text(details.trustName)
  const trustAbn = text(details.trustAbnNumber)

  return {
    company: [
      { label: 'Company name', value: text(details.companyName), numeric: false },
      { label: 'ACN', value: text(details.acnNumber), numeric: true },
      {
        label: 'Company ABN',
        // A trustee company often has no ABN of its own, and that is an answer.
        // For a Company it is simply not recorded yet.
        value: text(details.abnNumber) ?? (trustee ? NO_OWN_ABN : null),
        numeric: true,
      },
    ],
    // A record saved before entity types can carry a trust name as a Company;
    // what is recorded is still shown.
    trust:
      trustee || trustName || trustAbn
        ? [
            { label: 'Trust name', value: trustName, numeric: false },
            { label: 'Trust ABN', value: trustAbn, numeric: true },
          ]
        : null,
  }
}
