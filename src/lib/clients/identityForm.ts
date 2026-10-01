import {
  applyExtract,
  chooseAsicValue,
  keepFormValue,
  undoFill,
  type AsicFields,
  type AsicFill,
  type IdentityField,
  type IdentityFillMode,
} from '@/lib/asic/fill'
import type { AsicExtract } from '@/lib/asic/types'
import type { AbrPrefill } from '@/lib/abr/types'
import { identityPatchForPick, moveAbnToTrust, type IdentityFields } from './identity'

/**
 * The company / trust part of a form, as state — shared by lead conversion and
 * the intake company step, so both forms change it with the same pure steps.
 *
 * Each step returns the next state. Nothing here switches the entity type: a
 * step that implies a trustee records why in `trusteeOffer`, and the form shows
 * the offer until it is taken or dismissed.
 */

/** Why the form is offering the Trust entity type. */
export type TrusteeOfferReason =
  /** The ASIC extract has no ABN line — usual for a company that only acts as trustee. */
  | 'no_abn'
  /** A trust was picked from the company name box. */
  | 'trust_pick'
  /** The company ABN was moved to the trust ABN. */
  | 'moved'

export interface IdentityFormState extends IdentityFields, AsicFields {
  /** "Enter manually (don't search ABN Lookup)" for the company section. Not saved. */
  companyManual: boolean
  /** The same, for the trust section. Not saved. */
  trustManual: boolean
  /** The extract fill currently applied, for undo and for the saved source. */
  asicFill: AsicFill | null
  /** Shown while the form is a Company and something implied a trustee. */
  trusteeOffer: TrusteeOfferReason | null
}

/** The fields one of these steps can change, for clearing their errors. */
export type IdentityStateKey = keyof IdentityFormState

/** The keys whose values differ between two states — the errors to clear after a change. */
export function changedKeys<T extends object>(before: T, after: T): (keyof T)[] {
  return (Object.keys(after) as (keyof T)[]).filter((key) => before[key] !== after[key])
}

/** The three fields an ASIC extract fills, as the form holds them now. */
export function asicFieldsOf(state: AsicFields): AsicFields {
  return {
    registeredOfficeAddress: state.registeredOfficeAddress,
    principalPlaceOfBusiness: state.principalPlaceOfBusiness,
    directors: state.directors,
  }
}

/** The company and trust fields, as the shared identity rules take them. */
export function identityOf(state: IdentityFields): IdentityFields {
  return {
    entityType: state.entityType,
    companyName: state.companyName,
    acnNumber: state.acnNumber,
    abnNumber: state.abnNumber,
    trustName: state.trustName,
    trustAbnNumber: state.trustAbnNumber,
  }
}

/**
 * A step's result. `suggestTrustee` is the offer to switch the entity type;
 * the form never switches on its own.
 */
export interface FormChange<T> {
  form: T
  suggestTrustee: boolean
}

/**
 * A change, with its offer recorded on the state. An offer already showing
 * stays until it is taken or dismissed.
 */
export function commitChange<T extends IdentityFormState>(
  change: FormChange<T>,
  reason: TrusteeOfferReason,
): T {
  if (!change.suggestTrustee) return change.form
  return { ...change.form, trusteeOffer: reason }
}

/** Switch to (or away from) the trustee entity type; any offer is answered by it. */
export function withEntityType<T extends IdentityFormState>(
  state: T,
  entityType: IdentityFormState['entityType'],
): T {
  return { ...state, entityType, trusteeOffer: null }
}

/**
 * Fill from an ASIC extract: addresses and directors always; company name, ACN
 * and company ABN into empty boxes (or over them, in 'replace' mode after an
 * ACN mismatch was confirmed). Never the trust fields. An extract with no ABN
 * suggests the trustee entity type to a Company form.
 *
 * Applying a second extract first undoes the first, so undo always returns to
 * what was typed.
 */
export function withExtract<T extends IdentityFormState>(
  state: T,
  extract: AsicExtract,
  mode: IdentityFillMode = 'merge',
): FormChange<T> {
  const base: T = state.asicFill ? { ...state, ...undoFill(state.asicFill), asicFill: null } : state
  const fill = applyExtract(asicFieldsOf(base), extract, { current: identityOf(base), mode })
  return {
    form: { ...base, ...fill.filled, ...fill.identity?.filled, asicFill: fill },
    suggestTrustee: Boolean(fill.identity?.noAbn) && base.entityType === 'company',
  }
}

/** "Use ASIC" or "Keep" on a field the extract disagreed with. */
export function withAsicChoice<T extends IdentityFormState>(
  state: T,
  field: IdentityField,
  choice: 'asic' | 'keep',
): T {
  if (!state.asicFill) return state
  if (choice === 'keep') return { ...state, asicFill: keepFormValue(state.asicFill, field) }
  const { patch, fill } = chooseAsicValue(state.asicFill, field, identityOf(state))
  return { ...state, ...patch, asicFill: fill }
}

/** Undo the extract: every field it changed goes back, name/ACN/ABN included. */
export function withoutExtract<T extends IdentityFormState>(state: T): T {
  if (!state.asicFill) return state
  // An offer that only the extract made goes with it.
  const trusteeOffer = state.trusteeOffer === 'no_abn' ? null : state.trusteeOffer
  return { ...state, ...undoFill(state.asicFill), asicFill: null, trusteeOffer }
}

/** A register match picked in the company or trust name box. */
export function withPick<T extends IdentityFormState>(
  state: T,
  box: 'company' | 'trust',
  prefill: AbrPrefill,
): FormChange<T> {
  const { patch, suggestTrustee } = identityPatchForPick(box, prefill, state)
  return { form: { ...state, ...patch }, suggestTrustee }
}

/** [Move to trust ABN] next to a company ABN that is not the company's. */
export function withAbnMovedToTrust<T extends IdentityFormState>(state: T): FormChange<T> {
  const { patch, suggestTrustee } = moveAbnToTrust(identityOf(state))
  return { form: { ...state, ...patch }, suggestTrustee }
}
