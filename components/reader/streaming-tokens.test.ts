import { describe, expect, it } from 'vitest'

import { countTokens } from '@/lib/tokens'

import { NO_STREAMING_TOKENS, withChunk } from './streaming-tokens'

describe('withChunk', () => {
  it('adds each chunk to its own channel', () => {
    const reasoned = withChunk(NO_STREAMING_TOKENS, 'reasoning', 'The keeper lied about the tide.')
    const replied = withChunk(reasoned, 'text', 'The lantern swung once.')

    expect(replied).toEqual({
      reasoning: countTokens('The keeper lied about the tide.'),
      reply: countTokens('The lantern swung once.'),
    })
  })

  it('sums chunk by chunk rather than recounting the reply', () => {
    const chunks = ['The lan', 'tern swung', ' once.']
    const total = chunks.reduce(
      (tokens, text) => withChunk(tokens, 'text', text),
      NO_STREAMING_TOKENS,
    )

    expect(total.reply).toBe(chunks.reduce((n, text) => n + countTokens(text), 0))
    expect(total.reasoning).toBe(0)
  })
})
