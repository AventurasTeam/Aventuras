import { Tiktoken } from 'js-tiktoken/lite'
import cl100kBase from 'js-tiktoken/ranks/cl100k_base'

// The BPE map build is ~135ms and two 100k-entry Maps; the 1.1 MB rank table
// itself is a static import (countTokens must stay sync for the pure ranker).
let encoder: Tiktoken | null = null

function getEncoder(): Tiktoken {
  encoder ??= new Tiktoken(cl100kBase)
  return encoder
}

export function countTokens(text: string): number {
  if (text === '') return 0
  // Empty allow/disallow lists: tiktoken special-token literals (e.g.
  // "<|endoftext|>") can appear in ordinary user/LLM prose here, and the
  // default "disallowedSpecial: all" throws instead of counting them.
  return getEncoder().encode(text, [], []).length
}

// Content is part of the key, not just the id: a reader edit rewrites an
// entry's body under its existing id, and an id-only cache would serve the
// pre-edit count for the rest of the session.
const entryTokens = new Map<string, { content: string; tokens: number }>()

export function countEntryTokens(entryId: string, content: string): number {
  const hit = entryTokens.get(entryId)
  if (hit !== undefined && hit.content === content) return hit.tokens
  const tokens = countTokens(content)
  entryTokens.set(entryId, { content, tokens })
  return tokens
}

export function __resetTokenCache(): void {
  entryTokens.clear()
}

// Test seam — exposes the entry-token cache size so a test can prove a hit
// reuses the memo rather than recompute.
export function __tokenCacheSize(): number {
  return entryTokens.size
}
