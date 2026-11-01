import { Tiktoken } from 'js-tiktoken/lite'
import o200kBase from 'js-tiktoken/ranks/o200k_base'

// Every provider is an estimate here, so o200k is picked to track the modern
// field's vocab scale: ASCII matches cl100k exactly, non-Latin runs ~30% lower.
// The BPE map build is ~285ms and a 200k-entry Map; the 2.2 MB rank table is a
// static import (countTokens must stay sync for the pure ranker).
let encoder: Tiktoken | null = null

/** The tokenizer vocabulary behind countTokens, frozen for the probe capture (lib/db → CaptureTokenizer). */
export const TOKENIZER_IDENTITY = { encoding: 'o200k_base', version: '1' } as const

function getEncoder(): Tiktoken {
  encoder ??= new Tiktoken(o200kBase)
  return encoder
}

/** Builds the encoder ahead of the first count; a no-op once it exists. */
export function warmTokenEncoder(): void {
  getEncoder()
}

// js-tiktoken's merge is quadratic in one regex word, and o200k takes a run of non-whitespace, of
// whitespace, or of newlines and slashes after punctuation as one. Cutting all three caps a word
// at 1,025 code points, so the cost stays linear; each cut moves the count by a few tokens.
const LONGEST_ENCODED_RUN = 512
const LONG_RUN = new RegExp(
  `\\S{${LONGEST_ENCODED_RUN + 1},}|\\s{${LONGEST_ENCODED_RUN + 1},}|[\\r\\n/]{${LONGEST_ENCODED_RUN + 1},}`,
  'gu',
)
const RUN_PIECE = new RegExp(`[\\s\\S]{1,${LONGEST_ENCODED_RUN}}`, 'gu')

function encodedLength(text: string): number {
  // Empty allow/disallow lists: tiktoken special-token literals (e.g.
  // "<|endoftext|>") can appear in ordinary user/LLM prose here, and the
  // default "disallowedSpecial: all" throws instead of counting them.
  return getEncoder().encode(text, [], []).length
}

export function countTokens(text: string): number {
  if (text === '') return 0
  let tokens = 0
  let encodedTo = 0
  for (const match of text.matchAll(LONG_RUN)) {
    if (match.index > encodedTo) tokens += encodedLength(text.slice(encodedTo, match.index))
    for (const [piece] of match[0].matchAll(RUN_PIECE)) tokens += encodedLength(piece)
    encodedTo = match.index + match[0].length
  }
  if (encodedTo < text.length) tokens += encodedLength(text.slice(encodedTo))
  return tokens
}
