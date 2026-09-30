// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { PDFDocument } from 'pdf-lib'

vi.mock('@/lib/auth/staff', () => ({ requireStaffUser: vi.fn() }))

import { requireStaffUser } from '@/lib/auth/staff'
import { POST } from '../route'
import { ASIC_PDF_MAX_BYTES, UPLOAD_MESSAGES } from '@/lib/asic/upload'
import { MAX_EXTRACT_PAGES } from '@/lib/asic/extractText'
import {
  JANE,
  NEVER_EXTRACTED,
  RAJ,
  SAMPLE,
  addresses,
  cover,
  currentExtract,
  end,
  officeholders,
  organisation,
} from '@/lib/asic/__tests__/fixtures/extract'
import {
  buildExtractPdf,
  buildImageOnlyPdf,
  buildInvoicePdf,
} from '@/lib/asic/__tests__/fixtures/pdf'

/**
 * POST /api/asic/extract-pdf, end to end on SYNTHETIC PDFs built with pdf-lib:
 * the real route, the real text extraction, the real parser. Only the staff
 * session is mocked.
 *
 * Every console call and any use of fetch is captured for the whole file, so
 * each test also proves that nothing from the document was logged and nothing
 * left the server.
 */

const FILENAME = 'Sample Trading Pty Ltd - Current Company Extract.pdf'

const logged: string[] = []
const fetchSpy = vi.fn(() => {
  throw new Error('the route must not make network calls')
})

function upload(
  bytes: Uint8Array | string,
  { type = 'application/pdf', field = 'file', headers = {} as Record<string, string> } = {},
) {
  const form = new FormData()
  form.append(field, new File([bytes as BlobPart], FILENAME, { type }))
  return new NextRequest('http://localhost/api/asic/extract-pdf', {
    method: 'POST',
    body: form,
    headers,
  })
}

async function body(response: Response) {
  return (await response.json()) as { error?: string; reason?: string; extract?: unknown }
}

beforeEach(() => {
  logged.length = 0
  fetchSpy.mockClear()
  vi.stubGlobal('fetch', fetchSpy)
  vi.mocked(requireStaffUser).mockResolvedValue({ id: 'staff-1' } as never)
  for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      logged.push(args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' '))
    })
  }
})

afterEach(() => {
  expect(fetchSpy).not.toHaveBeenCalled()

  // Nothing from the document, in any log line, whatever the outcome.
  const output = logged.join('\n')
  const sensitive = [
    ...NEVER_EXTRACTED,
    FILENAME,
    'Sample Trading',
    'SAMPLE',
    'Jane',
    'JANE',
    'Raj',
    'RAJ',
    '1970',
    '1981',
    SAMPLE.acn,
    SAMPLE.acnSpaced,
    SAMPLE.abn,
    'Sample Road',
    'Melbourne',
    'MELBOURNE',
  ]
  for (const text of sensitive) expect(output).not.toContain(text)
  // And every line is the route's own outcome line, nothing else.
  for (const line of logged) {
    expect(line).toMatch(
      /^\[POST \/api\/asic\/extract-pdf\] outcome=[a-z_]+(?: pages=\d+)?(?: error=[A-Za-z]+)?$/,
    )
  }

  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('POST /api/asic/extract-pdf — who may call it', () => {
  it('answers 401 without a staff session, before reading the body', async () => {
    vi.mocked(requireStaffUser).mockResolvedValue(null)
    const request = upload(await buildExtractPdf(currentExtract()))
    const formData = vi.spyOn(request, 'formData')

    const response = await POST(request)

    expect(response.status).toBe(401)
    expect(await body(response)).toEqual({ error: 'Unauthorized' })
    expect(formData).not.toHaveBeenCalled()
  })
})

describe('POST /api/asic/extract-pdf — a synthetic extract', () => {
  it('returns the fields, and logs only the outcome and page count', async () => {
    const pdf = await buildExtractPdf(currentExtract([JANE, RAJ], [JANE]), {
      linesPerPage: 30,
      header: cover().slice(0, 3),
    })

    const response = await POST(upload(pdf))

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    const { extract } = await body(response)
    expect(extract).toEqual({
      companyName: SAMPLE.company,
      acn: SAMPLE.acn,
      abn: SAMPLE.abn,
      status: 'Registered',
      registeredOffice: SAMPLE.address,
      principalPlaceOfBusiness: SAMPLE.address,
      directors: [
        { name: 'Jane Sample', dateOfBirth: '1970-03-14' },
        { name: 'Raj Example', dateOfBirth: '1981-11-02' },
      ],
      extractType: 'current',
      extractedAt: SAMPLE.extractedAt,
      warnings: [],
    })
    // Shareholders, the contact address and places of birth never leave the server.
    for (const unwanted of NEVER_EXTRACTED) expect(JSON.stringify(extract)).not.toContain(unwanted)

    expect(logged).toEqual(['[POST /api/asic/extract-pdf] outcome=ok pages=3'])
  })
})

describe('POST /api/asic/extract-pdf — what it refuses to read', () => {
  it('400 when the body is not form data', async () => {
    const response = await POST(
      new NextRequest('http://localhost/api/asic/extract-pdf', {
        method: 'POST',
        body: JSON.stringify({ file: 'nope' }),
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    expect(response.status).toBe(400)
    expect(await body(response)).toEqual({ error: UPLOAD_MESSAGES.missing, reason: 'not_form_data' })
  })

  it('400 when the form has no file, or the field is text', async () => {
    const wrongField = await POST(upload(await buildExtractPdf(currentExtract()), { field: 'pdf' }))
    expect(wrongField.status).toBe(400)
    expect((await body(wrongField)).reason).toBe('no_file')

    const form = new FormData()
    form.append('file', 'just a string')
    const text = await POST(
      new NextRequest('http://localhost/api/asic/extract-pdf', { method: 'POST', body: form }),
    )
    expect(text.status).toBe(400)
  })

  it('400 for an empty file', async () => {
    const response = await POST(upload(new Uint8Array(0)))
    expect(response.status).toBe(400)
    expect(await body(response)).toEqual({ error: UPLOAD_MESSAGES.empty, reason: 'empty' })
  })

  it('413 as JSON for a file over 4 MB', async () => {
    const big = new Uint8Array(ASIC_PDF_MAX_BYTES + 1)
    big.set(new TextEncoder().encode('%PDF-1.7\n'))

    const response = await POST(upload(big))

    expect(response.status).toBe(413)
    expect(response.headers.get('Content-Type')).toMatch(/application\/json/)
    expect(await body(response)).toEqual({ error: UPLOAD_MESSAGES.tooLarge, reason: 'too_large' })
  })

  it('413 from the declared length alone, without reading the body', async () => {
    const request = upload(await buildExtractPdf(currentExtract()), {
      headers: { 'Content-Length': String(ASIC_PDF_MAX_BYTES + 200_000) },
    })
    const formData = vi.spyOn(request, 'formData')

    const response = await POST(request)

    expect(response.status).toBe(413)
    expect(formData).not.toHaveBeenCalled()
  })

  it('accepts a file of exactly 4 MB as far as the size check goes', async () => {
    const atLimit = new Uint8Array(ASIC_PDF_MAX_BYTES)
    atLimit.set(new TextEncoder().encode('%PDF-1.7\n'))
    const response = await POST(upload(atLimit))
    // Not a real PDF, so it fails later — but not for its size.
    expect(response.status).toBe(422)
    expect((await body(response)).reason).toBe('unreadable')
  })

  it('415 when the content type is not PDF, even if the bytes are', async () => {
    const pdf = await buildExtractPdf(currentExtract())
    for (const type of ['application/octet-stream', 'image/png', '']) {
      const response = await POST(upload(pdf, { type }))
      expect(response.status).toBe(415)
      expect(await body(response)).toEqual({ error: UPLOAD_MESSAGES.notPdf, reason: 'not_pdf_type' })
    }
  })

  it('415 when the content type says PDF but the bytes do not start %PDF-', async () => {
    for (const bytes of ['PK\u0003\u0004 a renamed docx', '<html>not a pdf</html>', ' %PDF-1.7']) {
      const response = await POST(upload(bytes))
      expect(response.status).toBe(415)
      expect(await body(response)).toEqual({ error: UPLOAD_MESSAGES.notPdf, reason: 'not_pdf_bytes' })
    }
  })

  it('422 for a PDF that cannot be opened', async () => {
    const response = await POST(upload('%PDF-1.7\nnot really a pdf at all'))
    expect(response.status).toBe(422)
    expect(await body(response)).toEqual({ error: UPLOAD_MESSAGES.unreadable, reason: 'unreadable' })
  })

  it('422 for a PDF with too many pages, before any text is read', async () => {
    const doc = await PDFDocument.create()
    for (let i = 0; i <= MAX_EXTRACT_PAGES; i++) doc.addPage([595, 842])

    const response = await POST(upload(await doc.save()))

    expect(response.status).toBe(422)
    expect((await body(response)).reason).toBe('too_many_pages')
    expect(logged).toEqual([
      `[POST /api/asic/extract-pdf] outcome=too_many_pages pages=${MAX_EXTRACT_PAGES + 1}`,
    ])
  })
})

describe('POST /api/asic/extract-pdf — PDFs it reads but rejects', () => {
  it('422 with the fill-by-hand message for an image-only PDF', async () => {
    const response = await POST(upload(await buildImageOnlyPdf()))
    expect(response.status).toBe(422)
    expect(await body(response)).toEqual({
      error: 'This PDF has no readable text. Fill the fields in by hand.',
      reason: 'no_text',
    })
    expect(logged).toEqual(['[POST /api/asic/extract-pdf] outcome=no_text pages=1'])
  })

  it('422 for a PDF that is not an ASIC extract', async () => {
    const response = await POST(upload(await buildInvoicePdf()))
    expect(response.status).toBe(422)
    expect((await body(response)).reason).toBe('not_asic_extract')
  })

  it('422 when the ABN does not belong to the ACN', async () => {
    const pdf = await buildExtractPdf([
      ...cover(),
      ...organisation({ abn: SAMPLE.otherAbn }),
      ...addresses(),
      ...officeholders([JANE]),
      ...end(),
    ])
    const response = await POST(upload(pdf))
    expect(response.status).toBe(422)
    const answer = await body(response)
    expect(answer.reason).toBe('abn_acn_mismatch')
    expect(answer.extract).toBeUndefined()
  })

  it('422 when the ACN fails its check digit', async () => {
    const pdf = await buildExtractPdf([
      ...cover(),
      ...organisation({ acn: '123 456 789', abn: null }),
      ...officeholders([JANE]),
      ...end(),
    ])
    const response = await POST(upload(pdf))
    expect(response.status).toBe(422)
    expect((await body(response)).reason).toBe('acn_invalid')
  })
})
