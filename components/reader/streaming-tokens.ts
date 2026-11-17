import { countTokens } from '@/lib/tokens'

export type StreamingTokens = { reply: number; reasoning: number }

export const NO_STREAMING_TOKENS: StreamingTokens = { reply: 0, reasoning: 0 }

/**
 * The live counts after one more chunk (reader-composer.md → Streaming entry): each chunk is counted
 * as it lands, one small encode, never a recount of the whole reply.
 */
export function withChunk(
  tokens: StreamingTokens,
  channel: 'text' | 'reasoning',
  text: string,
): StreamingTokens {
  const counted = countTokens(text)
  return channel === 'reasoning'
    ? { ...tokens, reasoning: tokens.reasoning + counted }
    : { ...tokens, reply: tokens.reply + counted }
}
