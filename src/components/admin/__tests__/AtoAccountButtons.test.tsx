import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AtoAccountButtons } from '@/components/admin/AtoAccountButtons'

describe('AtoAccountButtons', () => {
  it('uses the plain name when the client has one account of the kind', () => {
    render(
      <AtoAccountButtons
        clientId="c1"
        kind="income_tax"
        hasFiles
        accounts={[
          { id: 'a1', kind: 'income_tax', label: 'Income tax 001' },
          { id: 'a2', kind: 'super_guarantee', label: 'Superannuation guarantee 001' },
        ]}
      />,
    )
    expect(screen.getByRole('button', { name: /Income tax account analysis/ })).toBeTruthy()
    expect(screen.queryByText(/001/)).toBeNull()
  })

  it("keeps the ATO's names when there are two accounts of the kind", () => {
    render(
      <AtoAccountButtons
        clientId="c1"
        kind="super_guarantee"
        hasFiles
        accounts={[
          { id: 'a1', kind: 'super_guarantee', label: 'Superannuation guarantee 001' },
          { id: 'a2', kind: 'super_guarantee', label: 'Superannuation guarantee 002' },
        ]}
      />,
    )
    expect(screen.getByRole('button', { name: /Superannuation guarantee 001 analysis/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Superannuation guarantee 002 analysis/ })).toBeTruthy()
  })

  it('says it is being analysed until an analysis is stored', () => {
    render(<AtoAccountButtons clientId="c1" kind="income_tax" hasFiles accounts={[]} />)
    expect(screen.getByText(/Being analysed/)).toBeTruthy()
  })
})
