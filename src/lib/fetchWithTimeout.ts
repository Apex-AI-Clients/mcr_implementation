/**
 * fetch with a time limit (24 Nov 2026: CVL Save / Download could stay busy for good when a request
 * never came back). On timeout the request is aborted and a TimeoutError is thrown with a message
 * staff can act on. Browser and server alike.
 */

export class TimeoutError extends Error {
  constructor(message = 'The server took too long to answer. Please try again.') {
    super(message)
    this.name = 'TimeoutError'
  }
}

export async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}, ms = 30_000): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  // A caller's own signal still aborts it.
  const outer = init.signal
  const onOuterAbort = () => controller.abort()
  outer?.addEventListener('abort', onOuterAbort)
  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } catch (err) {
    if (controller.signal.aborted && !outer?.aborted) throw new TimeoutError()
    throw err
  } finally {
    clearTimeout(timer)
    outer?.removeEventListener('abort', onOuterAbort)
  }
}

/** Any promise with a time limit (a PDF filled in the browser): rejects with TimeoutError when it takes longer. */
export function withTimeout<T>(promise: Promise<T>, ms: number, message?: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(message)), ms)
    promise.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      },
    )
  })
}
