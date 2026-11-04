/**
 * Server-only. The one way this app talks to an AI model: Claude, through
 * OpenRouter (MCR's account), for the comparison and lodgement summaries and
 * for suggesting what an unknown printed label means. No figure is ever read
 * by a model from a PDF's text: the financial statements are read by code
 * (src/lib/printed). The one exception (Gabby-approved, 4 Nov 2026, CLAUDE.md
 * rule 12): the page IMAGE of a SCANNED statement page, for the second,
 * independent reading of a scan (askClaudeImage, src/lib/scan). Nothing else.
 *
 * Claude via OpenRouter, Anthropic only, no training, no logging; Anthropic may retain requests for a limited period for safety monitoring. Approved by Gabby on 4 November 2026.
 *
 * Every request is pinned to Anthropic with OpenRouter's provider preferences
 * (CLAUDE_ONLY): only Anthropic, no fallback to any other provider, and no
 * provider that trains on or collects the data (data_collection: 'deny').
 * Prompt logging is off on MCR's OpenRouter account (an account setting, not
 * a request field). If OpenRouter cannot honour Anthropic-only with no data
 * collection it refuses the request, and the call fails: the feature degrades
 * (no summary, no AI suggestion, a single reading of a scan) rather than the
 * data going anywhere else. An answer reported as served by anyone but
 * Anthropic is thrown away. Zero data retention is not required (option A,
 * Gabby, 4 Nov 2026): no zero-retention Claude endpoint is offered.
 *
 * Off unless AI_SUMMARIES_ENABLED is "true" and OPENROUTER_API_KEY is set.
 * Logs the generation id, model and token counts only, never the content.
 *
 * OPENROUTER_API_KEY is read here and nowhere else.
 */
import OpenAI from 'openai'

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'

/** The current Claude models on OpenRouter (checked 25 Oct 2026); overridable by env. */
export const DEFAULT_SUMMARY_MODEL = 'anthropic/claude-sonnet-5.5'
export const DEFAULT_LABEL_MODEL = 'anthropic/claude-haiku-5.5'
export const DEFAULT_SCAN_MODEL = 'anthropic/claude-sonnet-5.5'

export type ClaudePurpose = 'summary' | 'labels' | 'scan'

/**
 * OpenRouter provider preferences sent with every request
 * (https://openrouter.ai/docs/features/provider-routing).
 */
export const CLAUDE_ONLY = {
  only: ['anthropic'],
  allow_fallbacks: false,
  data_collection: 'deny',
} as const

/** The AI features are off (flag or key missing), or the call could not be made safely. */
export class AiUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AiUnavailableError'
  }
}

export function aiSummariesEnabled(): boolean {
  return process.env.AI_SUMMARIES_ENABLED === 'true' && !!process.env.OPENROUTER_API_KEY
}

/** The model for a purpose: env OPENROUTER_SUMMARY_MODEL / OPENROUTER_LABEL_MODEL, else the default. Claude only. */
export function claudeModel(purpose: ClaudePurpose): string {
  const env = { summary: process.env.OPENROUTER_SUMMARY_MODEL, labels: process.env.OPENROUTER_LABEL_MODEL, scan: process.env.OPENROUTER_SCAN_MODEL }[purpose]
  const fallback = { summary: DEFAULT_SUMMARY_MODEL, labels: DEFAULT_LABEL_MODEL, scan: DEFAULT_SCAN_MODEL }[purpose]
  const model = env?.trim() || fallback
  if (!model.startsWith('anthropic/')) throw new AiUnavailableError(`Only Claude models may be used: "${model}" is not one.`)
  return model
}

/**
 * Current Claude models think before they answer, and the thinking counts
 * against max_tokens: a 300-token answer budget could be spent before any text.
 * Callers give the answer's length; this much room is added for the thinking,
 * which is kept short (OpenRouter `reasoning`: low effort, not returned).
 */
const THINKING_ROOM = 4000
const REASONING = { effort: 'low', exclude: true } as const

export interface ClaudeAnswer {
  text: string
  model: string
  generationId: string
}

export interface AskOptions {
  purpose: ClaudePurpose
  prompt: string
  maxTokens: number
  /** Names the call in the log ("comparison-summary"). Never content. */
  label: string
  timeoutMs?: number
}

function client(timeoutMs: number): OpenAI {
  return new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: OPENROUTER_BASE_URL,
    timeout: timeoutMs,
    maxRetries: 2,
    defaultHeaders: {
      'HTTP-Referer': process.env.PUBLIC_APP_URL ?? 'https://mcr-partners.local',
      'X-Title': 'MCR Partners SBR Portal',
    },
  })
}

/** One prompt to Claude via OpenRouter, Anthropic only, no data retained. Throws when off or unsafe. */
export async function askClaude({ purpose, prompt, maxTokens, label, timeoutMs = 60_000 }: AskOptions): Promise<ClaudeAnswer> {
  if (!aiSummariesEnabled()) throw new AiUnavailableError('AI features are off (AI_SUMMARIES_ENABLED or OPENROUTER_API_KEY).')
  const model = claudeModel(purpose)
  const response = await client(timeoutMs).chat.completions.create({
    model,
    max_tokens: maxTokens + THINKING_ROOM,
    messages: [{ role: 'user', content: prompt }],
    // OpenRouter's extensions: not in the OpenAI SDK's types.
    ...({ provider: CLAUDE_ONLY, reasoning: REASONING } as object),
  })

  const served = (response as unknown as { provider?: string }).provider
  if ((served && !/anthropic/i.test(served)) || !response.model?.startsWith('anthropic/')) {
    console.error(`[ai] ${label} generation=${response.id} refused: not served by Anthropic (${served ?? 'unknown'}, ${response.model})`)
    throw new AiUnavailableError('The answer did not come from Anthropic, so it was not used.')
  }
  const usage = response.usage
  console.log(`[ai] ${label} generation=${response.id} provider=${served ?? 'unknown'} model=${response.model} tokens_in=${usage?.prompt_tokens ?? '?'} tokens_out=${usage?.completion_tokens ?? '?'}`)

  const text = response.choices[0]?.message?.content?.trim() ?? ''
  if (!text) throw new Error(`${label}: the model returned no text.`)
  return { text, model: response.model, generationId: response.id }
}

/** The second reading of scanned statement pages: on whenever the key is set (it does not depend on the summaries flag). */
export function scanReadingEnabled(): boolean {
  return !!process.env.OPENROUTER_API_KEY
}

export interface ImageAnswer extends ClaudeAnswer {
  tokensIn: number
  tokensOut: number
}

/**
 * One scanned statement page image to Claude, with the same routing as
 * askClaude: Anthropic only, no fallback, no data collection (no training);
 * an answer served by anyone else is thrown away. Only for src/lib/scan.
 * Logs the generation id, model and token counts, never the image or the answer.
 */
export async function askClaudeImage({
  prompt,
  image,
  mediaType,
  maxTokens,
  label,
  timeoutMs = 120_000,
}: {
  prompt: string
  image: Uint8Array
  mediaType: 'image/jpeg' | 'image/png'
  maxTokens: number
  label: string
  timeoutMs?: number
}): Promise<ImageAnswer> {
  if (!scanReadingEnabled()) throw new AiUnavailableError('OPENROUTER_API_KEY is not set.')
  const model = claudeModel('scan')
  const response = await client(timeoutMs).chat.completions.create({
    model,
    max_tokens: maxTokens,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:${mediaType};base64,${Buffer.from(image).toString('base64')}` } },
          { type: 'text', text: prompt },
        ],
      },
    ],
    ...({ provider: CLAUDE_ONLY, reasoning: REASONING } as object),
  })
  const served = (response as unknown as { provider?: string }).provider
  if ((served && !/anthropic/i.test(served)) || !response.model?.startsWith('anthropic/')) {
    console.error(`[ai] ${label} generation=${response.id} refused: not served by Anthropic (${served ?? 'unknown'}, ${response.model})`)
    throw new AiUnavailableError('The answer did not come from Anthropic, so it was not used.')
  }
  const tokensIn = response.usage?.prompt_tokens ?? 0
  const tokensOut = response.usage?.completion_tokens ?? 0
  console.log(`[ai] ${label} generation=${response.id} provider=${served ?? 'unknown'} model=${response.model} tokens_in=${tokensIn} tokens_out=${tokensOut}`)
  const text = response.choices[0]?.message?.content?.trim() ?? ''
  if (!text) throw new Error(`${label}: the model returned no text.`)
  return { text, model: response.model, generationId: response.id, tokensIn, tokensOut }
}
