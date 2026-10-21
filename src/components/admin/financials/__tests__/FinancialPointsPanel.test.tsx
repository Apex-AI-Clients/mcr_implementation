import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { FinancialPointsPanel } from '../FinancialPointsPanel'

/** "What the financial statements show" on the comparison page. Synthetic figures only. */

afterEach(cleanup)

describe('What the financial statements show', () => {
  it('gives the framing, then a card per point: what, which way, and the figures', () => {
    const text = 'Property, plant & equipment rose from $126,450 (FY2023) to $251,920 (FY2026).'
    render(
      <FinancialPointsPanel
        points={[
            {
              rule: 'b',
              text,
              card: {
                title: 'Property, plant & equipment',
                verdict: 'Rose while ATO debt rose',
                tone: 'concern',
                figures: [
                  { label: 'FY2023', value: 126_450 },
                  { label: 'FY2026', value: 251_920 },
                ],
                note: 'ATO-related debt rose from $12,000 to $80,000 over the same years.',
              },
            },
            {
              rule: 'f',
              text: 'Liabilities exceeded assets by $5,000 in FY2026; in FY2023 net assets were $20,000.',
              card: {
                title: 'Net assets',
                verdict: 'Liabilities exceed assets',
                tone: 'concern',
                figures: [
                  { label: 'FY2023', value: 20_000 },
                  { label: 'FY2026', value: -5_000 },
                ],
                note: null,
              },
            },
        ]}
      />,
    )
    expect(screen.getByText(/Facts only; they don't change the SBR prediction/)).toBeTruthy()
    const [ppe, net] = screen.getAllByRole('listitem')
    expect(within(ppe).getByText('Property, plant & equipment')).toBeTruthy()
    expect(within(ppe).getByText('Rose while ATO debt rose')).toBeTruthy()
    expect(within(ppe).getByText('$126,450')).toBeTruthy()
    expect(within(ppe).getByText('$251,920')).toBeTruthy()
    expect(within(ppe).getByText(/over the same years/)).toBeTruthy()
    // The whole sentence is still there, for screen readers.
    expect(within(ppe).getByText(text)).toBeTruthy()
    // A deficit shows as a negative figure, in the warning colour.
    expect(within(net).getByText('-$5,000').className).toContain('text-destructive')
  })

  it('says so when nothing stands out', () => {
    render(<FinancialPointsPanel points={[]} />)
    expect(screen.getByText('Nothing stands out in the financial statements.')).toBeTruthy()
  })
})
