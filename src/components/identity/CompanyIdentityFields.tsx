'use client'

import { ArrowDown } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { EntityNameInput } from '@/components/abr/EntityNameInput'
import { RegisterLookupLink } from '@/components/abr/RegisterLookupLink'
import { AsicComparisonNote } from './AsicComparisonNote'
import { ManualEntryCheckbox } from './ManualEntryCheckbox'
import { useAbnByAcn } from './useAbnByAcn'
import { describeAcnAbnOutcome } from '@/lib/abr/acnAbn'
import type { AbrPrefill } from '@/lib/abr/types'
import type { IdentityComparison, IdentityField } from '@/lib/asic/fill'
import type { CompanyIdentity } from '@/lib/clients/identity'

interface CompanyIdentityFieldsProps {
  idPrefix: string
  values: CompanyIdentity
  companyManual: boolean
  /** Entity type "Trust" (the company is a trustee): its own ABN becomes optional. */
  trustee: boolean
  /** How each field stands against the applied ASIC extract, if any. */
  comparisons?: Record<IdentityField, IdentityComparison>
  /** Offer [Move to trust ABN] next to the company ABN. */
  canMoveToTrust: boolean
  errors: Partial<Record<IdentityField, string>>
  disabled: boolean
  onField: (field: IdentityField, value: string) => void
  onManual: (manual: boolean) => void
  /** A register match picked in the company name box. */
  onPick: (prefill: AbrPrefill) => void
  onAsicChoice: (field: IdentityField, choice: 'asic' | 'keep') => void
  onMoveToTrust: () => void
}

/**
 * The company: name (an ABN Lookup search unless "Enter manually" is ticked),
 * ACN and the company's OWN ABN.
 *
 * Under each field, how it stands against an applied ASIC extract. Under the
 * ABN, either [Move to trust ABN] — when what is there does not end with the
 * ACN, so cannot be the company's — or, with the ABN empty, what the register
 * says about an ABN for this ACN.
 */
export function CompanyIdentityFields({
  idPrefix,
  values,
  companyManual,
  trustee,
  comparisons,
  canMoveToTrust,
  errors,
  disabled,
  onField,
  onManual,
  onPick,
  onAsicChoice,
  onMoveToTrust,
}: CompanyIdentityFieldsProps) {
  const registerAbn = useAbnByAcn({ companyManual, ...values })

  function note(field: IdentityField) {
    return (
      <AsicComparisonNote
        field={field}
        comparison={comparisons?.[field]}
        value={values[field]}
        disabled={disabled}
        onChoice={(choice) => onAsicChoice(field, choice)}
      />
    )
  }

  return (
    <>
      <ManualEntryCheckbox
        id={`${idPrefix}-company-manual`}
        checked={companyManual}
        disabled={disabled}
        onChange={onManual}
      />
      <div className="space-y-1.5">
        <EntityNameInput
          id={`${idPrefix}-company-name`}
          label="Company name"
          value={values.companyName}
          error={errors.companyName}
          disabled={disabled}
          searchDisabled={companyManual}
          onChange={(value) => onField('companyName', value)}
          onPick={onPick}
        />
        {note('companyName')}
      </div>
      <div className="space-y-1.5">
        <Input
          id={`${idPrefix}-acn`}
          label="ACN"
          value={values.acnNumber}
          error={errors.acnNumber}
          hint={<RegisterLookupLink register="asic" />}
          disabled={disabled}
          onChange={(event) => onField('acnNumber', event.target.value)}
        />
        {note('acnNumber')}
      </div>
      <div className="space-y-1.5">
        <Input
          id={`${idPrefix}-abn`}
          label={trustee ? 'Company ABN (if the company has its own)' : 'Company ABN'}
          value={values.abnNumber}
          error={errors.abnNumber}
          hint={<RegisterLookupLink register="abr" value={values.abnNumber} />}
          disabled={disabled}
          onChange={(event) => onField('abnNumber', event.target.value)}
        />
        {canMoveToTrust && (
          <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={onMoveToTrust}>
            <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
            Move to trust ABN
          </Button>
        )}
        {note('abnNumber')}
        {registerAbn && (
          <RegisterAbnLine
            outcome={registerAbn}
            disabled={disabled}
            onUse={(abn) => onField('abnNumber', abn)}
          />
        )}
      </div>
    </>
  )
}

function RegisterAbnLine({
  outcome,
  disabled,
  onUse,
}: {
  outcome: NonNullable<ReturnType<typeof useAbnByAcn>>
  disabled: boolean
  onUse: (abn: string) => void
}) {
  const text = describeAcnAbnOutcome(outcome)
  if (!text) return null

  if (outcome.kind === 'found') {
    return (
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={disabled}
        onClick={() => onUse(outcome.abn)}
      >
        {text}
      </Button>
    )
  }

  if (outcome.kind === 'cancelled') {
    // Cancelled ABNs are everyday in insolvency work: say so, and let staff decide.
    return (
      <div
        role="status"
        className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-destructive/30 bg-destructive/10 px-2.5 py-1.5 text-xs text-foreground/80"
      >
        <span className="min-w-0 flex-1">{text}.</span>
        <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={() => onUse(outcome.abn)}>
          Use it anyway
        </Button>
      </div>
    )
  }

  return <p className="text-xs text-foreground/50">{text}</p>
}
