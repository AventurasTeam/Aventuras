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

export function countTokens(text: string): number {
  if (text === '') return 0
  // Empty allow/disallow lists: tiktoken special-token literals (e.g.
  // "<|endoftext|>") can appear in ordinary user/LLM prose here, and the
  // default "disallowedSpecial: all" throws instead of counting them.
  return getEncoder().encode(text, [], []).length
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
