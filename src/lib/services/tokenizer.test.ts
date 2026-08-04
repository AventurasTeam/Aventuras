import { describe, it, expect } from 'vitest'
import { countTokens, encodeText, getCharPerTokenRatio, tokenizer } from './tokenizer'

describe('tokenizer', () => {
  it('returns 0 for empty or falsy text', () => {
    expect(countTokens('')).toBe(0)
    expect(encodeText('')).toEqual([])
    expect(getCharPerTokenRatio('')).toBe(4)
  })

  it('counts tokens accurately for English text', () => {
    const text = 'The quick brown fox jumps over the lazy dog.'
    const count = countTokens(text)

    expect(count).toBeGreaterThan(5)
    expect(count).toBeLessThan(15)
  })

  it('encodes text to array of token IDs', () => {
    const text = 'Hello world'
    const tokens = encodeText(text)

    expect(Array.isArray(tokens)).toBe(true)
    expect(tokens.length).toBe(2)
  })

  it('exports singleton tokenizer interface', () => {
    expect(tokenizer.countTokens('test')).toBe(countTokens('test'))
  })
})
