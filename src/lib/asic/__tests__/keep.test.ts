import { describe, expect, it } from 'vitest'
import { withAppointmentDates } from '../keep'
import { sectionPages } from '../readUpload'

/** Keeping an ASIC extract (migration 0041): what it writes. Synthetic people only. */

describe('withAppointmentDates', () => {
  const onFile = [
    { name: 'Jane Sample', dateOfBirth: '1970-03-14' },
    { name: 'Raj Example', dateOfBirth: null },
    { name: 'Added By Hand', dateOfBirth: '1990' },
  ]

  it('adds each matching director’s appointment date, by name in any case', () => {
    const { directors, matched } = withAppointmentDates(onFile, [
      { name: 'JANE SAMPLE', dateOfBirth: '1970-03-14', appointedOn: '2016-08-05' },
      { name: 'Raj Example', dateOfBirth: '1981-11-02', appointedOn: '2019-01-20' },
    ])
    expect(matched).toBe(2)
    expect(directors).toEqual([
      { name: 'Jane Sample', dateOfBirth: '1970-03-14', appointedOn: '2016-08-05' },
      { name: 'Raj Example', dateOfBirth: null, appointedOn: '2019-01-20' },
      // Not on the extract: kept as it was.
      { name: 'Added By Hand', dateOfBirth: '1990' },
    ])
  })

  it('never matches the same name with a different year of birth', () => {
    const { matched } = withAppointmentDates(onFile, [{ name: 'Jane Sample', dateOfBirth: '1975-01-01', appointedOn: '2016-08-05' }])
    expect(matched).toBe(0)
  })

  it('changes nothing else about a director: names and dates of birth stay as saved', () => {
    const { directors } = withAppointmentDates([{ name: 'Jane  Sample', dateOfBirth: '1970-03-14' }], [
      { name: 'JANE SAMPLE', dateOfBirth: '1970', appointedOn: '2016-08-05' },
    ])
    expect(directors).toEqual([{ name: 'Jane  Sample', dateOfBirth: '1970-03-14', appointedOn: '2016-08-05' }])
  })
})

describe('sectionPages', () => {
  it('finds the page each part is printed on, and nothing else', () => {
    const pages = [
      ['Current Company Extract', 'Organisation Details Document Number', 'Name: SAMPLE TRADING PTY LTD'],
      ['Address Details', 'Registered address: 1 Sample Road'],
      ['Officeholders and Other Roles', 'Appointment date: 05/08/2016'],
    ]
    expect(sectionPages(pages)).toEqual({ organisation: 1, addresses: 2, directors: 3 })
    expect(sectionPages([['nothing here']])).toEqual({ organisation: null, addresses: null, directors: null })
  })
})
