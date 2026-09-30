'use client'

import { useState } from 'react'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { EntityNameInput } from '@/components/abr/EntityNameInput'
import { RegisterLookupLink } from '@/components/abr/RegisterLookupLink'
import { prefillFor } from '@/lib/abr/prefill'
import type { AbrPrefill } from '@/lib/abr/types'
import { AsicExtractUpload } from '@/components/asic/AsicExtractUpload'
import { DirectorsFieldset } from '@/components/asic/DirectorsFieldset'
import { formatExtractDate } from '@/lib/asic/dates'
import {
  applyExtract,
  directorRowErrors,
  directorRows,
  directorsForSave,
  resolveOrigin,
  sourceLabel,
  type AsicFields,
  type AsicFill,
  type SavedAsicOrigin,
} from '@/lib/asic/fill'
import type { AsicExtract, Director } from '@/lib/asic/types'
import { CheckCircle } from 'lucide-react'

export interface CompanyDetails {
  id?: string
  clientId?: string
  companyName: string
  acnNumber: string
  abnNumber: string
  trustName: string
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

/** The three ASIC fields of a loaded record, as the form holds them. */
function asicFieldsOf(record: CompanyDetails | null): AsicFields {
  return {
    registeredOfficeAddress: record?.registeredOfficeAddress ?? '',
    principalPlaceOfBusiness: record?.principalPlaceOfBusiness ?? '',
    directors: directorRows(record?.directors ?? []),
  }
}

/** Where a loaded record says those fields came from. */
function originOf(record: CompanyDetails | null): SavedAsicOrigin | null {
  if (!record) return null
  return {
    source: record.companyDetailsSource ?? null,
    extractedAt: record.asicExtractDate ?? null,
    fields: asicFieldsOf(record),
  }
}

interface CompanyDetailsFormProps {
  clientId: string
  initial: CompanyDetails | null
  onComplete?: () => void
}

export function CompanyDetailsForm({ clientId, initial, onComplete }: CompanyDetailsFormProps) {
  const [companyName, setCompanyName] = useState(initial?.companyName ?? '')
  const [acnNumber, setAcnNumber] = useState(initial?.acnNumber ?? '')
  const [abnNumber, setAbnNumber] = useState(initial?.abnNumber ?? '')
  const [trustName, setTrustName] = useState(initial?.trustName ?? '')
  const [phoneNumber, setPhoneNumber] = useState(initial?.phoneNumber ?? '')
  const [emailAddress, setEmailAddress] = useState(initial?.emailAddress ?? '')
  // The fields an ASIC extract fills. Editable here for every client, which is
  // how one converted before the upload existed gets them at all.
  const [asicFields, setAsicFields] = useState<AsicFields>(() => asicFieldsOf(initial))
  /** A fill made in this sitting, undoable until it is saved. */
  const [asicFill, setAsicFill] = useState<AsicFill | null>(null)
  /** What the saved record says about where those fields came from. */
  const [origin, setOrigin] = useState<SavedAsicOrigin | null>(() => originOf(initial))
  const [showDirectorErrors, setShowDirectorErrors] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(!!initial)
  const [error, setError] = useState('')

  /**
   * Adopt a record that turned up after this form mounted.
   *
   * The useState calls above read `initial` once, which is wrong the moment
   * another step writes this record — intake step 1 now saves the ABN and ACN
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
    setCompanyName(initial?.companyName ?? '')
    setAcnNumber(initial?.acnNumber ?? '')
    setAbnNumber(initial?.abnNumber ?? '')
    setTrustName(initial?.trustName ?? '')
    setPhoneNumber(initial?.phoneNumber ?? '')
    setEmailAddress(initial?.emailAddress ?? '')
    setAsicFields(asicFieldsOf(initial))
    setAsicFill(null)
    setOrigin(originOf(initial))
    setShowDirectorErrors(false)
    setSaved(!!initial)
    setError('')
  }

  // The source and date this save would record, worked out from what is on
  // screen now — so the line under the fields says ", edited" as soon as it is.
  const resolved = resolveOrigin(asicFill, origin, asicFields)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (directorRowErrors(asicFields.directors).some(Boolean)) {
      setShowDirectorErrors(true)
      setError('Check the directors above.')
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
          companyName,
          acnNumber,
          abnNumber,
          trustName,
          phoneNumber,
          emailAddress,
          registeredOfficeAddress: asicFields.registeredOfficeAddress.trim(),
          principalPlaceOfBusiness: asicFields.principalPlaceOfBusiness.trim(),
          directors: directorsForSave(asicFields.directors),
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
      setOrigin({ source: resolved.source, extractedAt: resolved.extractedAt, fields: asicFields })
      setAsicFill(null)
      setShowDirectorErrors(false)
      setSaved(true)
      setSaving(false)
      onComplete?.()
    } catch {
      setError('Failed to save. Please try again.')
      setSaving(false)
    }
  }

  function markDirty() {
    setSaved(false)
  }

  /**
   * Fill from a register match picked in one of the two name fields.
   *
   * Every value it writes is one somebody can immediately type over — this form
   * saves on its own button, so a wrong prefill is corrected before anything is
   * stored. Absent keys are left alone rather than blanked: ABR has no ACN for a
   * trust, and wiping one that was already typed would be a loss.
   *
   * Phone and email are untouched, because neither is on the public register.
   */
  function applyLookup(searchedIn: 'companyName' | 'trustName', prefill: AbrPrefill) {
    const next = prefillFor(searchedIn, prefill)

    if (next.companyName !== undefined) setCompanyName(next.companyName)
    if (next.trustName !== undefined) setTrustName(next.trustName)
    if (next.abnNumber) setAbnNumber(next.abnNumber)
    if (next.acnNumber !== undefined) setAcnNumber(next.acnNumber)
    markDirty()
  }

  function patchAsic(change: Partial<AsicFields>) {
    setAsicFields((current) => ({ ...current, ...change }))
    markDirty()
  }

  /**
   * Fill from an uploaded ASIC extract: the two addresses and the directors,
   * and nothing else. The company name, ACN and ABN stay with the register
   * lookup above and the keyboard.
   */
  function applyAsicExtract(extract: AsicExtract) {
    const fill = applyExtract(asicFields, extract)
    setAsicFields(fill.filled)
    setAsicFill(fill)
    setShowDirectorErrors(false)
    markDirty()
  }

  function undoAsicFill() {
    if (!asicFill) return
    setAsicFields(asicFill.previous)
    setAsicFill(null)
    markDirty()
  }

  // Once saved, the banner gives way to a quiet line saying where these came from.
  const savedSource = asicFill
    ? null
    : sourceLabel(resolved.source, formatExtractDate(resolved.extractedAt))

  return (
    <div className="rounded-xl border border-border bg-surface/30 p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-foreground">Company or Trust Details</h3>
        {saved && (
          <span className="flex items-center gap-1 text-xs text-success">
            <CheckCircle className="h-3.5 w-3.5" /> Saved
          </span>
        )}
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        <EntityNameInput
          id="company-name"
          label="Name of Company"
          value={companyName}
          disabled={saving}
          onChange={(value) => { setCompanyName(value); markDirty() }}
          onPick={(prefill) => applyLookup('companyName', prefill)}
        />
        <Input
          id="acn-number"
          label="ACN Number"
          value={acnNumber}
          hint={<RegisterLookupLink register="asic" />}
          onChange={(e) => { setAcnNumber(e.target.value); markDirty() }}
        />
        <Input
          id="abn-number"
          label="ABN Number"
          value={abnNumber}
          hint={<RegisterLookupLink register="abr" value={abnNumber} />}
          onChange={(e) => { setAbnNumber(e.target.value); markDirty() }}
        />
        <AsicExtractUpload
          id="company-asic-extract"
          acnNumber={acnNumber}
          fill={asicFill}
          disabled={saving}
          onFill={applyAsicExtract}
          onUndo={undoAsicFill}
        />
        <Input
          id="company-registered-office"
          label="Registered Office Address"
          value={asicFields.registeredOfficeAddress}
          onChange={(e) => patchAsic({ registeredOfficeAddress: e.target.value })}
        />
        <Input
          id="company-principal-place"
          label="Principal Place of Business"
          value={asicFields.principalPlaceOfBusiness}
          onChange={(e) => patchAsic({ principalPlaceOfBusiness: e.target.value })}
        />
        <DirectorsFieldset
          idPrefix="company"
          rows={asicFields.directors}
          disabled={saving}
          showErrors={showDirectorErrors}
          onChange={(directors) => patchAsic({ directors })}
        />
        {savedSource && <p className="text-xs text-foreground/40">{savedSource}</p>}
        <EntityNameInput
          id="trust-name"
          label="Name of Trust"
          value={trustName}
          disabled={saving}
          onChange={(value) => { setTrustName(value); markDirty() }}
          onPick={(prefill) => applyLookup('trustName', prefill)}
        />
        <Input
          id="company-phone"
          label="Phone Number"
          type="tel"
          value={phoneNumber}
          onChange={(e) => { setPhoneNumber(e.target.value); markDirty() }}
        />
        <Input
          id="company-email"
          label="Email Address"
          type="email"
          value={emailAddress}
          onChange={(e) => { setEmailAddress(e.target.value); markDirty() }}
        />

        {error && <p className="text-xs text-destructive">{error}</p>}

        <Button type="submit" loading={saving} size="sm" disabled={saved}>
          {saved ? 'Details Saved' : 'Save Details'}
        </Button>
      </form>
    </div>
  )
}
