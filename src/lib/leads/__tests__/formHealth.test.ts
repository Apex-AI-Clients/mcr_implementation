import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ getSupabaseServerClient: vi.fn() }))

import { getSupabaseServerClient } from '@/lib/supabase/server'
import {
  assessFacebookFormHealth,
  formHealthMessage,
  getFacebookFormHealth,
  shortFormId,
  type HealthSubmission,
} from '../formHealth'

/**
 * Facebook form health. Synthetic data; form ids, keys and counts only.
 */

const NEW_FORM = '1751128836351174'
const OLD_FORM = '28013150661698238'
const NEW_KEY = 'which_australian_state_are_you_in?_(e.g._vic,_nsw,_qld)'

function sub(formId: string, day: number, extra: Partial<HealthSubmission> = {}): HealthSubmission {
  return {
    meta_form_id: formId,
    received_at: `2026-11-${String(day).padStart(2, '0')}T01:00:00Z`,
    meta_field_keys: ['full_name', 'email', 'phone_number', 'which_state_are_you_from?', 'inbox_url'],
    state: 'NSW',
    meta_state_raw: null,
    meta_state_options: null,
    debt_min: 100_000,
    debt_max: 250_000,
    ...extra,
  }
}

describe('assessFacebookFormHealth — unmapped keys', () => {
  it('says nothing when every key is mapped and every field filled', () => {
    expect(assessFacebookFormHealth([sub(OLD_FORM, 1), sub(OLD_FORM, 2), sub(OLD_FORM, 3)], [])).toEqual([])
  })

  it('flags a key the field map does not claim, with how many leads carried it', () => {
    const keys = ['full_name', 'email', 'phone_number', 'how_did_you_hear_about_us?']
    const issues = assessFacebookFormHealth(
      [sub(NEW_FORM, 4, { meta_field_keys: keys }), sub(NEW_FORM, 5, { meta_field_keys: keys })],
      [],
      new Set([NEW_FORM]),
    )
    expect(issues).toEqual([
      { kind: 'unmapped_key', formId: NEW_FORM, key: 'how_did_you_hear_about_us?', leads: 2, isNew: true },
    ])
  })

  it('no longer flags the Nov 2026 state key, now that it is mapped', () => {
    // Checked against the map as deployed: the fix clears the warning at once,
    // even though stored enquiries still carry the key.
    const keys = ['full_name', 'email', 'phone_number', NEW_KEY, 'inbox_url']
    expect(assessFacebookFormHealth([sub(NEW_FORM, 4, { meta_field_keys: keys })], [])).toEqual([])
  })

  it('ignores inbox_url and the deliberately ignored qualifying questions', () => {
    const keys = ['full_name', 'inbox_url', 'are_you_looking_to_reduce_your_ato_debt?']
    expect(assessFacebookFormHealth([sub(OLD_FORM, 4, { meta_field_keys: keys })], [])).toEqual([])
  })

  it('tolerates enquiries stored before migration 0051 (no keys)', () => {
    expect(
      assessFacebookFormHealth(
        [sub(OLD_FORM, 1, { meta_field_keys: null }), sub(OLD_FORM, 2, { meta_field_keys: undefined })],
        [],
      ),
    ).toEqual([])
  })
})

describe('assessFacebookFormHealth — blank fields', () => {
  const blankState = { state: null, meta_state_raw: null, meta_state_options: null }

  it('flags State when the form\'s last three leads all arrived without one', () => {
    const issues = assessFacebookFormHealth(
      [sub(NEW_FORM, 5, blankState), sub(NEW_FORM, 6, blankState), sub(NEW_FORM, 7, blankState)],
      [],
    )
    expect(issues).toEqual([{ kind: 'blank_field', formId: NEW_FORM, field: 'state', streak: 3, isNew: false }])
  })

  it('does not flag one or two skipped answers', () => {
    expect(assessFacebookFormHealth([sub(NEW_FORM, 5, blankState), sub(NEW_FORM, 6, blankState)], [])).toEqual([])
    expect(
      assessFacebookFormHealth(
        [sub(NEW_FORM, 5, blankState), sub(NEW_FORM, 6, blankState), sub(NEW_FORM, 7)],
        [],
      ),
    ).toEqual([])
  })

  it('looks at the latest three, not the first three', () => {
    // Fixed on the 8th: older blanks no longer count.
    const rows = [
      sub(NEW_FORM, 5, blankState),
      sub(NEW_FORM, 6, blankState),
      sub(NEW_FORM, 7, blankState),
      sub(NEW_FORM, 8),
    ]
    expect(assessFacebookFormHealth(rows, [])).toEqual([])
  })

  it('does not count raw text or a grouping as blank', () => {
    const rows = [
      sub(NEW_FORM, 5, { ...blankState, meta_state_raw: 'Gold Coast' }),
      sub(NEW_FORM, 6, { ...blankState, meta_state_raw: 'NSW, VIC', meta_state_options: ['NSW', 'VIC'] }),
      sub(NEW_FORM, 7, blankState),
    ]
    expect(assessFacebookFormHealth(rows, [])).toEqual([])
  })

  it('flags Debt the same way', () => {
    const noDebt = { debt_min: null, debt_max: null }
    const issues = assessFacebookFormHealth(
      [sub(OLD_FORM, 5, noDebt), sub(OLD_FORM, 6, noDebt), sub(OLD_FORM, 7, noDebt)],
      [],
    )
    expect(issues).toEqual([{ kind: 'blank_field', formId: OLD_FORM, field: 'debt', streak: 3, isNew: false }])
  })

  it('keeps forms apart', () => {
    const rows = [sub(NEW_FORM, 5, blankState), sub(OLD_FORM, 6, blankState), sub(NEW_FORM, 7, blankState)]
    expect(assessFacebookFormHealth(rows, [])).toEqual([])
  })
})

describe('assessFacebookFormHealth — leads turned away', () => {
  it('counts rejections for a missing name, email or phone per form', () => {
    const issues = assessFacebookFormHealth(
      [],
      [
        { form_id: NEW_FORM, error: 'Missing phone', created_at: '2026-11-05T00:00:00Z' },
        { form_id: NEW_FORM, error: 'Missing phone', created_at: '2026-11-06T00:00:00Z' },
        { form_id: null, error: 'Missing name', created_at: '2026-11-06T00:00:00Z' },
        // Not a missing required field: not this check's business.
        { form_id: NEW_FORM, error: 'Invalid email: x', created_at: '2026-11-06T00:00:00Z' },
        { form_id: NEW_FORM, error: null, created_at: '2026-11-06T00:00:00Z' },
      ],
    )
    expect(issues).toEqual([
      { kind: 'rejected', formId: NEW_FORM, field: 'phone', leads: 2, isNew: false },
      { kind: 'rejected', formId: 'unknown', field: 'name', leads: 1, isNew: false },
    ])
  })
})

describe('formHealthMessage', () => {
  it('reads as asked for a new form sending an unknown key', () => {
    expect(
      formHealthMessage({ kind: 'unmapped_key', formId: NEW_FORM, key: 'a_new_question?', leads: 1, isNew: true }),
    ).toBe("New Facebook form 175112… is sending a field we don't recognise: a_new_question?")
  })

  it('drops "New" for a form that has run before', () => {
    expect(
      formHealthMessage({ kind: 'unmapped_key', formId: OLD_FORM, key: 'k', leads: 1, isNew: false }),
    ).toBe("Facebook form 280131… is sending a field we don't recognise: k")
  })

  it('words blanks and rejections', () => {
    expect(
      formHealthMessage({ kind: 'blank_field', formId: NEW_FORM, field: 'state', streak: 3, isNew: false }),
    ).toBe('Facebook form 175112…: its last 3 leads arrived with no State.')
    expect(
      formHealthMessage({ kind: 'rejected', formId: NEW_FORM, field: 'phone', leads: 1, isNew: false }),
    ).toBe('Facebook form 175112…: 1 lead was turned away for a missing phone number in the last 14 days.')
  })

  it('shortens long numeric form ids only', () => {
    expect(shortFormId(NEW_FORM)).toBe('175112…')
    expect(shortFormId('unknown')).toBe('unknown')
    expect(shortFormId('123')).toBe('123')
  })
})

describe('getFacebookFormHealth', () => {
  type Result = { data: unknown; error: { code?: string; message: string } | null }

  function client(results: Result[]) {
    const selects: string[] = []
    let i = 0
    const from = () => {
      const chain = {
        select: (cols: string) => (selects.push(cols), chain),
        eq: () => chain,
        gte: () => chain,
        lt: () => chain,
        limit: () => chain,
        then: (resolve: (v: Result) => void) => resolve(results[i++] ?? { data: [], error: null }),
      }
      return chain
    }
    vi.mocked(getSupabaseServerClient).mockReturnValue({ from } as never)
    return selects
  }

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('returns the warnings, marking a form with no earlier enquiries as new', async () => {
    const keys = ['full_name', 'a_new_question?']
    client([
      { data: [sub(NEW_FORM, 9, { meta_field_keys: keys })], error: null },
      { data: [], error: null }, // intake log
      { data: [], error: null }, // no history before the window
    ])
    expect(await getFacebookFormHealth(new Date('2026-11-11T00:00:00Z'))).toEqual([
      "New Facebook form 175112… is sending a field we don't recognise: a_new_question?",
    ])
  })

  it('never reads the intake log payload, only its form id', async () => {
    const selects = client([{ data: [], error: null }, { data: [], error: null }])
    await getFacebookFormHealth()
    expect(selects[1]).toBe('error, created_at, form_id:raw_body->>form_id')
  })

  it('works before migration 0051, without the keys column', async () => {
    const selects = client([
      { data: null, error: { code: '42703', message: 'column does not exist' } },
      { data: [], error: null },
      { data: [], error: null },
    ])
    expect(await getFacebookFormHealth()).toEqual([])
    expect(selects[0]).toContain('meta_field_keys')
    expect(selects[1]).not.toContain('meta_field_keys')
  })

  it('shows no warnings rather than failing the page', async () => {
    client([{ data: null, error: { message: 'boom' } }])
    expect(await getFacebookFormHealth()).toEqual([])
  })
})
