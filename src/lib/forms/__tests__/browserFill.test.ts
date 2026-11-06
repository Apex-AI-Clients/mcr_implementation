// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest'
import { extractText, getDocumentProxy } from 'unpdf'
import { fillOfficialForm, readTemplate } from '../fill'
import { fillInBrowser } from '../browserFill'
import { SAMPLE_PARTB } from './fixtures/samples'
import { formVersion } from '../registry'
import { cvlFillOptions } from '@/lib/cvl/printPages'

/**
 * The fill-in screen's preview, filled in the browser: the same PDF the
 * server fills, the template fetched once per form. Synthetic answers.
 */

afterEach(() => vi.unstubAllGlobals())

async function texts(pdf: Uint8Array): Promise<string[]> {
  const { text } = await extractText(await getDocumentProxy(new Uint8Array(pdf)), { mergePages: false })
  return text
}

describe('fillInBrowser', () => {
  it('fills the same pages, with the same answers, as the server, fetching the template once', async () => {
    const template = await readTemplate('507b')
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe('/api/admin/cvl/templates/507b?version=20220801')
      return new Response(template.slice())
    })
    vi.stubGlobal('fetch', fetchMock)

    const answers = { fields: SAMPLE_PARTB.fields, tables: SAMPLE_PARTB.tables ?? {}, signedBy: null }
    const browser = await fillInBrowser('507b', '20220801', answers)
    // The server fill with the same CVL rule: every page, every table page.
    const server = await fillOfficialForm('507b', { fields: SAMPLE_PARTB.fields, tables: SAMPLE_PARTB.tables }, cvlFillOptions(formVersion('507b').map))

    expect(browser.pageSources).toEqual(server.pageSources)
    expect(await texts(browser.pdf)).toEqual(await texts(server.pdf))

    // A second preview of the same form: no second download.
    await fillInBrowser('507b', '20220801', answers)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  }, 60_000)

  it('never draws what is written by hand, as the server does not', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response((await readTemplate('507b')).slice())))
    const fill = await fillInBrowser('507b', '20220801', { fields: { b6_password: 'secret-pass-123' }, tables: {}, signedBy: null })
    expect((await texts(fill.pdf)).join(' ')).not.toContain('secret-pass-123')
  }, 60_000)

  it('fails, so the screen can ask the server, when the template cannot be fetched; and tries again next time', async () => {
    const fetchMock = vi.fn(async () => new Response('nope', { status: 500 }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(fillInBrowser('509', '2011', { fields: {}, tables: {}, signedBy: null })).rejects.toThrow()
    await expect(fillInBrowser('509', '2011', { fields: {}, tables: {}, signedBy: null })).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
