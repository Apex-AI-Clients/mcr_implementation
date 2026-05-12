import { describe, it, expect } from 'vitest'
import { classifyLodgement } from '../classifyLodgement'

describe('classifyLodgement', () => {
  it.each([
    ['Original Activity Statement for the period ending 31 Dec 25', 'Original'],
    ['original activity statement for the period ending 30 jun 25', 'Original'], // case-insensitive
    ["'Original Activity Statement for the period ending 31 Dec 25", 'Original'], // leading apostrophe
    ['Client initiated amended Activity Statement for the period ending 30 Jun 23', 'ClientAmended'],
    ['client initiated amended activity statement for anything', 'ClientAmended'],
    ["'Client initiated amended Activity Statement for the period ending 30 Jun 23", 'ClientAmended'],
    ['ATO initiated amended Activity Statement for the period ending 30 Jun 24', 'ATOAmended'],
    ['ato initiated amended activity statement', 'ATOAmended'],
    ['- GST', 'SubLine'],
    ['- PAYG Withholding', 'SubLine'],
    ['- PAYG Instalments', 'SubLine'],
    ['- Income Tax', 'SubLine'],
    ['General interest charge calculated from 01 Aug 25 to 31 Aug 25', 'GIC'],
    ['Amended general interest charge', 'GIC'],
    ['general interest charge', 'GIC'],
    ['Payment received - EFT', 'Payment'],
    ['Payment received', 'Payment'],
    ['Some other transaction', 'Other'],
    ['Refund issued', 'Other'],
  ] as const)('classifies "%s" as %s', (description, expected) => {
    expect(classifyLodgement(description)).toBe(expected)
  })
})
