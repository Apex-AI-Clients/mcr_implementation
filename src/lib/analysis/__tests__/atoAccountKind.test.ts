import { describe, it, expect } from 'vitest'
import {
  UNRECOGNISED_NOTE,
  atoFileInfo,
  entityMatches,
  fileAtoAccount,
  readAtoAccountHeader,
} from '../atoAccountKind'

/** Which ATO account a CSV is, from its first two lines. Synthetic data only. */

const HEADER = 'Processed date,Effective date,Description,Debit (DR),Credit (CR),Balance'
const csv = (line1: string, line2 = 'EXAMPLE TRADING PTY LTD') =>
  `"${line1}"\n"${line2}"\n${HEADER}\n"01 Oct 2026","01 Oct 2026","'Payment received","","$100.00","$900.00 DR"\n`

describe('reading the account from line 1 and the entity from line 2', () => {
  it.each([
    ['Activity statement 001', 'activity_statement'],
    ['Activity statement 002', 'activity_statement'],
    ['Income tax 001', 'income_tax'],
    ['Superannuation guarantee employer 005', 'super_guarantee'],
  ])('%s is %s', (label, kind) => {
    expect(readAtoAccountHeader(csv(label))).toEqual({ kind, label, entityName: 'EXAMPLE TRADING PTY LTD' })
  })

  it('does not care about the filename, a byte-order mark or Windows line endings', () => {
    const text = '﻿' + csv('Income tax 001').replace(/\n/g, '\r\n')
    expect(readAtoAccountHeader(text).kind).toBe('income_tax')
  })

  it('calls anything else unrecognised, without throwing', () => {
    expect(readAtoAccountHeader(csv('Fringe benefits tax 001')).kind).toBe('unrecognised')
    expect(readAtoAccountHeader('')).toEqual({ kind: 'unrecognised', label: null, entityName: null })
    expect(readAtoAccountHeader('"unterminated').kind).toBe('unrecognised')
  })
})

describe('filing by account type', () => {
  it('moves a file put in the wrong slot, saying so', () => {
    expect(fileAtoAccount('integrated_client_account', 'income_tax')).toEqual({
      category: 'ato_income_tax_account',
      note: 'This is an income tax account; moved to ATO income tax account',
    })
    expect(fileAtoAccount('ato_income_tax_account', 'super_guarantee')).toEqual({
      category: 'ato_super_guarantee_account',
      note: 'This is a superannuation guarantee account; moved to ATO superannuation guarantee account',
    })
    expect(fileAtoAccount('ato_super_guarantee_account', 'activity_statement')).toEqual({
      category: 'integrated_client_account',
      note: 'This is an activity statement account; moved to ATO activity statement',
    })
  })

  it('leaves a file in the right slot alone', () => {
    expect(fileAtoAccount('ato_income_tax_account', 'income_tax')).toEqual({ category: 'ato_income_tax_account', note: null })
  })

  it('keeps an unrecognised account where it was put', () => {
    expect(fileAtoAccount('ato_income_tax_account', 'unrecognised')).toEqual({
      category: 'ato_income_tax_account',
      note: UNRECOGNISED_NOTE,
    })
  })
})

describe("the entity against the client's names", () => {
  it('matches ignoring case, punctuation and Pty Ltd', () => {
    expect(entityMatches('EXAMPLE TRADING PTY LTD', ['Example Trading Pty. Ltd.'])).toBe(true)
    expect(entityMatches('THE EXAMPLE FAMILY TRUST', ['Someone', 'Example Family Trust'])).toBe(true)
  })

  it('does not match another entity, and has nothing to say without names', () => {
    expect(entityMatches('OTHER CONTRACTORS PTY LTD', ['Example Trading Pty Ltd'])).toBe(false)
    expect(entityMatches('OTHER CONTRACTORS PTY LTD', [null, ''])).toBeNull()
    expect(entityMatches(null, ['Example Trading'])).toBeNull()
  })

  it('warns on the file row only when they differ', () => {
    const row = { ato_account_label: 'Income tax 001', ato_entity_name: 'OTHER CONTRACTORS PTY LTD', category_note: null }
    expect(atoFileInfo(row, ['Example Trading Pty Ltd'])).toEqual({
      atoAccountLabel: 'Income tax 001',
      categoryNote: null,
      entityWarning:
        "This account is for OTHER CONTRACTORS PTY LTD, which does not match the client's company or trust name. Check it is the right client.",
    })
    expect(atoFileInfo({ ...row, ato_entity_name: 'EXAMPLE TRADING PTY LTD' }, ['Example Trading Pty Ltd']).entityWarning).toBeNull()
  })
})
