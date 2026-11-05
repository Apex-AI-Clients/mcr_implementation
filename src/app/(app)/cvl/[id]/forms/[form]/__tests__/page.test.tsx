import { describe, it, expect, vi, beforeEach } from 'vitest'

/** The CVL form page: reads everything at once, then opens the subject asked for with its own draft. Synthetic data. */

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('notFound')
  },
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`)
  },
}))
vi.mock('@/lib/supabase/server', () => ({ getSupabaseServerClient: vi.fn() }))
vi.mock('@/lib/cvl/context', () => ({ loadCvlContext: vi.fn() }))
// The editor itself has its own tests: here only what the page hands it.
vi.mock('@/components/cvl/CvlFormEditor', () => ({ CvlFormEditor: (props: unknown) => ({ type: 'editor', props }) }))

import CvlFormPage from '../page'
import { getSupabaseServerClient } from '@/lib/supabase/server'
import { loadCvlContext } from '@/lib/cvl/context'
import { context } from '@/lib/cvl/__tests__/fixtures'

const DRAFTS = [
  { subject: 'director:1', answers: { fields: { B1_name: 'Jordan Sample' }, tables: {} }, edited_keys: ['B1_name'], form_version: '20220801', updated_by: 'staff', updated_at: '2026-11-01T00:00:00Z' },
  { subject: 'director:2', answers: { fields: { B1_name: 'Casey Example' }, tables: {} }, edited_keys: [], form_version: '20220801', updated_by: 'staff', updated_at: '2026-11-02T00:00:00Z' },
]

let queried: string[] = []

beforeEach(() => {
  queried = []
  const rows: Record<string, unknown> = {
    clients: { id: 'cl_1', archived_at: null, workflow: 'cvl', cvl_cases: { removed_at: null } },
    cvl_cases: { id: 'case-1' },
    cvl_form_answers: DRAFTS,
  }
  vi.mocked(getSupabaseServerClient).mockReturnValue({
    from: (table: string) => {
      queried.push(table)
      const result = { data: rows[table] ?? null, error: null }
      const chain = {
        select: () => chain,
        eq: () => chain,
        is: () => chain,
        maybeSingle: () => Promise.resolve(result),
        then: (resolve: (r: typeof result) => unknown) => resolve(result),
      }
      return chain
    },
  } as never)
  // Two directors: Jordan Sample and Casey Example.
  vi.mocked(loadCvlContext).mockResolvedValue(context())
})

const open = async (form: string, subject?: string) =>
  (await CvlFormPage({ params: Promise.resolve({ id: 'cl_1', form }), searchParams: Promise.resolve(subject ? { subject } : {}) })) as unknown as {
    props: { subject: string; saved: { at: string } | null; subjects: { label: string }[] }
  }

describe('CVL form page', () => {
  it('opens the director asked for, with that director’s draft', async () => {
    const page = await open('507b', 'director:2')
    expect(page.props.subject).toBe('director:2')
    expect(page.props.saved?.at).toBe('2026-11-02T00:00:00Z')
    expect(page.props.subjects.map((s) => s.label)).toEqual(['Jordan Sample', 'Casey Example'])
    // The client, its case, and the drafts: each read once.
    expect(queried.sort()).toEqual(['clients', 'cvl_cases', 'cvl_form_answers'])
  })

  it('opens the first director, with their draft, when none (or one the file has not got) is asked for', async () => {
    expect((await open('507b')).props.saved?.at).toBe('2026-11-01T00:00:00Z')
    expect((await open('507b', 'director:7')).props.subject).toBe('director:1')
  })

  it('starts from the pre-fill when the subject has no draft', async () => {
    const page = await open('509')
    expect(page.props.subject).toBe('company')
    expect(page.props.saved).toBeNull()
  })

  it('answers not found for a form that does not exist', async () => {
    await expect(open('999')).rejects.toThrow('notFound')
  })
})
