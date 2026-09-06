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

  it('skips a row the structural floor already seated', () => {
    const out = buildKeywordInjections(
      input({ entities: [entity()], floorIds: new Set(['e1']), scanText: 'Kael waits.' }),
    )

    expect(out.entities).toEqual([])
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
