import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { JsonpParseError, asRecord, unwrapJsonp } from '../jsonp'

/**
 * Peeling the JSONP wrapper off an ABR response.
 *
 * The register answers with a script, not JSON, and it answers 200 with HTML
 * when it is unhappy — so "unwrap it" and "check it is actually JSON" are the
 * same job and both belong here. Fixtures are the raw bodies, read off disk;
 * nothing in this file touches the network.
 */

function fixture(name: string): string {
  return readFileSync(join(__dirname, 'fixtures', `${name}.txt`), 'utf8')
}

describe('unwrapJsonp', () => {
  it('unwraps a real MatchingNames body', () => {
    const payload = asRecord(unwrapJsonp(fixture('matching_names_multi')))
    expect(Array.isArray(payload.Names)).toBe(true)
    // All six rows as the register sent them. Trimming the weak tail is the
    // parser's job, not this one's.
    expect((payload.Names as unknown[]).length).toBe(6)
  })

  it('unwraps a real AbnDetails body', () => {
    const payload = asRecord(unwrapJsonp(fixture('abn_details_company')))
    expect(payload.Abn).toBe('53004085616')
    expect(payload.EntityTypeCode).toBe('PRV')
  })

  it('accepts a callback name other than "callback"', () => {
    expect(unwrapJsonp('abrJsonpCallback({"Abn":"1"})')).toEqual({ Abn: '1' })
  })

  it('accepts a dotted callback name', () => {
    expect(unwrapJsonp('window.cb({"Abn":"1"});')).toEqual({ Abn: '1' })
  })

  it('tolerates surrounding whitespace and a newline-wrapped payload', () => {
    expect(unwrapJsonp('\n  callback(\n  {"Abn": "1"}\n  ) ;\n')).toEqual({ Abn: '1' })
  })

  it('accepts a bare JSON body, in case the register stops wrapping', () => {
    expect(unwrapJsonp('{"Abn":"1"}')).toEqual({ Abn: '1' })
  })

  it('keeps nested parentheses inside string values', () => {
    expect(unwrapJsonp('callback({"Name":"SMITH (HOLDINGS) PTY LTD"})')).toEqual({
      Name: 'SMITH (HOLDINGS) PTY LTD',
    })
  })

  it('rejects the HTML the register serves instead of an error status', () => {
    const html = '<html><body><h1>Service Unavailable</h1></body></html>'
    expect(() => unwrapJsonp(html)).toThrow(JsonpParseError)
  })

  it('rejects an empty body', () => {
    expect(() => unwrapJsonp('   ')).toThrow(JsonpParseError)
  })

  it('rejects a wrapper with nothing in it', () => {
    expect(() => unwrapJsonp('callback()')).toThrow(JsonpParseError)
  })

  it('rejects truncated JSON inside a valid wrapper', () => {
    expect(() => unwrapJsonp('callback({"Abn":"530040856')).toThrow(JsonpParseError)
  })

  it('never puts the response body in the error message', () => {
    // These bodies carry registered addresses, and this message reaches logs.
    try {
      unwrapJsonp('callback({"EntityName":"SMITH PTY LTD","Address":"12 Bourke St')
      expect.unreachable('should have thrown')
    } catch (err) {
      expect((err as Error).message).not.toContain('Bourke')
      expect((err as Error).message).not.toContain('SMITH')
    }
  })
})

describe('asRecord', () => {
  it('passes a plain object through', () => {
    expect(asRecord({ a: 1 })).toEqual({ a: 1 })
  })

  it.each([
    ['null', 'callback(null)'],
    ['an array', 'callback([1,2])'],
    ['a bare string', 'callback("nope")'],
  ])('rejects %s', (_label, body) => {
    expect(() => asRecord(unwrapJsonp(body))).toThrow(JsonpParseError)
  })
})
