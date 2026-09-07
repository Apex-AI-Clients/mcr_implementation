import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { Tooltip } from '../Tooltip'

/**
 * The tooltip exists so a truncated message can still be read. It has to appear
 * on hover and on focus, and it must not render at all when there is nothing to
 * show — a bubble containing an empty string would be a floating grey box.
 */

afterEach(cleanup)

const LONG =
  'ATO have started calling. Three fitout sites running, two of them profitable. ' +
  'I need to understand what an SBR actually costs before I bring it to my business partner.'

function renderTooltip(content: string) {
  return render(
    <Tooltip content={content} className="block">
      <span className="block truncate">{content}</span>
    </Tooltip>,
  )
}

describe('Tooltip', () => {
  it('shows nothing until hovered', () => {
    renderTooltip(LONG)
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('reveals the full text on hover', () => {
    renderTooltip(LONG)
    fireEvent.mouseEnter(screen.getByText(LONG))

    const bubble = screen.getByRole('tooltip')
    expect(bubble.textContent).toBe(LONG)
  })

  it('hides again on mouse leave', () => {
    renderTooltip(LONG)
    const trigger = screen.getByText(LONG)

    fireEvent.mouseEnter(trigger)
    expect(screen.getByRole('tooltip')).toBeTruthy()

    fireEvent.mouseLeave(trigger)
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('reveals on focus, so it is reachable from the keyboard', () => {
    renderTooltip(LONG)
    // The trigger is focusable rather than hover-only.
    const trigger = screen.getByText(LONG).parentElement!
    expect(trigger.getAttribute('tabindex')).toBe('0')

    fireEvent.focus(trigger)
    expect(screen.getByRole('tooltip')).toBeTruthy()

    fireEvent.blur(trigger)
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('renders the children alone when there is nothing to reveal', () => {
    render(
      <Tooltip content="">
        <span>plain</span>
      </Tooltip>,
    )
    fireEvent.mouseEnter(screen.getByText('plain'))
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('breaks an unbroken string instead of letting it run out of the bubble', () => {
    // whitespace-pre-wrap alone only wraps at whitespace, so a run of
    // characters with no spaces needs an explicit break rule.
    const unbroken = 'f'.repeat(120)
    renderTooltip(unbroken)
    fireEvent.mouseEnter(screen.getByText(unbroken))

    const bubble = screen.getByRole('tooltip')
    expect(bubble.className).toContain('break-words')
    expect(bubble.textContent).toBe(unbroken)
  })

  it('is positioned fixed, so the table’s overflow-y-hidden cannot clip it', () => {
    renderTooltip(LONG)
    fireEvent.mouseEnter(screen.getByText(LONG))
    expect(screen.getByRole('tooltip').className).toContain('fixed')
  })
})
