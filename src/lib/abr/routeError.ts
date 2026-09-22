import { NextResponse } from 'next/server'
import { JsonpParseError } from './jsonp'
import { UPSTREAM_FAILED, UPSTREAM_TIMEOUT } from './messages'
import { AbrTimeoutError, AbrUnavailableError } from './service'

/**
 * One place that turns an ABR failure into an answer. SERVER ONLY.
 *
 * Shared by both proxy routes so they cannot drift, but the real reason it
 * exists is that the first live failure was unreadable: a timeout, a 500 from
 * the register and an HTML error page all came back as one 502 with one
 * sentence, and there was no way to tell from the browser which had happened.
 *
 * So each kind now carries its own status code and a `reason` tag. The tag is
 * for whoever is looking at the network tab at 6pm — it costs nothing, names no
 * internals, and turns "the lookup failed" into something answerable. The
 * `error` string stays the thing that is safe to show a person.
 */
export function abrFailureResponse(route: string, err: unknown): NextResponse {
  const detail = err instanceof Error ? err.message : String(err)

  // Checked before AbrUnavailableError, which it extends.
  if (err instanceof AbrTimeoutError) {
    console.error(`[${route}] ABR timed out: ${detail}`)
    return NextResponse.json({ error: UPSTREAM_TIMEOUT, reason: 'timeout' }, { status: 504 })
  }

  if (err instanceof JsonpParseError) {
    // The register answering 200 with an HTML error page lands here.
    console.error(`[${route}] ABR sent an unparseable response: ${detail}`)
    return NextResponse.json({ error: UPSTREAM_FAILED, reason: 'unparseable' }, { status: 502 })
  }

  if (err instanceof AbrUnavailableError) {
    console.error(`[${route}] ABR unreachable: ${detail}`)
    return NextResponse.json({ error: UPSTREAM_FAILED, reason: 'unreachable' }, { status: 502 })
  }

  // A bug on our side, not the register's. Logged with the error itself.
  console.error(`[${route}] unexpected lookup failure: ${detail}`, err)
  return NextResponse.json({ error: UPSTREAM_FAILED, reason: 'unexpected' }, { status: 500 })
}
