import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Dialog } from '../Dialog'

/**
 * The dialog primitive carries real accessibility behaviour that can't be
 * verified by reading the markup — focus containment and Escape handling — so
 * it gets a test even though the repo convention is to test logic, not
 * components.
 *
 * Plain DOM assertions rather than jest-dom matchers: @testing-library/jest-dom
 * is installed but not registered in vitest.config.ts.
 */

afterEach(cleanup)

function Fixture({ onClose = () => {} }: { onClose?: () => void }) {
  return (
    <Dialog open onClose={onClose} title="Convert to client" description="This creates a file.">
      <input aria-label="First field" />
      <input aria-label="Second field" />
    </Dialog>
  )
}

describe('Dialog', () => {
  it('exposes itself as a modal dialog labelled by its title', () => {
    render(<Fixture />)
    const dialog = screen.getByRole('dialog')

    expect(dialog.getAttribute('aria-modal')).toBe('true')

    const labelId = dialog.getAttribute('aria-labelledby')
    expect(labelId).toBeTruthy()
    expect(document.getElementById(labelId!)?.textContent).toBe('Convert to client')

    const descriptionId = dialog.getAttribute('aria-describedby')
    expect(descriptionId).toBeTruthy()
    expect(document.getElementById(descriptionId!)?.textContent).toBe('This creates a file.')
  })

  it('moves focus into the dialog on open', () => {
    render(<Fixture />)
    expect(document.activeElement).toBe(screen.getByLabelText('First field'))
  })

  it('closes on Escape', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(<Fixture onClose={onClose} />)

    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes when the close button is used', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(<Fixture onClose={onClose} />)

    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('traps Tab inside the dialog', async () => {
    const user = userEvent.setup()
    render(<Fixture />)

    const first = screen.getByLabelText('First field')
    const second = screen.getByLabelText('Second field')
    const close = screen.getByRole('button', { name: 'Close' })

    expect(document.activeElement).toBe(first)
    await user.tab()
    expect(document.activeElement).toBe(second)
    await user.tab()
    expect(document.activeElement).toBe(close)

    // Past the last focusable, focus wraps back to the first rather than
    // escaping to the page behind.
    await user.tab()
    expect(document.activeElement).toBe(first)
  })

  it('wraps backwards from the first focusable', async () => {
    const user = userEvent.setup()
    render(<Fixture />)

    expect(document.activeElement).toBe(screen.getByLabelText('First field'))
    await user.tab({ shift: true })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }))
  })

  it('locks background scroll while open', () => {
    render(<Fixture />)
    expect(document.body.style.overflow).toBe('hidden')
  })

  it('renders nothing when closed', () => {
    render(
      <Dialog open={false} onClose={() => {}} title="Hidden">
        <p>body</p>
      </Dialog>,
    )
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
