import { describe, expect, it } from 'vitest'

import { countTokens, countEntryTokens, __resetTokenCache, __tokenCacheSize } from './tokens'

describe('countTokens', () => {
  it('returns 0 for empty text', () => {
    expect(countTokens('')).toBe(0)
  })

  it('counts whitespace-only text as real tokens, not empty', () => {
    expect(countTokens('   ')).toBeGreaterThan(0)
  })

  it('counts a known short string', () => {
    // Not pinned to an exact number: the encoding table is a dependency detail.
    // Pinned instead to the invariant that matters for budget-fill — monotonic
    // and proportional, never zero for non-empty text.
    const short = countTokens('hello world')
    const long = countTokens('hello world '.repeat(50))
    expect(short).toBeGreaterThan(0)
    expect(long).toBeGreaterThan(short * 40)
  })

  it('counts a tiktoken special-token literal instead of throwing', () => {
    // js-tiktoken's encode() defaults to disallowedSpecial: "all" and throws
    // on literals like "<|endoftext|>" — real user/LLM prose can contain
    // them, and a throw mid budget-fill loop or mid render is not acceptable.
    expect(() => countTokens('the end <|endoftext|> more')).not.toThrow()
    expect(countTokens('the end <|endoftext|> more')).toBeGreaterThan(0)
  })
})

describe('countEntryTokens', () => {
  it('caches per entry id and does not recount identical content', () => {
    __resetTokenCache()
    expect(__tokenCacheSize()).toBe(0)
    const first = countEntryTokens('entry_1', 'the gate groaned open')
    expect(__tokenCacheSize()).toBe(1)
    const second = countEntryTokens('entry_1', 'the gate groaned open')
    expect(second).toBe(first)
    expect(__tokenCacheSize()).toBe(1)
  })

  it('recounts when an entry id is reused with different content', () => {
    // Entry content is immutable per id in normal operation, but reader edits
    // rewrite content under the same id — a content-blind cache would then
    // report the pre-edit count forever.
    __resetTokenCache()
    const before = countEntryTokens('entry_1', 'short')
    const after = countEntryTokens('entry_1', 'a considerably longer body of text than before')
    expect(after).toBeGreaterThan(before)
  })
})
