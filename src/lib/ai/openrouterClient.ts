/**
 * Server-only. The one way this app talks to an AI model: Claude, through
 * OpenRouter (MCR's account), for the comparison and lodgement summaries and
 * for suggesting what an unknown printed label means. No figure is ever read
 * by a model: the financial statements are read by code (src/lib/printed).
 *
 * Every request is pinned to Anthropic with OpenRouter's provider preferences
 * (CLAUDE_ONLY): only Anthropic, no fallback to any other provider, no
 * provider that collects data, and Zero Data Retention endpoints only. If
 * OpenRouter cannot honour all of that it refuses the request, and the call
 * fails: the feature degrades (no summary, no AI suggestion) rather than the
 * data going anywhere else. An answer reported as served by anyone but
 * Anthropic is thrown away.
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

export type ClaudePurpose = 'summary' | 'labels'

/**
 * OpenRouter provider preferences sent with every request
 * (https://openrouter.ai/docs/features/provider-routing).
 */
export const CLAUDE_ONLY = {
  only: ['anthropic'],
  allow_fallbacks: false,
  data_collection: 'deny',
  zdr: true,
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
  const configured = (purpose === 'summary' ? process.env.OPENROUTER_SUMMARY_MODEL : process.env.OPENROUTER_LABEL_MODEL)?.trim()
  const model = configured || (purpose === 'summary' ? DEFAULT_SUMMARY_MODEL : DEFAULT_LABEL_MODEL)
  if (!model.startsWith('anthropic/')) throw new AiUnavailableError(`Only Claude models may be used: "${model}" is not one.`)
  return model
}

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
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
    // OpenRouter's extension: not in the OpenAI SDK's types.
    ...({ provider: CLAUDE_ONLY } as object),
  })

  const served = (response as unknown as { provider?: string }).provider
  if ((served && !/anthropic/i.test(served)) || !response.model?.startsWith('anthropic/')) {
    console.error(`[ai] ${label} generation=${response.id} refused: not served by Anthropic (${served ?? 'unknown'}, ${response.model})`)
    throw new AiUnavailableError('The answer did not come from Anthropic, so it was not used.')
  }
  const usage = response.usage
  console.log(`[ai] ${label} generation=${response.id} model=${response.model} tokens_in=${usage?.prompt_tokens ?? '?'} tokens_out=${usage?.completion_tokens ?? '?'}`)

  const text = response.choices[0]?.message?.content?.trim() ?? ''
  if (!text) throw new Error(`${label}: the model returned no text.`)
  return { text, model: response.model, generationId: response.id }
}
