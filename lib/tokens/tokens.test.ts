import { Tiktoken } from 'js-tiktoken/lite'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { countTokens } from './index'

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

describe('countTokens on long runs', () => {
  const PROSE = 'The gate groaned open, and the hall beyond it stood empty. '

  function encodedParts(text: string): string[] {
    const encode = vi.spyOn(Tiktoken.prototype, 'encode')
    countTokens(text)
    const parts = encode.mock.calls.map(([part]) => part)
    encode.mockRestore()
    return parts
  }

  const longestRun = (text: string): number =>
    Math.max(...(text.match(/\S+|\s+/gu) ?? []).map((run) => [...run].length))

  it.each([
    ['a non-whitespace run', 'x'.repeat(4_000), 500],
    ['a newline run', '\n'.repeat(4_000), 250],
    ['a space run', ' '.repeat(4_000), 32],
  ])('counts %s as the uncut encoder does', (_name, text, count) => {
    expect(countTokens(text)).toBe(count)
  })

  it('stays within a few tokens when a cut lands inside a token', () => {
    expect(Math.abs(countTokens('ha'.repeat(2_000)) - 1001)).toBeLessThanOrEqual(10)
  })

  it('stays within a few tokens per cut on unspaced prose', () => {
    const unspaced =
      '彼は剣を抜いた。彼女は逃げた。誰も動かなかった。城門の向こうには誰もいない広間があり、冷たい風だけが吹き抜けていた。'.repeat(
        20,
      )
    expect(encodedParts(unspaced).length).toBeGreaterThan(1)
    expect(Math.abs(countTokens(unspaced) - 960)).toBeLessThanOrEqual(9)
  })

  it.each([
    ['non-whitespace', 'x'],
    ['whitespace', '\n'],
  ])('sends a %s run of 512 whole and cuts one of 513', (_name, char) => {
    expect(encodedParts(char.repeat(512))).toEqual([char.repeat(512)])
    expect(encodedParts(char.repeat(513))).toEqual([char.repeat(512), char])
  })

  it('encodes the text between runs on its own', () => {
    const run = 'x'.repeat(600)
    expect(encodedParts(`intro ${run} outro`)).toEqual([
      'intro ',
      'x'.repeat(512),
      'x'.repeat(88),
      ' outro',
    ])
  })

  it('sends no empty part between adjacent runs of each kind', () => {
    expect(encodedParts(`${'x'.repeat(513)}${'\n'.repeat(513)}`)).toEqual([
      'x'.repeat(512),
      'x',
      '\n'.repeat(512),
      '\n',
    ])
  })

  it('leaves no run over 512 in any part, and drops nothing, on prose mixed with both kinds', () => {
    const text = [
      PROSE,
      'x'.repeat(1_500),
      PROSE,
      '\n'.repeat(1_500),
      PROSE,
      ' '.repeat(1_500),
      PROSE,
    ].join('')
    const parts = encodedParts(text)

    expect(parts.length).toBeGreaterThan(1)
    expect(Math.max(...parts.map(longestRun))).toBeLessThanOrEqual(512)
    expect(parts.join('')).toBe(text)
  })

  // o200k's punctuation word runs on through newlines and slashes, so these texts are one regex
  // word of any length though their longest run of either kind is 2.
  it.each([
    ['slash then newline', '/\n'.repeat(2_000)],
    ['two slashes then newline', '//\n'.repeat(1_333)],
    ['slash then CRLF', '/\r\n'.repeat(1_333)],
  ])('cuts a run of slashes and newlines: %s', (_name, text) => {
    const parts = encodedParts(text)

    expect(parts.length).toBeGreaterThan(1)
    expect(Math.max(...parts.map((part) => [...part].length))).toBeLessThanOrEqual(512)
    expect(parts.join('')).toBe(text)
  })

  it('sends a slash-and-newline run of 512 whole and cuts one of 513', () => {
    const half = '/\n'.repeat(256)
    expect(encodedParts(half)).toEqual([half])
    expect(encodedParts(`${half}/`)).toEqual([half, '/'])
  })

  it('sends prose once, whole', () => {
    const prose = PROSE.repeat(70)
    expect(encodedParts(prose)).toEqual([prose])
  })

  it('reads a run in code points', () => {
    const atTheCut = '😀'.repeat(512)
    expect(encodedParts(atTheCut)).toEqual([atTheCut])
  })

  // No spaces around the newlines: with them the whitespace run would be 514 long and rightly cut.
  it.each([
    ['non-whitespace', `intro ${'x'.repeat(512)} outro`],
    ['emoji', `intro ${'😀'.repeat(512)} outro`],
    ['whitespace', `intro${'\n'.repeat(512)}outro`],
  ])('sends text around a 512-long %s run once, whole', (_name, text) => {
    expect(encodedParts(text)).toEqual([text])
  })

  // The offset matters: 512 is even, so a cut by UTF-16 unit lands between the pairs of a run
  // of nothing but emoji, and only a preceding single unit puts it inside one.
  it.each([
    ['starting on a pair', '😀'.repeat(600), [512, 88]],
    ['starting one unit in', `x${'😀'.repeat(600)}`, [512, 89]],
  ])('never cuts inside a surrogate pair of a run %s', (_name, run, pieces) => {
    const parts = encodedParts(run)

    expect(parts.every((part) => part.isWellFormed())).toBe(true)
    expect(parts.map((part) => [...part].length)).toEqual(pieces)
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
