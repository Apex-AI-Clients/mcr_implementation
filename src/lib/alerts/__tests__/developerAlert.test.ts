import { describe, it, expect, vi, beforeEach } from 'vitest'

/** Technical problems go to the developer, once while open (24 Nov 2026). Synthetic. */

const send = vi.fn(async () => undefined)
vi.mock('@/lib/email/resend', () => ({ sendDeveloperAlert: (...a: unknown[]) => send(...(a as [])) }))
const { raiseDeveloperAlert } = await import('../developerAlert')

function fakeDb(open: boolean, insertError: { code: string } | null = null) {
  const calls: { op: string; table: string; payload?: unknown }[] = []
  const chain = (result: unknown) => {
    const c: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'is', 'limit', 'single']) c[m] = () => c
    c.then = (resolve: (r: unknown) => unknown) => resolve(result)
    return c
  }
  const db = {
    from: (table: string) => ({
      select: () => chain({ data: open ? [{ id: 'a1' }] : [], error: null }),
      insert: (payload: unknown) => {
        calls.push({ op: 'insert', table, payload })
        return chain({ data: insertError ? null : { id: 'new' }, error: insertError })
      },
      update: (payload: unknown) => {
        calls.push({ op: 'update', table, payload })
        return chain({ data: null, error: null })
      },
    }),
  }
  return { db: db as never, calls }
}

const ALERT = { kind: 'lead_form', key: 'lead_form:x', subject: 'Lead form check', lines: ['Facebook form 151728… is sending a field we don’t recognise: q1'] }

describe('raiseDeveloperAlert', () => {
  beforeEach(() => send.mockClear())

  it('logs it and emails the developer, then marks it emailed', async () => {
    const { db, calls } = fakeDb(false)
    expect(await raiseDeveloperAlert(db, ALERT)).toBe('sent')
    expect(send).toHaveBeenCalledWith({ subject: 'Lead form check', text: ALERT.lines.join('\n') })
    expect(calls.map((c) => c.op)).toEqual(['insert', 'update'])
  })

  it('says nothing again while the same problem is open', async () => {
    const { db } = fakeDb(true)
    expect(await raiseDeveloperAlert(db, ALERT)).toBe('already_open')
    expect(send).not.toHaveBeenCalled()
  })

  it('another request raising it at the same moment: sent once', async () => {
    const { db } = fakeDb(false, { code: '23505' })
    expect(await raiseDeveloperAlert(db, ALERT)).toBe('already_open')
    expect(send).not.toHaveBeenCalled()
  })

  it('never throws: a failed email is kept on the row', async () => {
    send.mockRejectedValueOnce(new Error('ALERT_EMAIL is not set'))
    const { db, calls } = fakeDb(false)
    expect(await raiseDeveloperAlert(db, ALERT)).toBe('failed')
    expect(calls.at(-1)).toMatchObject({ op: 'update', payload: { email_error: 'ALERT_EMAIL is not set' } })
  })
})
