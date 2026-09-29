/**
 * An extract fee for a button label. Browser-safe.
 *
 * 1000 -> "$10.00". Always two decimal places: "$10" on a button that spends
 * money reads as an estimate.
 */
const AUD = new Intl.NumberFormat('en-AU', {
  style: 'currency',
  currency: 'AUD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

export function formatFee(cents: number): string {
  return AUD.format(cents / 100)
}
