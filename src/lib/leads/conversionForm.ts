import { formatPhone, isValidEmail } from './format'
import { directorRowErrors, directorsForSave, sourceFor, type DirectorRow } from '@/lib/asic/fill'
import { identityForSave, validateIdentity } from '@/lib/clients/identity'
import {
  asicFieldsOf,
  identityOf,
  type IdentityFormState,
  type TrusteeOfferReason,
} from '@/lib/clients/identityForm'
import type { EntityType, Lead } from '@/types/leads'

/**
 * The details a lead has to carry before it can become a client file.
 *
 * These are the same fields as steps 1 and 2 of the SBR intake wizard, asked
 * once at conversion instead of after it. The point is that a file is never
 * created half-known: what used to be a two-field confirmation now collects
 * everything intake needs, and intake opens pre-filled from it.
 */
export interface ConversionForm extends IdentityFormState {
  /** Step 1 — the client record itself. */
  name: string
  email: string
  /**
   * The client's own number — the lead's phone, carried over. Optional, and
   * not the company or trust line, which is `phoneNumber` below.
   */
  phone: string
  /**
   * 'company', or 'trust' meaning "a company acting as trustee of a trust".
   * Decides whether the trust fields are shown and which ABN is required.
   */
  entityType: EntityType
  /** Step 2 — the company, and the trust when it is a trustee. See src/lib/clients/identity.ts. */
  companyName: string
  acnNumber: string
  /** The company's OWN ABN — never the trust's. Optional for a trustee. */
  abnNumber: string
  trustName: string
  trustAbnNumber: string
  /**
   * "Enter manually (don't search ABN Lookup)", one per section. Ticked: no
   * name suggestions in that section and — for the company — no ABN-by-ACN
   * check. Validation is the same either way. Not saved.
   */
  companyManual: boolean
  trustManual: boolean
  /** Optional, both of them. Everything else has to be known. */
  phoneNumber: string
  emailAddress: string
  /**
   * What Gabby used to re-type from the ASIC company extract. All optional:
   * typed by hand, or filled from an uploaded extract PDF. Conversion never
   * depends on the upload.
   */
  registeredOfficeAddress: string
  principalPlaceOfBusiness: string
  /** Separate from `name` above — the lead's own name is never overwritten by a director. */
  directors: DirectorRow[]
  /** The fill currently applied from an extract, if any. Not a field; it rides along for undo and for the saved source. */
  asicFill: IdentityFormState['asicFill']
  /** Offering the Trust entity type, and why. Not saved. */
  trusteeOffer: TrusteeOfferReason | null
}

export type ConversionErrors = Partial<Record<keyof ConversionForm, string>>

export function emptyConversionForm(lead: Lead | null): ConversionForm {
  return {
    name: lead?.name ?? '',
    email: lead?.email ?? '',
    // Every captured lead has a phone, and it is this person's own number, so
    // it carries straight over. Shown grouped ("0412 345 678"); the API stores
    // it normalised, the same shape the lead held it in.
    phone: lead?.phone ? formatPhone(lead.phone) : '',
    // The capture forms ask this, so it is usually already known. Defaults to
    // company because it is far the commoner of the two on this pipeline.
    entityType: lead?.entityType ?? 'company',
    companyName: '',
    acnNumber: '',
    abnNumber: '',
    trustName: '',
    trustAbnNumber: '',
    companyManual: false,
    trustManual: false,
    // Deliberately not pre-filled from the lead's own phone: that is the
    // director's mobile — it goes in `phone` above — which is not the same
    // thing as the company's number, and a wrong default becomes wrong stored
    // data.
    phoneNumber: '',
    emailAddress: '',
    registeredOfficeAddress: '',
    principalPlaceOfBusiness: '',
    directors: [],
    asicFill: null,
    trusteeOffer: null,
  }
}

// Shared with the intake company step; re-exported for this form's callers.
export { asicFieldsOf, identityOf }

/**
 * What is missing.
 *
 * The company and trust rules are src/lib/clients/identity.ts, shared with the
 * intake forms: a company name and ACN for both entity types, the company's
 * own ABN for a Company, and a trust name and trust ABN for a trustee.
 *
 * The client's phone and the company phone and email are optional.
 */
export function validateConversion(form: ConversionForm): ConversionErrors {
  const errors: ConversionErrors = {}

  if (!form.name.trim()) errors.name = 'Enter a name.'

  if (!form.email.trim()) errors.email = 'Enter an email address.'
  else if (!isValidEmail(form.email)) errors.email = 'That email address does not look right.'

  Object.assign(errors, validateIdentity(identityOf(form)))

  // Optional, but if given it has to be usable.
  if (form.emailAddress.trim() && !isValidEmail(form.emailAddress)) {
    errors.emailAddress = 'That email address does not look right.'
  }

  // Optional, every one of them — but a row somebody started has to be usable.
  if (directorRowErrors(form.directors).some(Boolean)) {
    errors.directors = 'Check the directors below.'
  }

  return errors
}

export function hasErrors(errors: ConversionErrors): boolean {
  return Object.keys(errors).length > 0
}

/** The company-details half, trimmed, as the API wants it. */
export function toCompanyDetails(form: ConversionForm) {
  return {
    ...identityForSave(identityOf(form)),
    phoneNumber: form.phoneNumber.trim(),
    emailAddress: form.emailAddress.trim().toLowerCase(),
    registeredOfficeAddress: form.registeredOfficeAddress.trim(),
    principalPlaceOfBusiness: form.principalPlaceOfBusiness.trim(),
    directors: directorsForSave(form.directors),
    // The extract's date is kept for as long as the fill is — edited or not —
    // and the source says which of those it was.
    asicExtractDate: form.asicFill?.extractedAt ?? null,
    companyDetailsSource: sourceFor(form.asicFill, asicFieldsOf(form)),
  }
}
