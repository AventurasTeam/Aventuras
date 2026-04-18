/**
 * Tokenizer service for accurate token counting.
 * Uses gpt-tokenizer with o200k_base encoding (used by GPT-4o, o1, etc.)
 *
 * While different models may use slightly different tokenizers, o200k_base
 * provides a good approximation for most modern LLMs and is far more accurate
 * than simple character-based estimation.
 */
import { countTokens as gptCountTokens, encode } from 'gpt-tokenizer'
import { createLogger } from '$lib/log'

const log = createLogger('Tokenizer')
const logTokenCounts = false

/**
 * Count tokens in a text string.
 * @param text - The text to count tokens for
 * @returns The number of tokens
 */
export function countTokens(text: string): number {
  if (!text) return 0

  const count = gptCountTokens(text)
  if (logTokenCounts) {
    log('countTokens', { textLength: text.length, tokenCount: count })
  }
  return count
}

/**
 * Encode text into token IDs.
 * Useful for advanced use cases like truncation at token boundaries.
 * @param text - The text to encode
 * @returns Array of token IDs
 */
export function encodeText(text: string): number[] {
  if (!text) return []
  return encode(text)
}

/**
 * Estimate the approximate character-to-token ratio for a given text.
 * Useful for understanding how a text tokenizes.
 * @param text - The text to analyze
 * @returns The ratio of characters to tokens
 */
export function getCharPerTokenRatio(text: string): number {
  if (!text) return 4 // Default fallback
  const tokens = countTokens(text)
  if (tokens === 0) return 4
  return text.length / tokens
}

// Export a singleton-like interface for consistency with other services
export const tokenizer = {
  countTokens,
  encodeText,
  getCharPerTokenRatio,
}
