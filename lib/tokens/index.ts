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

// js-tiktoken's merge is quadratic in one regex word, and o200k's pattern takes a whole run of
// either kind as one word. Cutting a long run keeps the cost linear, within about 1% on its count.
const LONGEST_ENCODED_RUN = 512
const LONG_RUN = new RegExp(
  `\\S{${LONGEST_ENCODED_RUN + 1},}|\\s{${LONGEST_ENCODED_RUN + 1},}`,
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

// The id keys the memo but the content is stored beside the count and compared
// on read: a reader edit rewrites an entry's body under its existing id, and a
// hit that checked only the id would serve the pre-edit count for the rest of
// the session.
const entryTokens = new Map<string, { content: string; tokens: number }>()
let entryTokensComputeCount = 0

export function countEntryTokens(entryId: string, content: string): number {
  const hit = entryTokens.get(entryId)
  if (hit !== undefined && hit.content === content) return hit.tokens
  const tokens = countTokens(content)
  entryTokensComputeCount += 1
  entryTokens.set(entryId, { content, tokens })
  return tokens
}

export function __resetTokenCache(): void {
  entryTokens.clear()
  entryTokensComputeCount = 0
}

// Test seam — exposes the entry-token cache size so a test can prove a hit
// reuses the memo rather than recompute.
export function __tokenCacheSize(): number {
  return entryTokens.size
}

// Test seam — counts countTokens() calls made on behalf of countEntryTokens
// (cache misses) so a test can prove a hit skips recomputation, not just that
// the map stays the same size.
export function __tokenComputeCount(): number {
  return entryTokensComputeCount
}
