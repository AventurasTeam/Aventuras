import type { LanguageModelUsage } from 'ai'
import { describe, expect, it } from 'vitest'

import { tokenFiguresOf } from './usage-figures'

// As the SDK hands usage over: a figure the server didn't send already reads as 0 here.
function usage(raw: NonNullable<LanguageModelUsage['raw']> | undefined): LanguageModelUsage {
  return {
    inputTokens: 1200,
    inputTokenDetails: { noCacheTokens: 1200, cacheReadTokens: 0, cacheWriteTokens: 0 },
    outputTokens: 300,
    outputTokenDetails: { textTokens: 300, reasoningTokens: 0 },
    totalTokens: 1500,
    raw,
  }
}

// data-model.md → Entry metadata shape: cache and reasoning figures only when the provider sent them.
describe('tokenFiguresOf', () => {
  it('reads nothing from a call that reported no counts', () => {
    const none = { ...usage(undefined), inputTokens: undefined, outputTokens: undefined }

    expect(tokenFiguresOf(undefined, 'openai-compatible')).toBeUndefined()
    expect(tokenFiguresOf(none, 'openai-compatible')).toBeUndefined()
  })

  it('leaves out the figures an OpenAI-compatible server sent no block for', () => {
    expect(tokenFiguresOf(usage({ prompt_tokens: 1200 }), 'openai-compatible')).toEqual({
      prompt: 1200,
      completion: 300,
    })
  })

  it("records an OpenAI-compatible server's cache read and reasoning, 0 included", () => {
    const sent = usage({
      prompt_tokens_details: { cached_tokens: 0 },
      completion_tokens_details: { reasoning_tokens: 0 },
    })
    const cached = usage({
      prompt_tokens_details: { cached_tokens: 1100 },
      completion_tokens_details: { reasoning_tokens: 120 },
    })

    expect(tokenFiguresOf(sent, 'openai-compatible')).toEqual({
      prompt: 1200,
      completion: 300,
      reasoning: 0,
      cacheRead: 0,
    })
    expect(tokenFiguresOf(cached, 'openai-compatible')).toEqual({
      prompt: 1200,
      completion: 300,
      reasoning: 120,
      cacheRead: 1100,
    })
  })

  it("records Anthropic's cache read and write, and no reasoning it never reports", () => {
    const raw = {
      input_tokens: 100,
      cache_read_input_tokens: 900,
      cache_creation_input_tokens: 200,
    }

    expect(tokenFiguresOf(usage(raw), 'anthropic')).toEqual({
      prompt: 1200,
      completion: 300,
      cacheRead: 900,
      cacheWrite: 200,
    })
  })

  it('reads no figure of one shape off another provider', () => {
    const anthropicShaped = usage({ cache_read_input_tokens: 900 })
    const openaiShaped = usage({ prompt_tokens_details: { cached_tokens: 900 } })

    expect(tokenFiguresOf(anthropicShaped, 'openai-compatible')).toEqual({
      prompt: 1200,
      completion: 300,
    })
    expect(tokenFiguresOf(openaiShaped, 'anthropic')).toEqual({ prompt: 1200, completion: 300 })
  })

  it('ignores a figure that is not a finite number', () => {
    const odd = usage({
      prompt_tokens_details: { cached_tokens: null },
      completion_tokens_details: { reasoning_tokens: 'many' },
    })

    expect(tokenFiguresOf(odd, 'openai-compatible')).toEqual({ prompt: 1200, completion: 300 })
  })
})
