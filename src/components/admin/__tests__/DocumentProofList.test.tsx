import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { DocumentProofList } from '../DocumentProofList'

/** "Documents" on the client page. Synthetic rows. */

afterEach(cleanup)

describe('DocumentProofList', () => {
  it('shows each file with what was proven, or "Being prepared"', () => {
    render(
      <DocumentProofList
        rows={[
          { documentId: 'a', filename: 'ica.csv', kind: 'ato_account', kindLabel: 'ATO activity statement account', status: 'proven', text: "Matches the ATO's own balance: $1,000.00 DR at 14 Sep 2026" },
          { documentId: 'b', filename: 'dpn.pdf', kind: 'notice', kindLabel: 'Director penalty notice', status: 'being_prepared', text: 'Being prepared' },
        ]}
      />,
    )
    const items = within(screen.getByTestId('document-proofs')).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0].getAttribute('data-status')).toBe('proven')
    expect(items[0].textContent).toContain("ica.csv · ATO activity statement accountMatches the ATO's own balance")
    expect(items[1].textContent).toContain('Being prepared')
  })

  it('shows nothing with no ATO file, notice or statement', () => {
    const { container } = render(<DocumentProofList rows={[]} />)
    expect(container.innerHTML).toBe('')
  })
})
