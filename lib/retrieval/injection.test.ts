import { describe, expect, it } from 'vitest'

import { RANKER_DEFAULTS } from './constants'
import { buildKeywordInjections, type KeywordInjectionInput } from './injection'
import type { EntityRow, LoreRow } from './pools'

const countTokens = (t: string): number => Math.ceil(t.length / 4)

const entity = (over: Partial<KeywordInjectionInput['entities'][number]> = {}) => ({
  id: 'e1',
  kind: 'character' as EntityRow['kind'],
  status: 'active' as EntityRow['status'],
  injectionMode: 'auto' as EntityRow['injectionMode'],
  name: 'Kael',
  description: 'A ferryman.',
  keywords: [] as string[],
  priority: 0,
  ...over,
})

const lore = (over: Partial<KeywordInjectionInput['lore'][number]> = {}) => ({
  id: 'l1',
  title: 'The Aetherium',
  body: 'A drowned engine.' as string | null,
  injectionMode: 'auto' as LoreRow['injectionMode'],
  keywords: ['aetherium'] as string[],
  priority: 0,
  ...over,
})

const input = (over: Partial<KeywordInjectionInput> = {}): KeywordInjectionInput => ({
  settings: { mode: 'inject', budgetShare: 0.5, cascade: false, cascadeMaxDepth: 2 },
  entities: [],
  lore: [],
  floorIds: new Set<string>(),
  recentProse: '',
  scanText: '',
  budgets: { entities: 1200, lore: 1800, happenings: 1500, threads: 400, chapters: 600 },
  params: RANKER_DEFAULTS,
  countTokens,
  ...over,
})

const ids = (rows: readonly { row: { id: string } }[]): string[] => rows.map((r) => r.row.id)

describe('buildKeywordInjections — mode', () => {
  it('returns nothing at all under boost', () => {
    const out = buildKeywordInjections(
      input({
        settings: { mode: 'boost', budgetShare: 0.5, cascade: false, cascadeMaxDepth: 2 },
        lore: [lore()],
        scanText: 'the aetherium hums',
      }),
    )

    expect(out.lore).toEqual([])
    expect(out.entities).toEqual([])
  })

  it('never populates the three types canon keeps on boost', () => {
    const out = buildKeywordInjections(input({ lore: [lore()], scanText: 'the aetherium hums' }))

    expect(out.happenings).toEqual([])
    expect(out.threads).toEqual([])
    expect(out.chapters).toEqual([])
  })
})

describe('buildKeywordInjections — the keyword surface', () => {
  it('matches an entity on its name', () => {
    const out = buildKeywordInjections(input({ entities: [entity()], scanText: 'Kael waits.' }))

    expect(ids(out.entities)).toEqual(['e1'])
    expect(out.entities[0].terms).toEqual(['kael'])
  })

  it('matches an entity on an epithet the name misses', () => {
    const out = buildKeywordInjections(
      input({
        entities: [entity({ keywords: ['the ferryman'] })],
        scanText: 'You pay the ferryman.',
      }),
    )

    expect(out.entities[0].terms).toEqual(['the ferryman'])
  })

  it('records a term once when a keyword repeats the name', () => {
    const out = buildKeywordInjections(
      input({ entities: [entity({ keywords: ['KAEL'] })], scanText: 'Kael waits.' }),
    )

    expect(out.entities[0].terms).toEqual(['kael'])
  })

  it('matches lore on its keywords, not its title', () => {
    const out = buildKeywordInjections(
      input({ lore: [lore({ keywords: ['blood-bound'] })], scanText: 'The Aetherium sings.' }),
    )

    expect(out.lore).toEqual([])
  })

  it('seats the row with the rendered text the ranker would have charged', () => {
    const out = buildKeywordInjections(
      input({ entities: [entity({ status: 'staged' })], scanText: 'Kael waits.' }),
    )

    expect(out.entities[0].row.renderedText).toBe('Kael (available to introduce): A ferryman.')
    expect(out.entities[0].tokensEstimated).toBe(
      countTokens('Kael (available to introduce): A ferryman.') +
        RANKER_DEFAULTS.typeOverhead.entities,
    )
  })
})

describe('buildKeywordInjections — precedence and pool exclusions', () => {
  it('leaves a disabled row alone however loudly it matches', () => {
    const out = buildKeywordInjections(
      input({
        entities: [entity({ injectionMode: 'disabled' })],
        lore: [lore({ injectionMode: 'disabled' })],
        scanText: 'Kael and the aetherium.',
      }),
    )

    expect(out.entities).toEqual([])
    expect(out.lore).toEqual([])
  })

  it('skips a row the structural floor already seated, on either type', () => {
    const out = buildKeywordInjections(
      input({
        entities: [entity()],
        lore: [lore()],
        floorIds: new Set(['e1', 'l1']),
        scanText: 'Kael waits where the aetherium hums.',
      }),
    )

    expect(out.entities).toEqual([])
    expect(out.lore).toEqual([])
  })

  it('honours Layer-A suppression over the keyword hit', () => {
    // The same prose is the suppression trigger and the fire condition;
    // edge-cases.md → Layer A says suppression wins.
    const out = buildKeywordInjections(
      input({
        entities: [entity({ status: 'staged' })],
        recentProse: 'A man called Kael stepped from the fog.',
        scanText: 'Kael waits.',
      }),
    )

    expect(out.entities).toEqual([])
  })

  it('never seats a retired row', () => {
    const out = buildKeywordInjections(
      input({ entities: [entity({ status: 'retired' })], scanText: 'Kael waits.' }),
    )

    expect(out.entities).toEqual([])
  })
})

describe('buildKeywordInjections — the budget cap', () => {
  const wide = (id: string, priority: number) =>
    lore({ id, title: id, body: 'x'.repeat(160), priority, keywords: [id] })

  // 160 + len(id) chars of text is 41 tokens plus 4 overhead. A 100-token lore
  // budget at budgetShare 0.5 caps the seats at 50, so exactly one fits.
  const capped = () =>
    input({
      lore: [wide('aa', 1), wide('bb', 5), wide('cc', 5)],
      budgets: { entities: 0, lore: 100, happenings: 0, threads: 0, chapters: 0 },
      scanText: 'aa bb cc',
    })

  it('orders overflow by priority, then alphabetically, then by id', () => {
    const out = buildKeywordInjections(capped())

    expect(ids(out.lore)).toEqual(['bb', 'cc', 'aa'])
  })

  it('seats up to budgetShare of the type budget and cuts the rest', () => {
    const out = buildKeywordInjections(capped())

    expect(out.lore.map((i) => i.seated)).toEqual([true, false, false])
  })

  it('records a cut row with its priority so the order is inspectable', () => {
    const out = buildKeywordInjections(capped())

    expect(out.lore[2]).toMatchObject({ seated: false, priority: 1 })
  })

  it('tries a smaller row rather than stopping at the first that does not fit', () => {
    const out = buildKeywordInjections(
      input({
        lore: [wide('aa', 9), lore({ id: 'bb', title: 'bb', body: null, keywords: ['bb'] })],
        budgets: { entities: 0, lore: 60, happenings: 0, threads: 0, chapters: 0 },
        scanText: 'aa bb',
      }),
    )

    expect(out.lore.filter((i) => i.seated).map((i) => i.row.id)).toEqual(['bb'])
  })

  // The cap is a `>` comparison, so a NaN budget makes it false for every row and
  // seats the whole match set unbounded — the opposite direction from every other
  // reader of a bad budget, which seats nothing.
  it.each([Number.NaN, Number.POSITIVE_INFINITY, -100])(
    'seats nothing when the type budget is %p',
    (loreBudget) => {
      const out = buildKeywordInjections(
        input({
          lore: [wide('aa', 0), wide('bb', 0)],
          budgets: { entities: 0, lore: loreBudget, happenings: 0, threads: 0, chapters: 0 },
          scanText: 'aa bb',
        }),
      )

      expect(out.lore.map((i) => i.seated)).toEqual([false, false])
    },
  )

  // Sorts are stable in V8, so without the id fallback these keep source order —
  // which is SQLite's, and unordered.
  it('breaks a full tie on the id, not on the source read order', () => {
    const out = buildKeywordInjections(
      input({
        lore: [
          lore({ id: 'z1', title: 'dup', keywords: ['alpha'], priority: 1 }),
          lore({ id: 'a2', title: 'DUP', keywords: ['alpha'], priority: 1 }),
        ],
        scanText: 'alpha',
      }),
    )

    expect(ids(out.lore)).toEqual(['a2', 'z1'])
  })

  it('seats nothing at budgetShare 0, leaving every match to the ranked path', () => {
    const out = buildKeywordInjections(
      input({
        settings: { mode: 'inject', budgetShare: 0, cascade: false, cascadeMaxDepth: 2 },
        lore: [lore()],
        scanText: 'the aetherium hums',
      }),
    )

    expect(out.lore.map((i) => i.seated)).toEqual([false])
  })
})

describe('buildKeywordInjections — cascade', () => {
  const cascading = (over: Partial<KeywordInjectionInput['settings']> = {}) => ({
    mode: 'inject' as const,
    budgetShare: 1,
    cascade: true,
    cascadeMaxDepth: 2,
    ...over,
  })

  const sized = (id: string, body: string, keywords: string[], priority = 0) =>
    lore({ id, title: id, body, keywords, priority })

  // 'a' names 'b' in its body; 'b' names 'c'. Only 'a' is in the scan text.
  const chain = () => [
    lore({ id: 'a', title: 'A', body: 'It speaks of the beacon.', keywords: ['anchor'] }),
    lore({ id: 'b', title: 'B', body: 'It speaks of the cistern.', keywords: ['beacon'] }),
    lore({ id: 'c', title: 'C', body: 'It speaks of nothing.', keywords: ['cistern'] }),
  ]

  it('stays at depth 1 while cascade is off', () => {
    const out = buildKeywordInjections(
      input({
        settings: { mode: 'inject', budgetShare: 1, cascade: false, cascadeMaxDepth: 2 },
        lore: chain(),
        scanText: 'The anchor holds.',
      }),
    )

    expect(ids(out.lore)).toEqual(['a'])
  })

  it("rescans a seated row's own text to cascadeMaxDepth and no further", () => {
    const out = buildKeywordInjections(
      input({ settings: cascading(), lore: chain(), scanText: 'The anchor holds.' }),
    )

    expect(ids(out.lore)).toEqual(['a', 'b'])
  })

  it('reaches the third link at depth 3', () => {
    const out = buildKeywordInjections(
      input({
        settings: cascading({ cascadeMaxDepth: 3 }),
        lore: chain(),
        scanText: 'The anchor holds.',
      }),
    )

    expect(ids(out.lore)).toEqual(['a', 'b', 'c'])
  })

  it('terminates on a pair whose keywords name each other', () => {
    const out = buildKeywordInjections(
      input({
        settings: cascading({ cascadeMaxDepth: 8 }),
        lore: [
          lore({ id: 'x', title: 'X', body: 'It speaks of the yoke.', keywords: ['ex'] }),
          lore({ id: 'y', title: 'Y', body: 'It speaks of the ex.', keywords: ['yoke'] }),
        ],
        scanText: 'The ex is here.',
      }),
    )

    expect(ids(out.lore)).toEqual(['x', 'y'])
  })

  it('spends the allowance on depth-1 rows before any depth-2 row', () => {
    // 'deep' carries the higher priority and still loses: it is only reachable at
    // depth 2, by which point depth 1 has spent the allowance. sized('one') costs
    // 45 and sized('deep') 43 against a cap of 100 * 0.5.
    const out = buildKeywordInjections(
      input({
        settings: cascading({ budgetShare: 0.5 }),
        lore: [
          sized('one', `${'x'.repeat(150)} the deep`, ['one']),
          sized('deep', 'y'.repeat(150), ['the deep'], 9),
        ],
        budgets: { entities: 0, lore: 100, happenings: 0, threads: 0, chapters: 0 },
        scanText: 'one',
      }),
    )

    expect(out.lore.filter((i) => i.seated).map((i) => i.row.id)).toEqual(['one'])
    expect(out.lore.find((i) => i.row.id === 'deep')?.seated).toBe(false)
  })

  it('does not rescan a row the cap cut — it is not in the prompt', () => {
    // 'two' matches at depth 1 and the cap cuts it. Its body names 'the ghost';
    // a frontier built from matched rather than seated rows would reach it.
    // Costs: one 43, two 11, cap 50 — so 'one' seats and 'two' overflows.
    const out = buildKeywordInjections(
      input({
        settings: cascading({ budgetShare: 0.5 }),
        lore: [
          sized('one', 'x'.repeat(150), ['one'], 5),
          sized('two', 'It speaks of the ghost.', ['two'], 1),
          sized('ghost', 'Nothing more.', ['the ghost']),
        ],
        budgets: { entities: 0, lore: 100, happenings: 0, threads: 0, chapters: 0 },
        scanText: 'one two',
      }),
    )

    expect(ids(out.lore)).toEqual(['one', 'two'])
  })

  it('records a cut row once, even when a seated row names it again', () => {
    // 'two' is cut at depth 1, and the seated 'one' names it again at depth 2.
    // Only the visited set stops it being matched — and recorded — twice.
    const out = buildKeywordInjections(
      input({
        settings: cascading({ budgetShare: 0.5 }),
        lore: [
          sized('one', 'It speaks of the two.', ['one'], 5),
          sized('two', 'x'.repeat(200), ['the two'], 1),
        ],
        budgets: { entities: 0, lore: 100, happenings: 0, threads: 0, chapters: 0 },
        scanText: 'The one and the two.',
      }),
    )

    expect(ids(out.lore)).toEqual(['one', 'two'])
  })
})
