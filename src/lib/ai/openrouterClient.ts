/**
 * Server-only. Returns an OpenAI SDK client configured for OpenRouter's
 * OpenAI-compatible endpoint. OpenRouter routes our requests to underlying
 * providers (Gemini 2.5 Flash by default for this project) and bills via the
 * one OpenRouter account.
 *
 * Why OpenRouter rather than calling Google directly:
 *   - Unified billing / single API key across providers
 *   - Native PDF input support via the file-parser plugin
 *   - Trivial provider swap later (change the model string only)
 *   - OpenAI-compatible — uses the same `openai` SDK we'd use for any
 *     OpenAI-compatible provider, no special Google SDK to learn
 *
 * Must only be imported from API routes (extract-financials,
 * financials-comparison, analyse-lodgements) — never from a component.
 */
import OpenAI from 'openai'

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'

export interface OpenRouterClientOptions {
  /** Per-request timeout in ms. Default 300_000 (5 min) for PDF extraction;
   *  callers doing short narrative generation can drop to 60_000. */
  timeoutMs?: number
  /** SDK-level automatic retries. Default 2. */
  maxRetries?: number
}

export function getOpenRouterClient(opts: OpenRouterClientOptions = {}): OpenAI {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not set.')

  return new OpenAI({
    apiKey,
    baseURL: OPENROUTER_BASE_URL,
    timeout: opts.timeoutMs ?? 300_000,
    maxRetries: opts.maxRetries ?? 2,
    defaultHeaders: {
      'HTTP-Referer': process.env.PUBLIC_APP_URL ?? 'https://mcr-partners.local',
      'X-Title': 'MCR Partners SBR Portal',
    },
  })
}
