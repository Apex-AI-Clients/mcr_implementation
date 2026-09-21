import { isValidEmail } from './format'
import type { EntityType, Lead } from '@/types/leads'

/**
 * The details a lead has to carry before it can become a client file.
 *
 * These are the same fields as steps 1 and 2 of the SBR intake wizard, asked
 * once at conversion instead of after it. The point is that a file is never
 * created half-known: what used to be a two-field confirmation now collects
 * everything intake needs, and intake opens pre-filled from it.
 */
export interface ConversionForm {
  /** Step 1 — the client record itself. */
  name: string
  email: string
  /** Decides which of the company and trust fields are required below. */
  entityType: EntityType
  /** Step 2 — company or trust details. */
  companyName: string
  acnNumber: string
  abnNumber: string
  trustName: string
  /** Optional, both of them. Everything else has to be known. */
  phoneNumber: string
  emailAddress: string
}

export type ConversionErrors = Partial<Record<keyof ConversionForm, string>>

/** Fixed-length by definition, whatever spacing somebody types. */
const ACN_DIGITS = 9
const ABN_DIGITS = 11

function digits(value: string): string {
  return value.replace(/\D/g, '')
}

export function emptyConversionForm(lead: Lead | null): ConversionForm {
  return {
    name: lead?.name ?? '',
    email: lead?.email ?? '',
    // The capture forms ask this, so it is usually already known. Defaults to
    // company because it is far the commoner of the two on this pipeline.
    entityType: lead?.entityType ?? 'company',
    companyName: '',
    acnNumber: '',
    abnNumber: '',
    trustName: '',
    // Deliberately not pre-filled from the lead's own phone: that is the
    // director's mobile, which is not the same thing as the company's number,
    // and a wrong default becomes wrong stored data.
    phoneNumber: '',
    emailAddress: '',
  }
}

/**
 * What is missing.
 *
 * Required-ness follows the entity, not a flat list. An ACN belongs to a
 * company and a trust does not have one; a trust name belongs to a trust and
 * a company does not have one. Demanding all of them at once would mean
 * somebody typing "N/A" into a field on every single conversion, and that
 * junk would then auto-fill the intake form.
 *
 * Company or trust phone and email are the two optional fields.
 */
export function validateConversion(form: ConversionForm): ConversionErrors {
  const errors: ConversionErrors = {}

  if (!form.name.trim()) errors.name = 'Enter a name.'

  if (!form.email.trim()) errors.email = 'Enter an email address.'
  else if (!isValidEmail(form.email)) errors.email = 'That email address does not look right.'

  // Both kinds of entity have one.
  if (!form.abnNumber.trim()) errors.abnNumber = 'Enter the ABN.'
  else if (digits(form.abnNumber).length !== ABN_DIGITS) {
    errors.abnNumber = `An ABN is ${ABN_DIGITS} digits.`
  }

  if (form.entityType === 'company') {
    if (!form.companyName.trim()) errors.companyName = 'Enter the company name.'
    if (!form.acnNumber.trim()) errors.acnNumber = 'Enter the ACN.'
    else if (digits(form.acnNumber).length !== ACN_DIGITS) {
      errors.acnNumber = `An ACN is ${ACN_DIGITS} digits.`
    }
  }

  if (form.entityType === 'trust') {
    if (!form.trustName.trim()) errors.trustName = 'Enter the trust name.'
    // A corporate trustee still has an ACN, so the field stays available —
    // but only checked for shape when something was actually typed.
    if (form.acnNumber.trim() && digits(form.acnNumber).length !== ACN_DIGITS) {
      errors.acnNumber = `An ACN is ${ACN_DIGITS} digits.`
    }
  }

  // Optional, but if given it has to be usable.
  if (form.emailAddress.trim() && !isValidEmail(form.emailAddress)) {
    errors.emailAddress = 'That email address does not look right.'
  }

  return errors
}

export function hasErrors(errors: ConversionErrors): boolean {
  return Object.keys(errors).length > 0
}

/** The company-details half, trimmed, as the API wants it. */
export function toCompanyDetails(form: ConversionForm) {
  return {
    companyName: form.companyName.trim(),
    acnNumber: form.acnNumber.trim(),
    abnNumber: form.abnNumber.trim(),
    trustName: form.trustName.trim(),
    phoneNumber: form.phoneNumber.trim(),
    emailAddress: form.emailAddress.trim().toLowerCase(),
  }
}
