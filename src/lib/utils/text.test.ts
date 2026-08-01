import { describe, it, expect } from 'vitest'
import { entityNameMatches, findTextMatches, paragraphMatches, truncateAroundMatch } from './text'

describe('entityNameMatches — word boundaries', () => {
  it('matches a name that appears as a standalone word', () => {
    expect(entityNameMatches('Ren', 'ren walked into the room')).toBe(true)
  })

  it('does not match a name embedded inside a longer word', () => {
    // Regression guard for 4c2a7481: 'hulk' must not trigger on 'madhulkman'.
    expect(entityNameMatches('hulk', 'the madhulkman appeared')).toBe(false)
    expect(entityNameMatches('Ren', 'warren waved')).toBe(false)
  })

  it('matches regardless of case', () => {
    expect(entityNameMatches('ARIA', 'aria drew her blade')).toBe(true)
  })

  it('matches a name adjacent to punctuation', () => {
    expect(entityNameMatches('Aria', 'and then Aria, laughing, left.')).toBe(true)
    expect(entityNameMatches('Aria', '"Aria!" he shouted')).toBe(true)
  })

  it('matches multi-word names', () => {
    expect(entityNameMatches('the black tower', 'they reached the black tower at dusk')).toBe(true)
  })

  it('rejects names shorter than two characters', () => {
    expect(entityNameMatches('a', 'a quiet room')).toBe(false)
    expect(entityNameMatches('', 'anything')).toBe(false)
  })

  it('treats a regex-special name as a literal', () => {
    expect(entityNameMatches('c++', 'he learned c++ that year')).toBe(true)
    expect(entityNameMatches('a.c', 'abc')).toBe(false)
  })
})

describe('entityNameMatches — allowPrefix', () => {
  it('is off by default, so a prefix does not match', () => {
    expect(entityNameMatches('ren', 'the renaissance began')).toBe(false)
    expect(entityNameMatches('cat', 'a catastrophe unfolded')).toBe(false)
  })

  it('matches an inflected/compound mention when enabled', () => {
    expect(entityNameMatches('ren', 'the renaissance began', { allowPrefix: true })).toBe(true)
    expect(entityNameMatches('hulk', 'the hulking shape moved', { allowPrefix: true })).toBe(true)
  })

  it('still requires 3+ characters for the prefix fallback', () => {
    expect(entityNameMatches('re', 'the renaissance began', { allowPrefix: true })).toBe(false)
  })

  it('only matches at the start of a word, never mid-word', () => {
    expect(entityNameMatches('hulk', 'the madhulkman appeared', { allowPrefix: true })).toBe(false)
  })
})

describe('entityNameMatches — non-space-separated scripts', () => {
  it('falls back to substring matching for CJK', () => {
    expect(entityNameMatches('古い龍', '古い龍が目を覚ました')).toBe(true)
    expect(entityNameMatches('龍神', '古い龍が目を覚ました')).toBe(false)
  })

  it('pins the known limitation: a single-character name never matches', () => {
    // The `length < 2` guard predates the CJK branch and applies to it too, so a
    // one-kanji name (a complete word in Japanese/Chinese) is silently unmatchable.
    expect(entityNameMatches('龍', '古い龍が目を覚ました')).toBe(false)
  })

  it('ignores allowPrefix for those scripts (substring already covers it)', () => {
    expect(entityNameMatches('서울', '그는 서울역에 도착했다')).toBe(true)
  })
})

describe('findTextMatches', () => {
  it('ignores case by default', () => {
    expect(findTextMatches('She lost all hope.', 'HOPE')).toHaveLength(1)
  })

  it('separates a written token from the ordinary word when caseSensitive is on', () => {
    // The real case: a bookmark reading 'HOPE' buried under 69 uses of "hope".
    const text = 'She lost all hope.\n\nThe bookmark read HOPE.'
    expect(findTextMatches(text, 'HOPE', { caseSensitive: true })).toHaveLength(1)
    expect(findTextMatches(text, 'HOPE', { caseSensitive: true })[0].paragraphIndexes).toEqual([1])
  })

  it('still normalizes quotes and dashes when case-sensitive', () => {
    expect(
      findTextMatches('He said \u201cHOPE\u201d once.', '"HOPE"', { caseSensitive: true }),
    ).toHaveLength(1)
  })
  // Aria in paragraphs 1 and 5 — far enough apart that context windows don't touch.
  const content = [
    'Para zero.',
    'Para one mentions Aria.',
    'Para two.',
    'Para three.',
    'Para four.',
    'Para five has Aria.',
    'Para six.',
  ].join('\n\n')

  it('returns one window per matching paragraph, with its index', () => {
    const matches = findTextMatches(content, 'Aria')
    expect(matches.map((m) => m.paragraphIndexes)).toEqual([[1], [5]])
  })

  it('is case-insensitive', () => {
    expect(findTextMatches(content, 'aria')).toHaveLength(2)
  })

  it('always includes one paragraph either side of the match', () => {
    const [first] = findTextMatches(content, 'Aria')
    expect(first.excerpt).toBe('Para zero.\n\nPara one mentions Aria.\n\nPara two.')
    expect(first.startParagraph).toBe(0)
    expect(first.endParagraph).toBe(2)
  })

  it('merges overlapping windows instead of repeating shared paragraphs', () => {
    const near = ['A.', 'Aria here.', 'B.', 'Aria again.', 'C.'].join('\n\n')
    const matches = findTextMatches(near, 'Aria')

    expect(matches).toHaveLength(1)
    expect(matches[0].paragraphIndexes).toEqual([1, 3])
    expect(matches[0].excerpt).toBe(near)
  })

  it('does not merge windows that share no paragraph', () => {
    // Merging here would splice in the four paragraphs between them, which neither
    // window asked for.
    const far = ['Aria one.', 'a.', 'b.', 'c.', 'd.', 'Aria two.'].join('\n\n')
    const matches = findTextMatches(far, 'Aria')

    expect(matches.map((m) => m.paragraphIndexes)).toEqual([[0], [5]])
  })

  describe('growing to a word floor', () => {
    // Story paragraphs vary wildly, so a fixed window comes back either over the output
    // budget or too thin to judge a hit by. Words are the budget; paragraphs are the unit
    // it grows in, so an excerpt still starts and ends where the prose does.
    const short = ['one two.', 'three Aria four.', 'five six.', 'seven eight.', 'nine ten.'].join(
      '\n\n',
    )

    it('leaves the window alone when it already has enough', () => {
      const [m] = findTextMatches(short, 'Aria', { minWords: 3 })
      expect(m.paragraphIndexes).toEqual([1])
      expect(m.startParagraph).toBe(0)
      expect(m.endParagraph).toBe(2)
    })

    it('reaches further out until the floor is met', () => {
      const [m] = findTextMatches(short, 'Aria', { minWords: 11 })
      expect(m.endParagraph).toBeGreaterThan(2)
      expect(m.excerpt.split(/\s+/).length).toBeGreaterThanOrEqual(11)
    })

    it('stops at the boundaries of the entry rather than under-filling forever', () => {
      // The floor is a target, not a guarantee: a short entry simply has less to give,
      // and reaching into the next entry would quote text from another scene.
      const [m] = findTextMatches(short, 'Aria', { minWords: 500 })
      expect(m.excerpt).toBe(short)
    })

    it('keeps the match roughly centred while growing', () => {
      // Taking only from one side would push the hit to an edge and lose the run-up to it.
      const long = [...Array(9)]
        .map((_, i) => (i === 4 ? 'here Aria is' : `p${i} a b`))
        .join('\n\n')
      const [m] = findTextMatches(long, 'Aria', { minWords: 20 })

      expect(4 - m.startParagraph).toBeGreaterThan(0)
      expect(m.endParagraph - 4).toBeGreaterThan(0)
    })
  })

  it('matches across a line break inside a paragraph', () => {
    const wrapped = 'he drew the\nblack sword slowly'
    expect(findTextMatches(wrapped, 'the black sword', {})).toHaveLength(1)
  })

  it('normalizes typographic quotes, dashes and ellipses', () => {
    expect(findTextMatches('“Aria’s blade,” he said', "aria's blade", {})).toHaveLength(1)
    expect(findTextMatches('a half—turn', 'half-turn', {})).toHaveLength(1)
    expect(findTextMatches('wait…', 'wait...', {})).toHaveLength(1)
  })

  it('matches inside a word by default', () => {
    expect(findTextMatches('he counted the swords', 'sword', {})).toHaveLength(1)
  })

  it('requires word boundaries when wholeWord is set', () => {
    expect(findTextMatches('he counted the swords', 'sword', { wholeWord: true })).toEqual([])
    expect(findTextMatches('he drew the sword', 'sword', { wholeWord: true })).toHaveLength(1)
  })

  it('returns nothing for an empty query or empty content', () => {
    expect(findTextMatches(content, '   ')).toEqual([])
    expect(findTextMatches('', 'Aria')).toEqual([])
  })

  it('returns nothing when the query is absent', () => {
    expect(findTextMatches(content, 'Bramble')).toEqual([])
  })
})

describe('truncateAroundMatch', () => {
  /** `n` filler words, so budgets can be reasoned about exactly. */
  const pad = (n: number) => Array(n).fill('filler').join(' ')

  it('leaves text under the budget alone', () => {
    expect(truncateAroundMatch('a short line', 'short', 100)).toBe('a short line')
  })

  it('centres on the match rather than taking the head', () => {
    const result = truncateAroundMatch(`${pad(80)} Excalibur ${pad(80)}`, 'Excalibur', 20)

    expect(result).toContain('Excalibur')
    expect(result.startsWith('…')).toBe(true)
    expect(result.endsWith('…')).toBe(true)
    expect(result.replace(/…/g, '').split(/\s+/).filter(Boolean)).toHaveLength(20)
  })

  it('counts words, not characters, so cost does not vary with word length', () => {
    const shortWords = truncateAroundMatch(`${pad(40)} hit ${pad(40)}`, 'hit', 10)
    const longWords = truncateAroundMatch(
      `${Array(40).fill('extraordinarily').join(' ')} hit ${Array(40).fill('extraordinarily').join(' ')}`,
      'hit',
      10,
    )

    const words = (t: string) => t.replace(/…/g, '').split(/\s+/).filter(Boolean).length
    expect(words(shortWords)).toBe(words(longWords))
  })

  // findTextMatches matches on a normalized copy, so these are queries that really do occur
  // in the excerpt it produced. Searching for them literally would miss, and the fallback
  // would quietly hand back an opening with no match in it.
  it("finds a match whose typography differs from the query's", () => {
    expect(truncateAroundMatch(`${pad(40)} the king’s men ${pad(40)}`, "king's men", 10)).toContain(
      'king’s men',
    )
    expect(
      truncateAroundMatch(`${pad(40)} a well—known face ${pad(40)}`, 'well-known', 10),
    ).toContain('well—known')
    expect(truncateAroundMatch(`${pad(40)} wait… listen ${pad(40)}`, 'wait...', 10)).toContain(
      'wait…',
    )
  })

  it('finds a match that spans a line break', () => {
    expect(
      truncateAroundMatch(`${pad(40)} the silver\nsword ${pad(40)}`, 'silver sword', 10),
    ).toContain('silver\nsword')
  })

  it('respects caseSensitive', () => {
    const text = `${pad(30)} HOPE ${pad(60)} hope ${pad(30)}`

    expect(truncateAroundMatch(text, 'hope', 8, true)).toContain('hope')
    expect(truncateAroundMatch(text, 'hope', 8, true)).not.toContain('HOPE')
  })

  it('falls back to the head when the query really is absent', () => {
    const result = truncateAroundMatch(pad(50), 'Bramble', 10)

    expect(result).toBe(`${pad(10)}…`)
  })

  it('preserves the original spacing of what it keeps', () => {
    const result = truncateAroundMatch(`one two\nthree four ${pad(40)}`, 'two', 4)

    expect(result).toContain('two\nthree')
  })
})

describe('truncateAroundMatch — sentence boundaries', () => {
  const prose =
    'The corridor was long. Massive doors of petrified wood lined it. ' +
    'He traced the rune with charcoal, and it flared blue. ' +
    'Morvana said nothing for a while. The silence held.'

  it('opens at a sentence start, not mid-clause', () => {
    // Excerpts used to begin wherever the word budget landed, which on real prose meant
    // almost all of them opened mid-clause.
    const result = truncateAroundMatch(prose, 'rune', 12)

    expect(result.replace(/^…/, '')).toMatch(/^(He traced|Massive doors)/)
  })

  it('keeps the match near the front, since it is why the passage was returned', () => {
    const result = truncateAroundMatch(prose, 'rune', 14)
    const words = result.replace(/…/g, '').split(/\s+/).filter(Boolean)

    expect(words.indexOf('rune')).toBeLessThan(words.length / 2)
  })

  it('closes on a sentence when one ends just past the budget', () => {
    const result = truncateAroundMatch(prose, 'rune', 10)

    expect(result.replace(/…$/, '')).toMatch(/(blue\.|it\.)$/)
  })

  it('still keeps the match when the prose offers no boundary to open at', () => {
    // One enormous sentence: snapping to a boundary would open at character 0 and cut off
    // before the match, which is worse than an ugly excerpt.
    const wall = `${Array(80).fill('filler').join(' ')} Excalibur ${Array(80).fill('filler').join(' ')}`

    expect(truncateAroundMatch(wall, 'Excalibur', 20)).toContain('Excalibur')
  })

  it('does not reach back past a paragraph break for its run-up', () => {
    const twoParas = 'An unrelated scene entirely.\n\nHe drew the rune again.'
    const result = truncateAroundMatch(twoParas, 'rune', 6)

    expect(result).not.toContain('unrelated')
  })
})

describe('truncateAroundMatch — keeps adjacent hits together', () => {
  const pad = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ')

  it('covers every occurrence when the span fits the budget', () => {
    const text = `${pad(30)} rune here. Some filler between them. And another rune there. ${pad(30)}`
    const result = truncateAroundMatch(text, 'rune', 40)

    expect(result.match(/rune/g)).toHaveLength(2)
  })

  it('keeps two matching paragraphs together rather than cutting after the first', () => {
    const twoParas = `A rune was drawn on the door.\n\nThe rune held until dawn.\n\n${pad(60)}`
    const result = truncateAroundMatch(twoParas, 'rune', 30)

    expect(result).toContain('drawn on the door')
    expect(result).toContain('held until dawn')
  })

  it('falls back to the first occurrence when the span does not fit', () => {
    const text = `The first rune. ${pad(200)} The last rune.`
    const result = truncateAroundMatch(text, 'rune', 20)

    expect(result).toContain('first rune')
    expect(result).not.toContain('last rune')
  })

  it('still returns short text untouched', () => {
    expect(truncateAroundMatch('one rune and another rune', 'rune', 100)).toBe(
      'one rune and another rune',
    )
  })
})

describe('paragraphMatches', () => {
  it('matches a substring by default, prefixes and suffixes included', () => {
    expect(paragraphMatches('he studied the runes', 'rune')).toBe(true)
  })

  it('respects wholeWord', () => {
    expect(paragraphMatches('he studied the runes', 'rune', { wholeWord: true })).toBe(false)
    expect(paragraphMatches('he studied the rune', 'rune', { wholeWord: true })).toBe(true)
  })

  it('respects caseSensitive', () => {
    expect(paragraphMatches('The Rune', 'rune')).toBe(true)
    expect(paragraphMatches('The Rune', 'rune', { caseSensitive: true })).toBe(false)
  })

  it('is false for an empty query', () => {
    expect(paragraphMatches('anything', '   ')).toBe(false)
  })
})
