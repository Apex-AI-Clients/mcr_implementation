const ASIC_REGISTERS_URL =
  'https://connectonline.asic.gov.au/RegistrySearch/faces/landing/SearchRegisters.jspx'
const ABN_LOOKUP_URL = 'https://abr.business.gov.au/'

const ABN_DIGITS = 11

interface RegisterLookupLinkProps {
  register: 'asic' | 'abr'
  /** The field's current value. An 11-digit ABN opens that ABN's record. */
  value?: string
}

/**
 * A small link under an ACN or ABN field, for checking or finding the number
 * on the public register.
 *
 * Opens in a new tab so a half-filled form survives the trip. A mistyped
 * 11-digit ABN still lands on ABN Lookup's "not a valid ABN" page, which keeps
 * its search box, so the deep link never strands anyone.
 */
export function RegisterLookupLink({ register, value = '' }: RegisterLookupLinkProps) {
  const href = register === 'asic' ? ASIC_REGISTERS_URL : abnLookupHref(value)
  const label =
    register === 'asic' ? 'Check or find an ACN' : 'Check or find an ABN'

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="self-start text-xs text-accent underline-offset-2 transition-colors hover:text-accent/80 hover:underline"
    >
      {label} <span aria-hidden="true">↗</span>
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  )
}

function abnLookupHref(value: string): string {
  const digits = value.replace(/\D/g, '')
  return digits.length === ABN_DIGITS
    ? `${ABN_LOOKUP_URL}ABN/View?abn=${digits}`
    : ABN_LOOKUP_URL
}
