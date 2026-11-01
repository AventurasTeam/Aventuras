import type { Tiktoken } from 'js-tiktoken/lite'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  countTokens,
  countEntryTokens,
  __resetTokenCache,
  __tokenCacheSize,
  __tokenComputeCount,
} from './index'

describe('countTokens', () => {
  it('returns 0 for empty text', () => {
    expect(countTokens('')).toBe(0)
  })

  it('counts whitespace-only text as real tokens, not empty', () => {
    expect(countTokens('   ')).toBeGreaterThan(0)
  })

  it('pins the encoding every token budget is calibrated against', () => {
    // Swapping the rank table silently re-scales every budget-fill decision, and
    // ASCII counts identically under cl100k/o200k — only non-Latin separates
    // them, so the pin has to be non-Latin to bite (cl100k counts this 31).
    expect(countTokens('彼は剣を抜いた。彼女は逃げた。誰も動かなかった。')).toBe(21)
  })

  it('counts a known short string', () => {
    // Pinned to the invariant that matters for budget-fill — monotonic and
    // proportional, never zero for non-empty text.
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
    expect(__tokenComputeCount()).toBe(1)
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

describe('warmTokenEncoder', () => {
  afterEach(() => {
    vi.doUnmock('js-tiktoken/lite')
    vi.resetModules()
  })

  // The encoder is module state, so the spy needs a fresh instance of this module.
  async function freshModuleCountingBuilds() {
    const built = vi.fn()
    vi.resetModules()
    vi.doMock('js-tiktoken/lite', async (importOriginal) => {
      const actual = await importOriginal<{ Tiktoken: typeof Tiktoken }>()
      class CountedTiktoken extends actual.Tiktoken {
        constructor(...args: ConstructorParameters<typeof Tiktoken>) {
          super(...args)
          built()
        }
      }
      return { ...actual, Tiktoken: CountedTiktoken }
    })
    return { built, tokens: await import('./index') }
  }

  it('builds the encoder, and a later warm or count reuses it', async () => {
    const { built, tokens } = await freshModuleCountingBuilds()
    expect(built).not.toHaveBeenCalled()

    tokens.warmTokenEncoder()
    expect(built).toHaveBeenCalledTimes(1)

    tokens.warmTokenEncoder()
    tokens.countTokens('the gate groaned open')
    tokens.countTokens('and the hall beyond it stood empty')
    expect(built).toHaveBeenCalledTimes(1)
  })

  it('reuses the encoder a count already built', async () => {
    const { built, tokens } = await freshModuleCountingBuilds()

    tokens.countTokens('the gate groaned open')
    tokens.warmTokenEncoder()
    expect(built).toHaveBeenCalledTimes(1)
  })
})
