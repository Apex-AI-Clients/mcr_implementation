// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/** The Claude-via-OpenRouter client. The SDK is mocked: no request leaves the test. */

const create = vi.fn()
vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create } }
  },
}))

const { askClaude, aiSummariesEnabled, claudeModel, AiUnavailableError, CLAUDE_ONLY, DEFAULT_SUMMARY_MODEL } = await import('../openrouterClient')

const answer = (over: Record<string, unknown> = {}) => ({
  id: 'gen-123',
  model: 'anthropic/claude-sonnet-5.5',
  provider: 'Anthropic',
  usage: { prompt_tokens: 100, completion_tokens: 20 },
  choices: [{ message: { content: ' The summary. ' } }],
  ...over,
})

beforeEach(() => {
  vi.stubEnv('AI_SUMMARIES_ENABLED', 'true')
  vi.stubEnv('OPENROUTER_API_KEY', 'test-key-placeholder')
  vi.stubEnv('OPENROUTER_SUMMARY_MODEL', '')
  create.mockReset()
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => vi.unstubAllEnvs())

describe('askClaude', () => {
  it('sends every request to Anthropic only, with no data collection and zero data retention', async () => {
    create.mockResolvedValue(answer())
    const out = await askClaude({ purpose: 'summary', prompt: 'Summarise.', maxTokens: 300, label: 'test' })
    expect(out).toEqual({ text: 'The summary.', model: 'anthropic/claude-sonnet-5.5', generationId: 'gen-123' })
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ model: DEFAULT_SUMMARY_MODEL, max_tokens: 300, provider: CLAUDE_ONLY }))
    expect(CLAUDE_ONLY).toEqual({ only: ['anthropic'], allow_fallbacks: false, data_collection: 'deny', zdr: true })
  })

  it('logs the generation id and token counts, never the prompt or the answer', async () => {
    create.mockResolvedValue(answer())
    await askClaude({ purpose: 'summary', prompt: 'SECRET FIGURES 123,456', maxTokens: 300, label: 'test' })
    const logged = vi.mocked(console.log).mock.calls.flat().join(' ')
    expect(logged).toContain('generation=gen-123')
    expect(logged).toContain('tokens_in=100')
    expect(logged).not.toContain('SECRET')
    expect(logged).not.toContain('The summary')
  })

  it('throws the answer away when it was not served by Anthropic', async () => {
    create.mockResolvedValue(answer({ provider: 'SomeoneElse' }))
    await expect(askClaude({ purpose: 'summary', prompt: 'x', maxTokens: 10, label: 'test' })).rejects.toBeInstanceOf(AiUnavailableError)
    create.mockResolvedValue(answer({ model: 'google/gemini-2.5-flash' }))
    await expect(askClaude({ purpose: 'summary', prompt: 'x', maxTokens: 10, label: 'test' })).rejects.toBeInstanceOf(AiUnavailableError)
  })

  it('makes no request while the flag is off or the key is missing', async () => {
    vi.stubEnv('AI_SUMMARIES_ENABLED', '')
    expect(aiSummariesEnabled()).toBe(false)
    await expect(askClaude({ purpose: 'summary', prompt: 'x', maxTokens: 10, label: 'test' })).rejects.toBeInstanceOf(AiUnavailableError)
    vi.stubEnv('AI_SUMMARIES_ENABLED', 'true')
    vi.stubEnv('OPENROUTER_API_KEY', '')
    expect(aiSummariesEnabled()).toBe(false)
    expect(create).not.toHaveBeenCalled()
  })

  it('takes the models from env, Claude only', () => {
    vi.stubEnv('OPENROUTER_LABEL_MODEL', 'anthropic/claude-haiku-5.5')
    expect(claudeModel('labels')).toBe('anthropic/claude-haiku-5.5')
    vi.stubEnv('OPENROUTER_SUMMARY_MODEL', 'google/gemini-2.5-flash')
    expect(() => claudeModel('summary')).toThrow(AiUnavailableError)
  })
})
