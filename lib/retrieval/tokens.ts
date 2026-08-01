import { Tiktoken } from 'js-tiktoken/lite'
import cl100kBase from 'js-tiktoken/ranks/cl100k_base'

// Lazily constructed: the rank table is ~1.5 MB of JSON and nothing outside a
// turn or the progress strip needs it, so app start never pays for it.
let encoder: Tiktoken | null = null

function getEncoder(): Tiktoken {
  encoder ??= new Tiktoken(cl100kBase)
  return encoder
}

export function countTokens(text: string): number {
  if (text === '') return 0
  return getEncoder().encode(text).length
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
