/**
 * Unwrapping ABR's JSONP.
 *
 * The register's /json/ endpoints are not a JSON API — they answer with a
 * script, `callback({...});`, meant to be loaded through a <script> tag with
 * the GUID sitting in the page source. We fetch them server-side instead and
 * peel the wrapper off by hand.
 *
 * Nothing here trusts the body. A rejected GUID, a maintenance window or a
 * WAF in front of the register all answer 200 with HTML, so "it came back" and
 * "it is JSON" are separate questions and this module answers the second one.
 */

export class JsonpParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'JsonpParseError'
  }
}

/**
 * `callback({...})` -> the parsed object.
 *
 * The callback name is matched loosely rather than pinned to "callback": ABR
 * echoes back whatever `&callback=` asked for, and a future caller changing
 * that should not silently break parsing. A bare JSON body is accepted too, in
 * case the register ever stops wrapping.
 *
 * Throws JsonpParseError on anything that is not parseable JSON — including
 * the HTML error pages the register serves in place of a status code.
 */
export function unwrapJsonp(body: string): unknown {
  const trimmed = body.trim()
  if (!trimmed) throw new JsonpParseError('Empty response body.')

  // A trailing semicolon is part of the script, not the payload. Whitespace
  // either side of it goes with it — ABR is not consistent about either.
  const statement = trimmed.replace(/\s*;+\s*$/, '')

  // identifier ( … ) — the identifier may be dotted (window.cb), and the
  // payload may run over as many lines as it likes.
  const wrapped = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\s*\(([\s\S]*)\)$/.exec(statement)
  const payload = wrapped ? wrapped[1].trim() : statement

  if (!payload) throw new JsonpParseError('JSONP wrapper contained no payload.')

  try {
    return JSON.parse(payload)
  } catch {
    // Deliberately does not include the body: an ABR response can carry an
    // entity's registered address, and this message ends up in server logs.
    throw new JsonpParseError('Response was not valid JSON.')
  }
}

/** Narrowing helper — every ABR payload is a plain object. */
export function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new JsonpParseError('Response was not a JSON object.')
  }
  return value as Record<string, unknown>
}
