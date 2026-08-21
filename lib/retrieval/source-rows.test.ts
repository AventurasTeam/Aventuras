import { describe, expect, it, vi } from 'vitest'

import {
  branches,
  chapters,
  entities,
  happenings,
  lore,
  stories,
  storyEntries,
  threads,
} from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'

import { queryAllOf } from './__tests__/query-all'
import {
  countStaleHappenings,
  loadChapterRanges,
  loadHappeningRows,
  loadSourceRows,
  staleCountsOf,
} from './source-rows'
import type { QueryAll } from './types'

// embeddingStale rides along because the column defaults to dirty: every fixture
// row states its value, and ent_1 overrides after the spread.
const TS = { createdAt: 1, updatedAt: 1, embeddingStale: 0 as const }

/**
 * Seeded against the committed migrations rather than a fixture, so a renamed
 * or reordered column in SOURCE_SQL fails here — a positional fixture cannot
 * catch a wrong column NAME, which is what let the chapter-ranges join ship
 * broken.
 */
async function setup(): Promise<QueryAll> {
  const { db, sqlite } = await createTestDb()
  await db.insert(stories).values({ id: 'story_1', title: 'T', ...TS })
  await db.insert(branches).values([
    { id: 'br_1', storyId: 'story_1', name: 'main', createdAt: 1 },
    { id: 'br_2', storyId: 'story_1', name: 'alt', createdAt: 1 },
  ])

  await db.insert(entities).values([
    {
      id: 'ent_1',
      branchId: 'br_1',
      kind: 'location',
      name: 'The Hollow',
      description: 'A sunken vale.',
      status: 'staged',
      injectionMode: 'always',
      ...TS,
      embeddingStale: 1,
    },
    {
      id: 'ent_other',
      branchId: 'br_2',
      kind: 'character',
      name: 'Offbranch',
      status: 'active',
      injectionMode: 'auto',
      ...TS,
    },
  ])

  await db.insert(lore).values([
    {
      id: 'lore_1',
      branchId: 'br_1',
      title: 'Veilstone',
      body: 'A stone that veils.',
      keywords: ['veilstone', 'amulet'],
      injectionMode: 'disabled',
      priority: 60,
      ...TS,
    },
    {
      id: 'lore_other',
      branchId: 'br_2',
      title: 'Offbranch',
      injectionMode: 'auto',
      ...TS,
    },
  ])

  await db.insert(happenings).values([
    {
      id: 'hap_1',
      branchId: 'br_1',
      title: 'The bell rang',
      description: 'It rang twice.',
      occurredAtEntryId: 'ent_a',
      commonKnowledge: 1,
      ...TS,
    },
    { id: 'hap_other', branchId: 'br_2', title: 'Offbranch', ...TS },
    // Same occurred_at_entry_id as hap_1 on another branch (the column is FK-less):
    // the entryId path's cross-branch negative control.
    {
      id: 'hap_other2',
      branchId: 'br_2',
      title: 'Offbranch same entry',
      occurredAtEntryId: 'ent_a',
      ...TS,
    },
  ])

  await db.insert(threads).values([
    {
      id: 'th_1',
      branchId: 'br_1',
      title: 'The Amulet',
      description: 'Who holds it?',
      status: 'resolved',
      injectionMode: 'auto',
      ...TS,
    },
    {
      id: 'th_other',
      branchId: 'br_2',
      title: 'Offbranch',
      status: 'pending',
      injectionMode: 'auto',
      ...TS,
    },
  ])

  await db.insert(storyEntries).values([
    {
      id: 'ent_a',
      branchId: 'br_1',
      position: 1,
      kind: 'opening',
      content: 'a',
      chapterId: 'chap_1',
      createdAt: 1,
    },
    {
      id: 'ent_b',
      branchId: 'br_1',
      position: 2,
      kind: 'ai_reply',
      content: 'b',
      chapterId: 'chap_1',
      createdAt: 1,
    },
    {
      id: 'ent_c',
      branchId: 'br_1',
      position: 3,
      kind: 'ai_reply',
      content: 'c',
      chapterId: null,
      createdAt: 1,
    },
    {
      id: 'ent_z',
      branchId: 'br_2',
      position: 1,
      kind: 'opening',
      content: 'z',
      chapterId: 'chap_other',
      createdAt: 1,
    },
  ])

  await db.insert(chapters).values([
    {
      id: 'chap_1',
      branchId: 'br_1',
      sequenceNumber: 1,
      title: 'Chapter One',
      summary: 'What happened.',
      theme: 'betrayal',
      keywords: ['siege'],
      startEntryId: 'ent_a',
      endEntryId: 'ent_b',
      tokenCount: 10,
      closedAt: 2,
      ...TS,
    },
    {
      id: 'chap_empty',
      branchId: 'br_1',
      sequenceNumber: 2,
      title: 'Chapter Two',
      summary: 'Nothing yet.',
      theme: 'hope',
      startEntryId: 'ent_c',
      endEntryId: 'ent_c',
      tokenCount: 4,
      closedAt: 3,
      ...TS,
    },
    {
      id: 'chap_other',
      branchId: 'br_2',
      sequenceNumber: 1,
      title: 'Offbranch',
      summary: 'x',
      theme: 'x',
      startEntryId: 'ent_z',
      endEntryId: 'ent_z',
      tokenCount: 1,
      closedAt: 4,
      ...TS,
    },
  ])

  return queryAllOf(sqlite)
}

describe('loadSourceRows against a real DB', () => {
  it('maps every selected column onto its own field, per type', async () => {
    const rows = await loadSourceRows(await setup(), 'br_1')

    expect(rows.entities).toEqual([
      {
        id: 'ent_1',
        kind: 'location',
        status: 'staged',
        injectionMode: 'always',
        name: 'The Hollow',
        description: 'A sunken vale.',
        embeddingStale: true,
      },
    ])
    expect(rows.lore).toEqual([
      {
        id: 'lore_1',
        title: 'Veilstone',
        body: 'A stone that veils.',
        injectionMode: 'disabled',
        priority: 60,
        keywords: ['veilstone', 'amulet'],
        embeddingStale: false,
      },
    ])
    expect(rows.threads).toEqual([
      {
        id: 'th_1',
        status: 'resolved',
        injectionMode: 'auto',
        title: 'The Amulet',
        description: 'Who holds it?',
        embeddingStale: false,
      },
    ])
    expect(rows.chapters).toEqual([
      {
        id: 'chap_1',
        title: 'Chapter One',
        summary: 'What happened.',
        theme: 'betrayal',
        keywords: ['siege'],
        embeddingStale: false,
      },
      {
        id: 'chap_empty',
        title: 'Chapter Two',
        summary: 'Nothing yet.',
        theme: 'hope',
        keywords: [],
        embeddingStale: false,
      },
    ])
  })

  it('scopes every type to the branch', async () => {
    const queryAll = await setup()
    const mine = await loadSourceRows(queryAll, 'br_1')
    const theirs = await loadSourceRows(queryAll, 'br_2')

    expect(mine.entities.map((r) => r.id)).toEqual(['ent_1'])
    expect(mine.lore.map((r) => r.id)).toEqual(['lore_1'])
    expect(mine.threads.map((r) => r.id)).toEqual(['th_1'])
    expect(mine.chapters.map((r) => r.id)).toEqual(['chap_1', 'chap_empty'])
    // Positive control: the excluded rows do exist, on the other branch.
    expect(theirs.entities.map((r) => r.id)).toEqual(['ent_other'])
    expect(theirs.lore.map((r) => r.id)).toEqual(['lore_other'])
    expect(theirs.threads.map((r) => r.id)).toEqual(['th_other'])
    expect(theirs.chapters.map((r) => r.id)).toEqual(['chap_other'])
  })

  it('counts the flagged rows the driver actually returns', async () => {
    const queryAll = await setup()
    expect(
      staleCountsOf(
        await loadSourceRows(queryAll, 'br_1'),
        await countStaleHappenings(queryAll, 'br_1'),
      ),
    ).toEqual({
      entities: 1,
      lore: 0,
      happenings: 0,
      threads: 0,
      chapters: 0,
    })
  })
})

describe('loadHappeningRows', () => {
  it('reads the column contract off the real schema', async () => {
    const rows = await loadHappeningRows(await setup(), 'br_1', { ids: ['hap_1'], entryIds: [] })

    expect(rows).toEqual([
      {
        id: 'hap_1',
        title: 'The bell rang',
        description: 'It rang twice.',
        commonKnowledge: true,
        occurredAtEntryId: 'ent_a',
        embeddingStale: false,
      },
    ])
  })

  it('scopes to the branch even when an id from another one is asked for', async () => {
    const queryAll = await setup()

    const rows = await loadHappeningRows(queryAll, 'br_1', {
      ids: ['hap_1', 'hap_other'],
      entryIds: [],
    })

    expect(rows.map((r) => r.id)).toEqual(['hap_1'])
  })

  it('unions ids with the chapter-range entry ids rather than intersecting them', async () => {
    const queryAll = await setup()

    // hap_1 matches only by entry id; asking for an id that matches nothing must
    // not suppress it.
    const rows = await loadHappeningRows(queryAll, 'br_1', {
      ids: ['hap_absent'],
      entryIds: ['ent_a'],
    })

    expect(rows.map((r) => r.id)).toEqual(['hap_1'])
  })

  it('matches by entry id alone when the id set is empty', async () => {
    const queryAll = await setup()

    const rows = await loadHappeningRows(queryAll, 'br_1', { ids: [], entryIds: ['ent_a'] })

    // Positive control: hap_other2 shares this entry id, but on br_2 — must not leak in.
    expect(rows.map((r) => r.id)).toEqual(['hap_1'])
    expect(rows).toEqual([
      {
        id: 'hap_1',
        title: 'The bell rang',
        description: 'It rang twice.',
        commonKnowledge: true,
        occurredAtEntryId: 'ent_a',
        embeddingStale: false,
      },
    ])
  })

  it('returns a row matched by both the id set and the entry-id set exactly once', async () => {
    const queryAll = await setup()

    // hap_1 matches on id AND on entry id (its own occurredAtEntryId is 'ent_a') —
    // the overlap the id-set/entry-set split has to dedupe back down to one row.
    const rows = await loadHappeningRows(queryAll, 'br_1', {
      ids: ['hap_1'],
      entryIds: ['ent_a'],
    })

    expect(rows).toEqual([
      {
        id: 'hap_1',
        title: 'The bell rang',
        description: 'It rang twice.',
        commonKnowledge: true,
        occurredAtEntryId: 'ent_a',
        embeddingStale: false,
      },
    ])
  })

  it('dedupes an overlap by last write, not by dropping either side', async () => {
    // Synthetic content per query: real data can never disagree with itself, so a
    // same-content fixture couldn't tell a first-wins flip from a dropped dedupe.
    const idRow = ['hap_1', 'From id query', null, 0, 'ent_a', 0]
    const entryRow = ['hap_1', 'From entry query', null, 0, 'ent_a', 0]
    const queryAll = vi.fn(
      async (sql: string): Promise<unknown[][]> =>
        sql.includes('occurred_at_entry_id IN') ? [entryRow] : [idRow],
    )

    const rows = await loadHappeningRows(queryAll, 'br_1', { ids: ['hap_1'], entryIds: ['ent_a'] })

    expect(rows).toHaveLength(1)
    expect(rows[0]?.title).toBe('From entry query')
  })

  it('splits the chapter-range half across statements rather than one IN list', async () => {
    const entryIds = Array.from({ length: 8193 }, (_, i) => `ent_${i}`)
    const paramCounts: number[] = []
    let call = 0
    const queryAll = vi.fn(async (_sql: string, params: unknown[]): Promise<unknown[][]> => {
      paramCounts.push(params.length)
      call += 1
      return [[`hap_${call}`, 'T', null, 0, 'ent_0', 0]]
    })

    const rows = await loadHappeningRows(queryAll, 'br_1', { ids: [], entryIds })

    // 8192 entry ids + the branch param, then the 8193rd on its own; one
    // statement for the lot would bind 8194 variables.
    expect(paramCounts).toEqual([8193, 2])
    // Every chunk's rows survive the flatten — dropping one silently loses every
    // happening in that slice of the chapter range.
    expect(rows.map((r) => r.id)).toEqual(['hap_1', 'hap_2'])
  })

  // `id IN ()` is a SQLite syntax error, so an empty scope must not build one.
  it('issues no query at all for an empty scope', async () => {
    const queryAll = vi.fn(async (): Promise<unknown[][]> => [])

    expect(await loadHappeningRows(queryAll, 'br_1', { ids: [], entryIds: [] })).toEqual([])
    expect(queryAll).not.toHaveBeenCalled()
  })
})

describe('loadChapterRanges against a real DB', () => {
  it('keys the map by chapter id, not by entry id', async () => {
    const ranges = await loadChapterRanges(await setup(), 'br_1')

    expect([...ranges.keys()]).toEqual(['chap_1'])
    expect(ranges.get('chap_1')).toEqual(new Set(['ent_a', 'ent_b']))
    // Positive control: the entry ids ARE in the range, just not as keys —
    // an unaliased join collapses the duplicate `id` column and keys by these.
    expect(ranges.has('ent_a')).toBe(false)
    expect(ranges.has('ent_b')).toBe(false)
  })

  it('omits a chapter no entry points at, and every other branch', async () => {
    const queryAll = await setup()
    expect((await loadChapterRanges(queryAll, 'br_1')).has('chap_empty')).toBe(false)
    expect((await loadChapterRanges(queryAll, 'br_1')).has('chap_other')).toBe(false)
    // Positive control: chap_other is a real chapter with a real entry on br_2.
    expect(await loadChapterRanges(queryAll, 'br_2')).toEqual(
      new Map([['chap_other', new Set(['ent_z'])]]),
    )
  })
})
