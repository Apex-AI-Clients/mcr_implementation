'use client'

import { useState } from 'react'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { AsicExtractUpload } from '@/components/asic/AsicExtractUpload'
import {
  CompanyTrustSections,
  type IdentitySectionErrors,
} from '@/components/identity/CompanyTrustSections'
import { formatExtractDate } from '@/lib/asic/dates'
import {
  directorRowErrors,
  directorRows,
  directorsForSave,
  resolveOrigin,
  sourceLabel,
  type AsicFields,
  type SavedAsicOrigin,
} from '@/lib/asic/fill'
import type { Director } from '@/lib/asic/types'
import { identityForSave, validateIdentity } from '@/lib/clients/identity'
import {
  asicFieldsOf,
  changedKeys,
  commitChange,
  identityOf,
  withExtract,
  withoutExtract,
  type IdentityFormState,
} from '@/lib/clients/identityForm'
import { CheckCircle } from 'lucide-react'

export interface CompanyDetails {
  id?: string
  clientId?: string
  /** 'company', or 'trust' for a company acting as trustee. Absent before migration 0023. */
  entityType?: string | null
  companyName: string
  acnNumber: string
  /** The company's own ABN. */
  abnNumber: string
  trustName: string
  /** The trust's own ABN. Absent before migration 0023. */
  trustAbnNumber?: string | null
  phoneNumber: string
  emailAddress: string
  /**
   * From the ASIC company extract, or typed by hand. Optional on the type
   * because a record saved before migration 0022 was read without them.
   */
  registeredOfficeAddress?: string | null
  principalPlaceOfBusiness?: string | null
  directors?: Director[]
  asicExtractDate?: string | null
  companyDetailsSource?: string | null
}

/** The form's state: the shared company / trust state, plus the company's phone and email. */
interface IntakeCompanyState extends IdentityFormState {
  phoneNumber: string
  emailAddress: string
}

/** The three ASIC fields of a loaded record, as the form holds them. */
function asicFieldsOfRecord(record: CompanyDetails | null): AsicFields {
  return {
    registeredOfficeAddress: record?.registeredOfficeAddress ?? '',
    principalPlaceOfBusiness: record?.principalPlaceOfBusiness ?? '',
    directors: directorRows(record?.directors ?? []),
  }
}

function stateOf(record: CompanyDetails | null): IntakeCompanyState {
  return {
    entityType: record?.entityType === 'trust' ? 'trust' : 'company',
    companyName: record?.companyName ?? '',
    acnNumber: record?.acnNumber ?? '',
    abnNumber: record?.abnNumber ?? '',
    trustName: record?.trustName ?? '',
    trustAbnNumber: record?.trustAbnNumber ?? '',
    ...asicFieldsOfRecord(record),
    companyManual: false,
    trustManual: false,
    asicFill: null,
    trusteeOffer: null,
    phoneNumber: record?.phoneNumber ?? '',
    emailAddress: record?.emailAddress ?? '',
  }
}

/** Where a loaded record says its ASIC fields came from. */
function originOf(record: CompanyDetails | null): SavedAsicOrigin | null {
  if (!record) return null
  return {
    source: record.companyDetailsSource ?? null,
    extractedAt: record.asicExtractDate ?? null,
    fields: asicFieldsOfRecord(record),
  }
}

interface CompanyDetailsFormProps {
  clientId: string
  initial: CompanyDetails | null
  onComplete?: () => void
}

/**
 * The intake wizard's company step: the company, the trust when it is a
 * trustee, and the company's phone and email. Same sections and rules as lead
 * conversion (src/components/identity/CompanyTrustSections.tsx).
 */
export function CompanyDetailsForm({ clientId, initial, onComplete }: CompanyDetailsFormProps) {
  const [state, setState] = useState<IntakeCompanyState>(() => stateOf(initial))
  /** What the saved record says about where its ASIC fields came from. */
  const [origin, setOrigin] = useState<SavedAsicOrigin | null>(() => originOf(initial))
  const [errors, setErrors] = useState<IdentitySectionErrors>({})
  const [showDirectorErrors, setShowDirectorErrors] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(!!initial)
  const [error, setError] = useState('')

  /**
   * Adopt a record that turned up after this form mounted.
   *
   * The useState calls above read `initial` once, which is wrong the moment
   * another step writes this record — intake step 1 saves the ABN and ACN
   * behind a picked company name, and the reload that follows arrives here as a
   * changed prop, not a remount. Without this the form would keep showing the
   * empty boxes it was born with while the database held the values.
   *
   * Keyed on the record's identity rather than its contents, so a routine
   * reload of the same record never overwrites something half-typed. React
   * sanctions adjusting state during render like this — same pattern as
   * ClientsPageClient and ConvertToClientDialog, and no effect is needed.
   */
  const [adoptedId, setAdoptedId] = useState(initial?.id ?? null)
  if ((initial?.id ?? null) !== adoptedId) {
    setAdoptedId(initial?.id ?? null)
    setState(stateOf(initial))
    setOrigin(originOf(initial))
    setErrors({})
    setShowDirectorErrors(false)
    setSaved(!!initial)
    setError('')
  }

  // The source and date this save would record, worked out from what is on
  // screen now — so the line under the fields says ", edited" as soon as it is.
  const resolved = resolveOrigin(state.asicFill, origin, asicFieldsOf(state))

  function update(next: IntakeCompanyState, changed = changedKeys(state, next)) {
    setState(next)
    setSaved(false)
    if (changed.length === 0) return
    setErrors((current) => {
      const cleared = { ...current }
      for (const key of changed) delete cleared[key as keyof IdentitySectionErrors]
      return cleared
    })
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    const found = validateIdentity(identityOf(state))
    const directorsWrong = directorRowErrors(state.directors).some(Boolean)
    setErrors(found)
    setShowDirectorErrors(directorsWrong)
    if (Object.keys(found).length > 0 || directorsWrong) {
      setError('Check the fields marked above.')
      return
    }
    setSaving(true)

    try {
      const res = await fetch('/api/portal/company-details', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Every field this form renders, so a cleared box clears its column —
        // including directors, where an empty list means they were all removed.
        body: JSON.stringify({
          clientId,
          ...identityForSave(identityOf(state)),
          phoneNumber: state.phoneNumber,
          emailAddress: state.emailAddress,
          registeredOfficeAddress: state.registeredOfficeAddress.trim(),
          principalPlaceOfBusiness: state.principalPlaceOfBusiness.trim(),
          directors: directorsForSave(state.directors),
          asicExtractDate: resolved.extractedAt,
          companyDetailsSource: resolved.source,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        setError(data.error ?? 'Failed to save')
        setSaving(false)
        return
      }

      // What was just saved is now the record's own origin; the fill is no
      // longer something to undo.
      setOrigin({
        source: resolved.source,
        extractedAt: resolved.extractedAt,
        fields: asicFieldsOf(state),
      })
      setState((current) => ({ ...current, asicFill: null }))
      setShowDirectorErrors(false)
      setSaved(true)
      setSaving(false)
      onComplete?.()
    } catch {
      setError('Failed to save. Please try again.')
      setSaving(false)
    }
  }

  // Once saved, the banner gives way to a quiet line saying where these came from.
  const savedSource = state.asicFill
    ? null
    : sourceLabel(resolved.source, formatExtractDate(resolved.extractedAt))

  return (
    <div className="rounded-xl border border-border bg-surface/30 p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-foreground">Company and Trust Details</h3>
        {saved && (
          <span className="flex items-center gap-1 text-xs text-success">
            <CheckCircle className="h-3.5 w-3.5" /> Saved
          </span>
        )}
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <CompanyTrustSections
          idPrefix="company"
          value={state}
          errors={errors}
          showDirectorErrors={showDirectorErrors}
          disabled={saving}
          onChange={(next, changed) => update(next, changed)}
          afterIdentity={
            <AsicExtractUpload
              id="company-asic-extract"
              acnNumber={state.acnNumber}
              fill={state.asicFill}
              disabled={saving}
              onFill={(extract, mode) =>
                update(commitChange(withExtract(state, extract, mode), 'no_abn'))
              }
              onUndo={() => update(withoutExtract(state))}
            />
          }
          directorsFooter={
            savedSource && <p className="text-xs text-foreground/40">{savedSource}</p>
          }
          companyExtras={
            <>
              <Input
                id="company-phone"
                label="Company phone"
                type="tel"
                value={state.phoneNumber}
                disabled={saving}
                onChange={(e) => update({ ...state, phoneNumber: e.target.value })}
              />
              <Input
                id="company-email"
                label="Company email"
                type="email"
                value={state.emailAddress}
                disabled={saving}
                onChange={(e) => update({ ...state, emailAddress: e.target.value })}
              />
            </>
          }
        />

        {error && <p className="text-xs text-destructive">{error}</p>}

        <Button type="submit" loading={saving} size="sm" disabled={saved}>
          {saved ? 'Details Saved' : 'Save Details'}
        </Button>
      </form>
    </div>
  )
}
