import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, waitFor, within, cleanup, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
// The preview's drawing is pdf.js on a canvas, which jsdom has not got.
vi.mock('unpdf/pdfjs', () => ({ getDocument: vi.fn(() => ({ promise: Promise.reject(new Error('no canvas in tests')), destroy: async () => {} })) }))
// The browser fill (its own test fills the real templates): failing by
// default here, so the preview falls back to the server stub below.
vi.mock('@/lib/forms/browserFill', () => ({ fillInBrowser: vi.fn() }))

import { CvlFormEditor } from '../CvlFormEditor'
import { entryMap } from '@/lib/cvl/entryMap'
import { entryState } from '@/lib/cvl/drafts'
import { prefillForm } from '@/lib/cvl/prefill'
import { formVersion } from '@/lib/forms/registry'
import { context } from '@/lib/cvl/__tests__/fixtures'
import { fillInBrowser } from '@/lib/forms/browserFill'

// Each test renders a whole ASIC form; under full-suite load that can pass 20s.
vi.setConfig({ testTimeout: 60_000 })

/** The Part B entry screen. Synthetic client file only. */

/** Answers the preview with a tiny PDF and the page each output page is, and records every call. */
function stubFetch(onPut?: Response) {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
    init?.method === 'PUT'
      ? (onPut ?? new Response(JSON.stringify({ ok: true, formVersion: '20220801', updatedAt: '2026-11-03T00:00:00Z', updatedBy: 'Casey' })))
      : new Response(new Uint8Array([37, 80, 68, 70]), { headers: { 'X-Cvl-Pages': '[1,2,3,4,5,6,7,8,9]', 'X-Cvl-Warnings': encodeURIComponent('["B14: Answer is longer than the lines"]') } }),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => {
  stubFetch()
})

beforeEach(() => {
  vi.mocked(fillInBrowser).mockReset()
  vi.mocked(fillInBrowser).mockRejectedValue(new Error('not in this test'))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function renderPartB() {
  const map = formVersion('507b').map
  const prefill = prefillForm('507b', 'director:1', context())
  render(
    <CvlFormEditor
      caseId="case-1"
      clientId="cl_1"
      map={entryMap(map)}
      subject="director:1"
      subjects={[
        { subject: 'director:1', label: 'Jordan Sample' },
        { subject: 'director:2', label: 'Casey Example' },
      ]}
      prefill={prefill}
      initial={entryState(map, prefill, null)}
      saved={null}
    />,
  )
}

/** A question's section, by its heading's id (role queries over a form this size are slow). */
const section = (q: string) => document.getElementById(`q-${q}`)!.closest('section') as HTMLElement

describe('CvlFormEditor', () => {
  it('shows the form’s own question numbers, and each director’s Part B', () => {
    renderPartB()
    expect(within(section('B1')).getByLabelText('Name')).toHaveProperty('value', 'Jordan Sample')
    expect(screen.getByRole('link', { name: 'Casey Example' }).getAttribute('href')).toBe('/cvl/cl_1/forms/507b?subject=director%3A2')
  })

  it('starts every Yes/No at "No"', () => {
    renderPartB()
    const b2 = within(section('B2')).getByRole('radiogroup')
    expect((within(b2).getByLabelText('No') as HTMLInputElement).checked).toBe(true)
  })

  it('clicking Yes never moves the app’s frame (the screen went blank): the hidden radio is placed in its label, and a moved frame is put back', async () => {
    const user = userEvent.setup({ delay: null })
    const map = formVersion('507b').map
    const prefill = prefillForm('507b', 'director:1', context())
    render(
      <div data-testid="frame" style={{ overflow: 'hidden' }}>
        <CvlFormEditor caseId="case-1" clientId="cl_1" map={entryMap(map)} subject="director:1" subjects={[{ subject: 'director:1', label: 'Jordan Sample' }]} prefill={prefill} initial={entryState(map, prefill, null)} saved={null} />
      </div>,
    )
    const yes = within(within(section('B2')).getByRole('radiogroup')).getByLabelText('Yes') as HTMLInputElement
    // Placed in its own label, inside the questions column.
    expect(yes.closest('label')!.className).toContain('relative')

    // As if the browser had scrolled the frame to bring the radio into view.
    const frame = screen.getByTestId('frame')
    let frameTop = 120
    Object.defineProperty(frame, 'scrollTop', { configurable: true, get: () => frameTop, set: (v: number) => (frameTop = v) })
    await user.click(yes)
    expect(yes.checked).toBe(true)
    expect(frameTop).toBe(0)
  })

  it('shows where a pre-filled answer came from until it is changed', async () => {
    const user = userEvent.setup({ delay: null })
    renderPartB()
    const b1 = section('B1')
    const name = within(b1).getByLabelText('Name')
    expect(within(name.parentElement as HTMLElement).queryByRole('button')).not.toBeNull()
    await user.type(name, ' Jr')
    expect(within(name.parentElement as HTMLElement).queryByRole('button')).toBeNull()
  })

  it('warns while typing when an answer is too long for its box, without stopping the typing', async () => {
    const user = userEvent.setup({ delay: null })
    renderPartB()
    const name = within(section('B1')).getByLabelText('Name') as HTMLInputElement
    expect(name.getAttribute('aria-invalid')).toBeNull()
    await user.clear(name)
    const long = 'Lorem ipsum dolor sit amet '.repeat(8).trim()
    await user.click(name)
    await user.paste(long)
    // Everything typed is kept; the box says how much won't print.
    expect(name.value).toBe(long)
    expect(name.getAttribute('aria-invalid')).toBe('true')
    const warning = document.getElementById(name.getAttribute('aria-describedby')!)!
    expect(warning.textContent).toMatch(/^Too long for its box on the form: the last \d+ characters won’t print\.$/)
    // Short enough again: the warning goes.
    await user.clear(name)
    await user.type(name, 'Jordan Sample')
    expect(name.getAttribute('aria-invalid')).toBeNull()
    expect(within(section('B1')).queryByText(/Too long for/)).toBeNull()
  })

  it('asks each table at its own appendix page, after the form, and says so at its question', () => {
    renderPartB()
    expect(within(section('B21')).getByRole('link', { name: 'Table B21' }).getAttribute('href')).toBe('#q-Table B21')
    expect(within(section('B21')).queryByRole('button', { name: 'Add a row' })).toBeNull()
    const table = section('Table B21')
    expect(table.dataset.page).toBe('13')
    expect(within(table).getByRole('button', { name: 'Add a row' })).toBeTruthy()
    expect(within(table).getByText(/a page · printed on an appendix page \(page 13\)/)).toBeTruthy()
    // The "signed by" name sits with the first table, where it prints.
    expect(within(section('Table B2')).getByLabelText(/Name on the appendix tables/)).toBeTruthy()
  })

  it('warns on a table cell too long for its cell', async () => {
    const user = userEvent.setup({ delay: null })
    renderPartB()
    const b21 = section('Table B21')
    await user.click(within(b21).getByRole('button', { name: 'Add a row' }))
    const how = within(b21).getByLabelText('How did creditor ask for payment, row 1') as HTMLInputElement
    await user.click(how)
    await user.paste('Lorem ipsum dolor sit amet '.repeat(10).trim())
    expect(how.getAttribute('aria-invalid')).toBe('true')
    expect(within(b21).getByText(/^Too long for its cell: the last \d+ characters won’t print\.$/)).toBeTruthy()
  })

  it('leaves handwritten answers off the screen: nothing to type, nothing saved', () => {
    renderPartB()
    const b6 = section('B6')
    expect(within(b6).queryByLabelText('User name')).toBeNull()
    expect(within(b6).queryByLabelText('Password')).toBeNull()
    expect(screen.queryByText(/Written by hand on the printout/)).toBeNull()
    // The rest of B6 is still asked.
    expect(within(b6).getByLabelText('Provider name')).toBeTruthy()
  })

  it('asks Part A’s appointment as tick boxes in the form’s words, any number ticked, 507D ticked to start', async () => {
    const user = userEvent.setup({ delay: null })
    const fetchMock = stubFetch()
    const map = formVersion('507a').map
    const prefill = prefillForm('507a', 'company', context())
    render(
      <CvlFormEditor caseId="case-1" clientId="cl_1" map={entryMap(map)} subject="company" subjects={[{ subject: 'company', label: 'Company' }]} prefill={prefill} initial={entryState(map, prefill, null)} saved={null} />,
    )
    const group = screen.getByRole('group', { name: /Please tick appropriate box/ })
    const boxes = within(group).getAllByRole('checkbox') as HTMLInputElement[]
    expect(boxes).toHaveLength(6)
    expect(boxes.filter((b) => b.checked).map((b) => b.closest('label')?.textContent)).toEqual(['Liquidator – creditors’ voluntary winding up – s497(4) 507D'])
    await user.click(within(group).getByLabelText('Liquidator/Provisional Liquidator appointed by the court - s475(1) 507C'))
    expect(boxes.filter((b) => b.checked)).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([, i]) => i?.method === 'PUT')).toBe(true))
    const [, init] = fetchMock.mock.calls.find(([, i]) => i?.method === 'PUT') as unknown as [string, RequestInit]
    // Both, in the form's order.
    expect(JSON.parse(init.body as string).answers.fields.ea_role).toBe('court_liquidator,cvl_liquidator')
  })

  it('saves the answers and the changed keys', async () => {
    const user = userEvent.setup({ delay: null })
    const fetchMock = stubFetch()
    renderPartB()
    await user.click(within(within(section('B2')).getByRole('radiogroup')).getByLabelText('Yes'))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([, i]) => i?.method === 'PUT')).toBe(true))
    const [url, init] = fetchMock.mock.calls.find(([, i]) => i?.method === 'PUT') as unknown as [string, RequestInit]
    expect(url).toBe('/api/admin/cvl/case-1/forms/507b')
    const body = JSON.parse(init.body as string)
    expect(body.subject).toBe('director:1')
    expect(body.answers.fields.b2).toBe('yes')
    expect(body.editedKeys).toEqual(['b2'])
    expect('b6_password' in body.answers.fields).toBe(false)
    expect(await screen.findByRole('button', { name: /Saved/ })).toBeTruthy()
  })

  it('fills the preview once on opening, with no warning boxes on the screen', async () => {
    const fetchMock = stubFetch()
    renderPartB()
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => String(u) === '/api/admin/cvl/case-1/preview')).toBe(true), { timeout: 3000 })
    const [, init] = fetchMock.mock.calls.find(([u]) => String(u) === '/api/admin/cvl/case-1/preview')!
    const body = JSON.parse(init!.body as string)
    expect(body).toMatchObject({ form: '507b', subject: 'director:1' })
    expect(body.answers.fields.b1_name).toBe('Jordan Sample')
    // Page tabs for each output page; the warnings are kept for the print page.
    await waitFor(() => expect(screen.getAllByRole('button', { name: /^[1-9]$/ })).toHaveLength(9))
    expect(screen.queryByText('B14: Answer is longer than the lines')).toBeNull()
    expect(screen.queryByText(/Not set yet in CVL settings/)).toBeNull()
  })

  it('fills the preview again in the browser a moment after typing stops: once per pause, never asking the server', async () => {
    const user = userEvent.setup({ delay: null })
    const fetchMock = stubFetch()
    vi.mocked(fillInBrowser).mockResolvedValue({ pdf: new Uint8Array([37, 80, 68, 70]), pageSources: [1, 2, 3, 4, 5, 6, 7, 8, 9], pages: 9, warnings: [] } as never)
    renderPartB()
    await waitFor(() => expect(fillInBrowser).toHaveBeenCalledTimes(1))
    expect(vi.mocked(fillInBrowser).mock.calls[0].slice(0, 2)).toEqual(['507b', '20220801'])

    await user.type(within(section('B1')).getByLabelText('Name'), ' Jr')
    // Typing three letters: not three fills, one after the pause.
    await waitFor(() => expect(fillInBrowser).toHaveBeenCalledTimes(2), { timeout: 3000 })
    await new Promise((r) => setTimeout(r, 600))
    expect(fillInBrowser).toHaveBeenCalledTimes(2)
    const answers = vi.mocked(fillInBrowser).mock.calls[1][2] as { fields: Record<string, unknown> }
    expect(answers.fields.b1_name).toBe('Jordan Sample Jr')
    // Nothing saved, and the server never asked to fill.
    expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith('/preview'))).toBe(false)
    expect(fetchMock.mock.calls.some(([, i]) => i?.method === 'PUT')).toBe(false)
    expect(screen.queryByText(/save to see your changes/)).toBeNull()
  })

  it('fills the preview on the server when the browser cannot', async () => {
    const user = userEvent.setup({ delay: null })
    const fetchMock = stubFetch()
    renderPartB()
    const previews = () => fetchMock.mock.calls.filter(([u]) => String(u) === '/api/admin/cvl/case-1/preview')
    await waitFor(() => expect(previews()).toHaveLength(1))
    await user.type(within(section('B1')).getByLabelText('Name'), ' Jr')
    await waitFor(() => expect(previews()).toHaveLength(2), { timeout: 3000 })
    expect(JSON.parse(previews()[1][1]!.body as string).answers.fields.b1_name).toBe('Jordan Sample Jr')
  })

  /** A stand-in IntersectionObserver: each observer's callback and what it watches. */
  function stubObservers() {
    const observers: { report: (entries: { isIntersecting: boolean; target: Element; boundingClientRect: { top: number } }[]) => void; watched: Element[] }[] = []
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        watched: Element[] = []
        constructor(report: (typeof observers)[number]['report']) {
          observers.push({ report, watched: this.watched })
        }
        observe(el: Element) {
          this.watched.push(el)
        }
        disconnect() {}
      },
    )
    const watching = (pred: (el: Element) => boolean) => observers.find((o) => o.watched.some(pred))!
    return { watching }
  }

  it('turns the preview to the page of the question scrolled to on the left', async () => {
    const { watching } = stubObservers()
    stubFetch()
    renderPartB()
    await waitFor(() => expect(screen.getAllByRole('button', { name: /^[1-9]$/ })).toHaveLength(9))
    const sections = watching((el) => el.tagName === 'SECTION')
    // Every question section is watched.
    expect(sections.watched.length).toBe(document.querySelectorAll('section[data-page]').length)
    const b24 = section('B24')
    expect(b24.dataset.page).toBe('8')
    act(() => sections.report([{ isIntersecting: true, target: b24, boundingClientRect: { top: 100 } }]))
    await waitFor(() => expect(screen.getByRole('button', { name: '8' }).getAttribute('aria-current')).toBe('page'))
  })

  it('shows the first question’s page from its very top when the questions are back at the top', async () => {
    const { watching } = stubObservers()
    stubFetch()
    renderPartB()
    await waitFor(() => expect(screen.getAllByRole('button', { name: /^[1-9]$/ })).toHaveLength(9))
    const sections = watching((el) => el.tagName === 'SECTION')
    act(() => sections.report([{ isIntersecting: true, target: section('B24'), boundingClientRect: { top: 100 } }]))
    await waitFor(() => expect(screen.getByRole('button', { name: '8' }).getAttribute('aria-current')).toBe('page'))

    const top = watching((el) => el.hasAttribute('data-form-top'))
    const marker = document.querySelector('[data-form-top]')!
    act(() => top.report([{ isIntersecting: true, target: marker, boundingClientRect: { top: 0 } }]))
    // The questions start as the PDF does: page 1 (ASIC's cover, nothing to fill), from its top.
    expect(marker.getAttribute('data-page')).toBe('1')
    await waitFor(() => expect(screen.getByRole('button', { name: '1' }).getAttribute('aria-current')).toBe('page'))
    // The first section starts its page from the top, not at its own first box.
    expect(document.querySelector('section[data-page]')!.getAttribute('data-top')).toBe('0')
  })

  it('says "Updating" to the left of the size buttons, in a slot that is always there, so the buttons never move', async () => {
    const user = userEvent.setup({ delay: null })
    stubFetch()
    vi.mocked(fillInBrowser).mockResolvedValue({ pdf: new Uint8Array([37, 80, 68, 70]), pageSources: [1, 2, 3, 4, 5, 6, 7, 8, 9], pages: 9, warnings: [] } as never)
    renderPartB()
    const status = screen.getByTestId('preview-status')
    const sizes = screen.getByRole('group', { name: 'Preview size' })
    // Before the buttons, in the same row.
    expect(status.compareDocumentPosition(sizes) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(status.parentElement).toBe(sizes.parentElement)
    expect(status.className).toContain('w-20')
    // Idle: still there, empty.
    await waitFor(() => expect(status.textContent).toBe(''))
    await user.type(within(section('B1')).getByLabelText('Name'), 'x')
    expect(status.textContent).toContain('Updating')
    await waitFor(() => expect(status.textContent).toBe(''), { timeout: 3000 })
    expect(screen.getByTestId('preview-status')).toBe(status)
  })

  it('shows every page in one column that scrolls to the last, each page whole to start, or column-wide; the choice is remembered', async () => {
    const user = userEvent.setup({ delay: null })
    stubFetch()
    window.localStorage.removeItem('cvl.preview.fit')
    renderPartB()
    // All nine pages of Part B, one under the other.
    await waitFor(() => expect(screen.getAllByLabelText(/^Page \d+ of 9$/)).toHaveLength(9))
    const viewer = screen.getByLabelText(/: every page$/)
    expect(viewer.className).toContain('overflow-y-auto')
    expect(viewer.className).toContain('[scrollbar-width:none]')
    expect(viewer.className).toContain('[&::-webkit-scrollbar]:hidden')
    const firstPage = screen.getByLabelText('Page 1 of 9').parentElement as HTMLElement
    // Whole page: each page no taller than the column.
    expect(viewer.dataset.fit).toBe('page')
    // (min(100%, column height × page ratio): real browsers apply it; the test DOM drops it.) Not column-wide:
    expect(firstPage.style.width).not.toBe('100%')
    expect(screen.getByRole('button', { name: 'Whole page' }).getAttribute('aria-pressed')).toBe('true')

    await user.click(screen.getByRole('button', { name: 'Fit width' }))
    expect(viewer.dataset.fit).toBe('width')
    expect((screen.getByLabelText('Page 1 of 9').parentElement as HTMLElement).style.width).toBe('100%')
    expect(window.localStorage.getItem('cvl.preview.fit')).toBe('width')
    window.localStorage.removeItem('cvl.preview.fit')
  })

  it('shows the page a section starts on, from its top, and keeps still for a section on the page already in view', async () => {
    const { watching } = stubObservers()
    stubFetch()
    renderPartB()
    await waitFor(() => expect(screen.getAllByLabelText(/^Page \d+ of 9$/)).toHaveLength(9))
    const viewer = screen.getByLabelText(/: every page$/)
    const scrollTo = vi.fn()
    viewer.scrollTo = scrollTo as never
    const sections = watching((el) => el.tagName === 'SECTION')

    // B24 is on page 8: the column turns to page 8, from its top (not to B24's place on it).
    act(() => sections.report([{ isIntersecting: true, target: section('B24'), boundingClientRect: { top: 100 } }]))
    await waitFor(() => expect(screen.getByRole('button', { name: '8' }).getAttribute('aria-current')).toBe('page'))
    expect(scrollTo).toHaveBeenCalledTimes(1)
    expect(scrollTo.mock.calls[0][0].top).toBe(0) // the test DOM lays every page at 0: page 8's top, no offset into it

    // B25 is on page 8 too: nothing moves.
    act(() => sections.report([{ isIntersecting: true, target: section('B25'), boundingClientRect: { top: 100 } }]))
    await new Promise((r) => setTimeout(r, 50))
    expect(scrollTo).toHaveBeenCalledTimes(1)

    // B10 is on page 4: it turns again.
    act(() => sections.report([{ isIntersecting: true, target: section('B10'), boundingClientRect: { top: 100 } }]))
    await waitFor(() => expect(scrollTo).toHaveBeenCalledTimes(2))
    expect(screen.getByRole('button', { name: '4' }).getAttribute('aria-current')).toBe('page')
  })

  it('jumps to a question or table by scrolling only the questions’ own column, never the frame around it', async () => {
    const user = userEvent.setup({ delay: null })
    const map = formVersion('507b').map
    const prefill = prefillForm('507b', 'director:1', context())
    // The app's frame (never scrolls) around its scrolling column, as in the app's layout.
    render(
      <div data-testid="frame" style={{ overflow: 'hidden' }}>
        <main data-testid="column" style={{ overflowY: 'auto' }}>
          <CvlFormEditor caseId="case-1" clientId="cl_1" map={entryMap(map)} subject="director:1" subjects={[{ subject: 'director:1', label: 'Jordan Sample' }]} prefill={prefill} initial={entryState(map, prefill, null)} saved={null} />
        </main>
      </div>,
    )
    const column = screen.getByTestId('column')
    const scrollTo = vi.fn()
    column.scrollTo = scrollTo as never
    const hashBefore = window.location.hash

    await user.click(within(screen.getByRole('navigation', { name: 'Questions' })).getByRole('link', { name: 'Table B28' }))
    expect(scrollTo).toHaveBeenCalledTimes(1)
    // Handled here: the browser's own #anchor jump (which moves the frame) never runs.
    expect(window.location.hash).toBe(hashBefore)

    await user.click(within(section('B28')).getByRole('link', { name: 'Table B28' }))
    expect(scrollTo).toHaveBeenCalledTimes(2)
  })

  it('shows the page of the section a jump link goes to, not of sections passed on the way; one page in view at a time', async () => {
    const user = userEvent.setup({ delay: null })
    const { watching } = stubObservers()
    stubFetch()
    renderPartB()
    await waitFor(() => expect(screen.getAllByLabelText(/^Page \d+ of 9$/)).toHaveLength(9))
    const sections = watching((el) => el.tagName === 'SECTION')

    // The question buttons: B21 is on page 8, so page 8 shows straight away.
    await user.click(within(screen.getByRole('navigation', { name: 'Questions' })).getByRole('link', { name: 'B21' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '8' }).getAttribute('aria-current')).toBe('page'))
    // A section crossing the middle on the way there does not take over.
    act(() => sections.report([{ isIntersecting: true, target: section('B3'), boundingClientRect: { top: 300 } }]))
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.getByRole('button', { name: '8' }).getAttribute('aria-current')).toBe('page')
    // Once staff scroll the questions themselves, the section across the middle decides again.
    act(() => {
      window.dispatchEvent(new Event('wheel'))
    })
    act(() => sections.report([{ isIntersecting: true, target: section('B10'), boundingClientRect: { top: 300 } }]))
    await waitFor(() => expect(screen.getByRole('button', { name: '4' }).getAttribute('aria-current')).toBe('page'))

    // Whole page: each page in a slot as tall as the column, so only one is in view.
    const slot = document.querySelector('[data-page-slot="1"]') as HTMLElement
    expect(slot.className).toContain('h-[calc(100vh-9rem)]')
    expect(slot.className).toContain('snap-start')
    expect(screen.getByLabelText(/: every page$/).className).toContain('snap-mandatory')
  })

  it('jumps the column to a page from the page buttons', async () => {
    const user = userEvent.setup({ delay: null })
    stubFetch()
    renderPartB()
    await waitFor(() => expect(screen.getAllByLabelText(/^Page \d+ of 9$/)).toHaveLength(9))
    const viewer = screen.getByLabelText(/: every page$/)
    const scrollTo = vi.fn()
    viewer.scrollTo = scrollTo as never
    await user.click(screen.getByRole('button', { name: '7' }))
    expect(screen.getByRole('button', { name: '7' }).getAttribute('aria-current')).toBe('page')
    expect(scrollTo).toHaveBeenCalled()
  })

  it('shows Part B’s question numbers as they are', () => {
    renderPartB()
    const links = within(screen.getByRole('navigation', { name: 'Questions' })).getAllByRole('link').map((l) => l.textContent)
    expect(links.slice(0, 4)).toEqual(['Company', 'B1', 'B2', 'B3'])
  })

  it('saves with Ctrl+S', async () => {
    const user = userEvent.setup({ delay: null })
    const fetchMock = stubFetch()
    renderPartB()
    await user.click(within(within(section('B2')).getByRole('radiogroup')).getByLabelText('Yes'))
    await user.keyboard('{Control>}s{/Control}')
    await waitFor(() => expect(fetchMock.mock.calls.some(([, i]) => i?.method === 'PUT')).toBe(true))
  })

  it('downloads the PDF of the answers on screen, filling it again first when they have changed', async () => {
    const user = userEvent.setup({ delay: null })
    const fetchMock = stubFetch()
    const clicked: string[] = []
    const realCreate = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = realCreate(tag)
      if (tag === 'a') el.addEventListener('click', (e) => { e.preventDefault(); clicked.push((el as HTMLAnchorElement).download) })
      return el
    })
    URL.createObjectURL = vi.fn(() => 'blob:preview')
    URL.revokeObjectURL = vi.fn()
    renderPartB()
    const previews = () => fetchMock.mock.calls.filter(([u]) => String(u) === '/api/admin/cvl/case-1/preview')
    await waitFor(() => expect(previews()).toHaveLength(1))
    await user.type(within(section('B1')).getByLabelText('Name'), ' Jr')
    await user.click(screen.getByRole('button', { name: /Download/ }))
    await waitFor(() => expect(clicked).toHaveLength(1))
    // Filled again for the changed answers before it was saved as a file; nothing saved as a draft.
    expect(previews()).toHaveLength(2)
    expect(fetchMock.mock.calls.some(([, i]) => i?.method === 'PUT')).toBe(false)
    expect(clicked[0]).toMatch(/^report-on-company-activities-and-property-part-b-jordan-sample.pdf$/)
  })
})

describe('CvlFormEditor — Form 509 summary', () => {
  function render509() {
    const map = formVersion('509').map
    const prefill = prefillForm('509', 'company', context())
    render(
      <CvlFormEditor caseId="case-1" clientId="cl_1" map={entryMap(map)} subject="company" subjects={[{ subject: 'company', label: 'Company' }]} prefill={prefill} initial={entryState(map, prefill, null)} saved={null} />,
    )
  }
  /** The row of the summary table whose first cell is this label, and its two amount cells. */
  const row = (label: string) => {
    const cell = screen.getAllByRole('cell').find((c) => c.textContent === label || c.textContent?.startsWith(`${label}to:`))!
    const [valuation, erv] = [...(cell.parentElement as HTMLElement).querySelectorAll('td')].slice(1)
    return { valuation: valuation.querySelector('input'), erv: erv.querySelector('input') }
  }

  it('shows TOTAL assets (Valuation) and TOTAL estimated realisable values (ERV) as they will print: added up while blank, replaced when typed', async () => {
    const user = userEvent.setup({ delay: null })
    render509()
    const totalAssets = row('TOTAL assets')
    const totalErv = row('TOTAL estimated realisable values')
    // The pre-fill's book values already add up in the Valuation total.
    expect(totalAssets.valuation!.value).toBe('')
    const before = Number(totalAssets.valuation!.placeholder.replace(/,/g, ''))
    expect(before).toBeGreaterThan(0)

    // Two estimated realisable values typed: the ERV total shows their sum.
    await user.type(row('1(a) Interest in land').erv!, '12500')
    await user.type(row('1(b) Sundry debtors').erv!, '2500.5')
    // A decimal point typed stays put while typing (it used to vanish: "2500." became 2500, then "25005").
    expect(row('1(b) Sundry debtors').erv!.value).toBe('2500.5')
    await user.type(row('1(c) Cash on hand').erv!, '12.50')
    expect(row('1(c) Cash on hand').erv!.value).toBe('12.50')
    expect(totalErv.erv!.placeholder).toBe('15,013')
    expect(totalErv.erv!.value).toBe('')
    // A Valuation typed into 1(a) joins the Valuation total (in place of what was there).
    const landBefore = Number(row('1(a) Interest in land').valuation!.value || 0)
    await user.clear(row('1(a) Interest in land').valuation!)
    await user.type(row('1(a) Interest in land').valuation!, '100')
    expect(Number(totalAssets.valuation!.placeholder.replace(/,/g, ''))).toBe(before - landBefore + 100)

    // Each total also shows in the other total row, same column: TOTAL estimated realisable values'
    // Valuation is TOTAL assets' Valuation; TOTAL assets' ERV is TOTAL estimated realisable values' ERV.
    expect(totalErv.valuation!.placeholder).toBe(totalAssets.valuation!.placeholder)
    expect(totalAssets.erv!.placeholder).toBe('15,013')
    expect(totalAssets.erv!.title).toMatch(/The same as TOTAL estimated realisable values: Estimated realisable value/)

    // Typed, the total is the typed amount; its copy follows it.
    await user.type(totalErv.erv!, '99')
    expect(totalErv.erv!.value).toBe('99')
    expect(totalAssets.erv!.placeholder).toBe('99')
    // A copy typed over is its own amount.
    await user.type(totalAssets.erv!, '5')
    expect(totalAssets.erv!.value).toBe('5')
  })

  it('names Form 509’s sections in full in the jump links, never as initials', () => {
    render509()
    const links = within(screen.getByRole('navigation', { name: 'Questions' })).getAllByRole('link').map((l) => l.textContent)
    expect(links).toEqual(['Lodgement details', 'Company details', 'Summary of assets', 'Summary of liabilities', 'Signature'])
  })

  it('puts each amount under the column it prints in, in the form’s own words', () => {
    render509()
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toContain('Estimated realisable value')
    const debtors = row('1(b) Sundry debtors')
    expect(debtors.valuation?.value).toBe('12480.5')
    expect(debtors.erv?.value).toBe('')
    // Both totals have a box in each column; TOTAL assets' Valuation shows what it adds up to.
    expect(row('TOTAL assets').valuation?.placeholder).toBe('47,234.67')
    expect(row('TOTAL assets').erv).not.toBeNull()
    expect(row('TOTAL estimated realisable values').valuation).not.toBeNull()
    expect(row('TOTAL estimated realisable values').erv).not.toBeNull()
    // Every liability line, as the form words it, with a box in both columns.
    for (const label of [
      '3 Less preferential creditors entitled to priority over the holders of debentures under any floating charge',
      '4 Less amounts owing and secured by debenture or floating charge over company’s assets',
      '5 Less preferential creditors estimated amount available for unsecured creditors',
      '6 Creditors (unsecured) amount claimed',
      '7 Balances owing to partly secured creditors total claims security held',
      '8 Contingent assets estimated to produce',
      '9 Contingent liabilities estimated to rank for estimated deficiency/surplus (subject to costs of administration/liquidation)',
      'Share capital issued',
      'Share capital paid up',
    ]) {
      expect(row(label).valuation, label).not.toBeNull()
      expect(row(label).erv, label).not.toBeNull()
    }
    // The book share capital goes in Valuation.
    expect(row('Share capital issued').valuation?.value).toBe('100')
    expect(row('Share capital issued').erv?.value).toBe('')
    // Line 7 is one line on the form: one row here, not two.
    expect(screen.getAllByRole('cell').filter((c) => c.textContent?.startsWith('7 Balances owing'))).toHaveLength(1)
    // Line 4's "…assets to:" blank is in line 4's own row, not a box of its own.
    const to = screen.getByLabelText('4 … over company’s assets to: (who holds the debenture or charge)')
    expect(to.closest('td')?.textContent).toMatch(/^4 Less amounts owing and secured by debenture or floating charge over company’s assetsto:/)
  })

  it('types amounts from the left', () => {
    render509()
    for (const input of [row('1(b) Sundry debtors').valuation!, row('6 Creditors (unsecured) amount claimed').erv!]) {
      expect(input.className).not.toMatch(/text-right/)
    }
  })

  it('warns when an amount box holds more than fits (text prints as typed)', async () => {
    const user = userEvent.setup({ delay: null })
    render509()
    const erv = row('1(a) Interest in land').erv!
    await user.click(erv)
    await user.paste('d cmsd cm dsmv dsmv m vjnd vnjkdnvjkdnvjkdfvjdfnvjndfjvnjdvnjdfnvjdnvjdnvjnfvjndfvjndfjvnfdjvnjfkdnvj')
    expect(erv.getAttribute('aria-invalid')).toBe('true')
    expect(document.getElementById(erv.getAttribute('aria-describedby')!)!.textContent).toMatch(/^Too long for its box on the form: the last \d+ characters won’t print\./)
    // An ordinary amount fits.
    await user.clear(erv)
    await user.type(erv, '1250000')
    expect(erv.getAttribute('aria-invalid')).toBeNull()
  })
})
