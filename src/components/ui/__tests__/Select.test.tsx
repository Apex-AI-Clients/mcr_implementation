import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { Select } from '../Select'
import { LeadFilters } from '@/components/leads/LeadFilters'
import { EMPTY_FILTERS } from '@/lib/leads/filter'

/**
 * `className` reaches the inner <select>; the wrapper is what a flex toolbar
 * lays out. Conflating the two put every lead filter on its own row, so the
 * distinction is worth pinning down.
 *
 * jsdom applies no CSS, so this asserts the classes that decide the layout
 * rather than the layout itself.
 */

afterEach(cleanup)

describe('Select', () => {
  it('sends className to the select and wrapperClassName to the wrapper', () => {
    render(
      <Select
        aria-label="Example"
        className="border-accent"
        wrapperClassName="w-[132px]"
        options={[{ value: 'a', label: 'A' }]}
      />,
    )

    const select = screen.getByLabelText('Example')
    expect(select.className).toContain('border-accent')

    const wrapper = select.closest('div')?.parentElement
    expect(wrapper?.className).toContain('w-[132px]')
  })

  it('is full-width by default, for form layouts', () => {
    render(<Select aria-label="Example" options={[{ value: 'a', label: 'A' }]} />)
    const wrapper = screen.getByLabelText('Example').closest('div')?.parentElement
    expect(wrapper?.className).toContain('w-full')
  })

  it('renders a leading placeholder option with an empty value', () => {
    render(
      <Select
        aria-label="Example"
        placeholder="All stages"
        options={[{ value: 'a', label: 'A' }]}
      />,
    )
    const options = screen.getByLabelText('Example').querySelectorAll('option')
    expect(options[0].value).toBe('')
    expect(options[0].textContent).toBe('All stages')
  })

  it('renders groups as optgroups', () => {
    render(
      <Select
        aria-label="Example"
        groups={[
          { label: 'Pipeline', options: [{ value: 'lead', label: 'Lead' }] },
          { label: 'Closed', options: [{ value: 'converted', label: 'Converted' }] },
        ]}
      />,
    )
    const groups = Array.from(
      screen.getByLabelText('Example').querySelectorAll('optgroup'),
    ).map((group) => group.label)
    expect(groups).toEqual(['Pipeline', 'Closed'])
  })
})

describe('LeadFilters layout', () => {
  const LABELS = [
    'Filter by stage',
    'Filter by state',
    'Filter by source',
    'Filter by date added',
  ]

  it('gives every filter a fixed width instead of a full-width wrapper', () => {
    render(<LeadFilters filters={EMPTY_FILTERS} onChange={() => {}} onReset={() => {}} />)

    for (const label of LABELS) {
      const wrapper = screen.getByLabelText(label).closest('div')?.parentElement
      // A w-full wrapper claims the whole flex line and stacks the filters.
      expect(wrapper?.className).not.toContain('w-full')
      expect(wrapper?.className).toMatch(/w-\[\d+px\]/)
    }
  })

  it('keeps every control in one flex row', () => {
    render(<LeadFilters filters={EMPTY_FILTERS} onChange={() => {}} onReset={() => {}} />)

    const row = screen.getByLabelText('Filter by stage').closest('div')?.parentElement
      ?.parentElement
    expect(row?.className).toContain('flex')

    // All four selects are siblings on that row. The follow-up toggle used to
    // be asserted here too — it is commented out in LeadFilters for now.
    for (const label of LABELS) {
      expect(screen.getByLabelText(label).closest('div')?.parentElement?.parentElement).toBe(row)
    }
  })
})
