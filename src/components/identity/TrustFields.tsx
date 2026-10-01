'use client'

import { Input } from '@/components/ui/Input'
import { EntityNameInput } from '@/components/abr/EntityNameInput'
import { RegisterLookupLink } from '@/components/abr/RegisterLookupLink'
import { ManualEntryCheckbox } from './ManualEntryCheckbox'
import type { AbrPrefill } from '@/lib/abr/types'

type TrustField = 'trustName' | 'trustAbnNumber'

interface TrustFieldsProps {
  idPrefix: string
  trustName: string
  trustAbnNumber: string
  trustManual: boolean
  errors: Partial<Record<TrustField, string>>
  disabled: boolean
  onField: (field: TrustField, value: string) => void
  onManual: (manual: boolean) => void
  /** A register match picked in the trust name box: fills the trust name and trust ABN only. */
  onPick: (prefill: AbrPrefill) => void
}

/**
 * The trust a company acts as trustee for: its name (an ABN Lookup search
 * unless this section's "Enter manually" is ticked) and its own ABN.
 *
 * A trust is not registered with ASIC and has no ACN, and the register does not
 * link it to its trustee — so it is looked up here, on its own name, separately
 * from the company. Nothing in this section ever changes a company field.
 */
export function TrustFields({
  idPrefix,
  trustName,
  trustAbnNumber,
  trustManual,
  errors,
  disabled,
  onField,
  onManual,
  onPick,
}: TrustFieldsProps) {
  return (
    <>
      <ManualEntryCheckbox
        id={`${idPrefix}-trust-manual`}
        checked={trustManual}
        disabled={disabled}
        onChange={onManual}
      />
      <EntityNameInput
        id={`${idPrefix}-trust-name`}
        label="Trust name"
        value={trustName}
        error={errors.trustName}
        disabled={disabled}
        searchDisabled={trustManual}
        onChange={(value) => onField('trustName', value)}
        onPick={onPick}
      />
      <Input
        id={`${idPrefix}-trust-abn`}
        label="Trust ABN"
        value={trustAbnNumber}
        error={errors.trustAbnNumber}
        hint={<RegisterLookupLink register="abr" value={trustAbnNumber} />}
        disabled={disabled}
        onChange={(event) => onField('trustAbnNumber', event.target.value)}
      />
    </>
  )
}
