'use client'

import type { ReactNode } from 'react'
import { Info } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { DirectorsFieldset } from '@/components/asic/DirectorsFieldset'
import { CompanyIdentityFields } from './CompanyIdentityFields'
import { TrustFields } from './TrustFields'
import { canMoveAbnToTrust, IDENTITY_ENTITY_LABELS, IDENTITY_ENTITY_TYPES } from '@/lib/clients/identity'
import {
  changedKeys,
  commitChange,
  identityOf,
  withAbnMovedToTrust,
  withAsicChoice,
  withEntityType,
  withPick,
  type IdentityFormState,
  type TrusteeOfferReason,
} from '@/lib/clients/identityForm'
import type { EntityType } from '@/types/leads'

export type IdentitySectionErrors = Partial<
  Record<'companyName' | 'acnNumber' | 'abnNumber' | 'trustName' | 'trustAbnNumber', string>
>

interface CompanyTrustSectionsProps<T extends IdentityFormState> {
  idPrefix: string
  value: T
  errors: IdentitySectionErrors
  /** Show every director row's error — after a save or convert was attempted. */
  showDirectorErrors: boolean
  disabled: boolean
  /** The next state, and the keys that changed (so their errors can be cleared). */
  onChange: (next: T, changed: (keyof T)[]) => void
  /** Rendered after the company ABN and the trust — the intake step's upload goes here. */
  afterIdentity?: ReactNode
  /** Under the directors, e.g. "From ASIC extract as at …". */
  directorsFooter?: ReactNode
  /** The end of the company section, e.g. the company phone and email. */
  companyExtras?: ReactNode
}

const OFFER_TEXT: Record<TrusteeOfferReason, string> = {
  no_abn: 'No ABN on this extract. If this company is a trustee, add the trust below.',
  trust_pick:
    "That's a trust, so it went into the trust fields. If this company is its trustee, switch the entity type to Trust.",
  moved: 'Moved to the trust ABN. If this company is a trustee, switch the entity type to Trust.',
}

/**
 * The company and the trust. One layout for lead conversion and the intake
 * company step:
 *
 *   Company: entity type · "Enter manually" · name · ACN · company ABN ·
 *            Trust · registered office · principal place of business · directors
 *   Trust:   "Enter manually" · trust name · trust ABN — always shown, straight
 *            under the company ABN; required for "Trust", optional for "Company"
 *
 * Owns the wiring — register picks, Use ASIC / Keep, the move to the trust ABN
 * and the trustee offer — through the pure steps in identityForm.ts, and hands
 * the parent each next state. The ASIC upload stays with the parent, which
 * decides where it sits.
 */
export function CompanyTrustSections<T extends IdentityFormState>({
  idPrefix,
  value,
  errors,
  showDirectorErrors,
  disabled,
  onChange,
  afterIdentity,
  directorsFooter,
  companyExtras,
}: CompanyTrustSectionsProps<T>) {
  const trustee = value.entityType === 'trust'

  function update(next: T) {
    onChange(next, changedKeys(value, next))
  }

  function patch(change: Partial<IdentityFormState>) {
    update({ ...value, ...change })
  }

  return (
    <>
      <Section legend="Company">
        <Select
          id={`${idPrefix}-entity-type`}
          label="Entity type"
          value={value.entityType}
          disabled={disabled}
          onChange={(event) => update(withEntityType(value, event.target.value as EntityType))}
          options={IDENTITY_ENTITY_TYPES.map((type) => ({
            value: type,
            label: IDENTITY_ENTITY_LABELS[type],
          }))}
        />

        {value.trusteeOffer && !trustee && (
          <div
            role="status"
            className="space-y-2 rounded-lg border border-accent/30 bg-accent/10 p-3 text-sm leading-relaxed text-foreground/80"
          >
            <p className="flex items-start gap-2">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
              {OFFER_TEXT[value.trusteeOffer]}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                disabled={disabled}
                onClick={() => update(withEntityType(value, 'trust'))}
              >
                Switch to &ldquo;{IDENTITY_ENTITY_LABELS.trust}&rdquo;
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={disabled}
                onClick={() => patch({ trusteeOffer: null })}
              >
                Not a trustee
              </Button>
            </div>
          </div>
        )}

        <CompanyIdentityFields
          idPrefix={idPrefix}
          values={value}
          companyManual={value.companyManual}
          trustee={trustee}
          comparisons={value.asicFill?.identity?.fields}
          canMoveToTrust={canMoveAbnToTrust(identityOf(value))}
          errors={errors}
          disabled={disabled}
          onField={(field, text) => patch({ [field]: text })}
          onManual={(companyManual) => patch({ companyManual })}
          onPick={(prefill) => update(commitChange(withPick(value, 'company', prefill), 'trust_pick'))}
          onAsicChoice={(field, choice) => update(withAsicChoice(value, field, choice))}
          onMoveToTrust={() => update(commitChange(withAbnMovedToTrust(value), 'moved'))}
        />

        {/* Right under the company ABN, so the two ABNs are read together. */}
        <SubSection legend="Trust">
          {!trustee && (
            <p className="text-xs text-foreground/50">
              Fill it in if the company acts as trustee of a trust.
            </p>
          )}
          <TrustFields
            idPrefix={idPrefix}
            trustName={value.trustName}
            trustAbnNumber={value.trustAbnNumber}
            trustManual={value.trustManual}
            errors={errors}
            disabled={disabled}
            onField={(field, text) => patch({ [field]: text })}
            onManual={(trustManual) => patch({ trustManual })}
            onPick={(prefill) => update(withPick(value, 'trust', prefill).form)}
          />
        </SubSection>

        {afterIdentity}

        <Input
          id={`${idPrefix}-registered-office`}
          label="Registered office (optional)"
          value={value.registeredOfficeAddress}
          disabled={disabled}
          onChange={(event) => patch({ registeredOfficeAddress: event.target.value })}
        />
        <Input
          id={`${idPrefix}-principal-place`}
          label="Principal place of business (optional)"
          value={value.principalPlaceOfBusiness}
          disabled={disabled}
          onChange={(event) => patch({ principalPlaceOfBusiness: event.target.value })}
        />
        <DirectorsFieldset
          idPrefix={idPrefix}
          rows={value.directors}
          disabled={disabled}
          showErrors={showDirectorErrors}
          onChange={(directors) => patch({ directors })}
        />
        {directorsFooter}
        {companyExtras}
      </Section>
    </>
  )
}

function Section({ legend, children }: { legend: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-3">
      <legend className="text-xs font-medium uppercase tracking-wide text-foreground/40">
        {legend}
      </legend>
      {children}
    </fieldset>
  )
}

/** A group inside a section — the trust, inside the company. */
function SubSection({ legend, children }: { legend: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-3 rounded-lg border border-border p-3">
      <legend className="px-1 text-xs font-medium uppercase tracking-wide text-foreground/40">
        {legend}
      </legend>
      {children}
    </fieldset>
  )
}
