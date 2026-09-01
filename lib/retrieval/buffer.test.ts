import { describe, expect, it } from 'vitest'

import { branches, stories, storyEntries, type StoryEntry } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'

import { promptBufferTake, readPromptBuffer } from './buffer'

type E = {
  id: string
  position: number
  kind: StoryEntry['kind']
  chapterId: string | null
  content: string
}

const entry = (
  n: number,
  chapterId: string | null = null,
  kind: StoryEntry['kind'] = 'ai_reply',
): E => ({
  id: `e${n}`,
  position: n,
  kind,
  chapterId,
  content: `entry ${n}`,
})

const range = (from: number, to: number, chapterId: string | null = null): E[] =>
  Array.from({ length: to - from + 1 }, (_, i) => entry(from + i, chapterId))

const ids = (entries: readonly { id: string }[]): string[] => entries.map((e) => e.id)

// 8 closed-chapter entries then 2 open ones.
const mixed = [...range(1, 8, 'ch_1'), ...range(9, 10)]

const PARTIAL = { fullChapterInBuffer: false, partialChapterBuffer: 10, protectedBuffer: 10 }

describe('promptBufferTake — partial mode', () => {
  it('takes partialChapterBuffer when the open region is long enough', () => {
    expect(promptBufferTake(50, PARTIAL)).toBe(10)
  })

  it('widens to protectedBuffer when the open region is short', () => {
    expect(promptBufferTake(2, PARTIAL)).toBe(10)
  })

  it('does not widen once the open region reaches protectedBuffer', () => {
    expect(promptBufferTake(10, PARTIAL)).toBe(10)
  })

  it('holds the protectedBuffer floor on a fully closed branch', () => {
    expect(promptBufferTake(0, PARTIAL)).toBe(10)
  })
})

describe('promptBufferTake — full mode', () => {
  const FULL = { fullChapterInBuffer: true, partialChapterBuffer: 10, protectedBuffer: 10 }

  it('takes the entire open region, ignoring partialChapterBuffer', () => {
    expect(promptBufferTake(50, FULL)).toBe(50)
  })

  it('still widens to protectedBuffer on a short open region', () => {
    expect(promptBufferTake(2, FULL)).toBe(10)
  })

  it('never widens once the open region exceeds protectedBuffer', () => {
    expect(promptBufferTake(12, FULL)).toBe(12)
  })
})

// cadence.md → Composition rule puts the total at max(protectedBuffer,
// min(openCount, partialChapterBuffer)) — the larger knob sizes the window, but
// only protectedBuffer reaches past the boundary: partialChapterBuffer is a
// window over the open region and clamps to it.
describe('promptBufferTake — partialChapterBuffer against protectedBuffer', () => {
  const take = (partialChapterBuffer: number, protectedBuffer: number, openCount: number) =>
    promptBufferTake(openCount, {
      fullChapterInBuffer: false,
      partialChapterBuffer,
      protectedBuffer,
    })

  it('widens the window to protectedBuffer when partial < protected', () => {
    expect(take(5, 10, 12)).toBe(10)
  })

  it('keeps the partialChapterBuffer window when partial > protected', () => {
    expect(take(8, 5, 12)).toBe(8)
  })

  it('takes that one window when partial === protected', () => {
    expect(take(6, 6, 12)).toBe(6)
  })

  it('clamps partial to the open region when it outruns it', () => {
    expect(take(20, 10, 12)).toBe(12)
  })

  it('still widens when partial < protected and the open region is exhausted', () => {
    expect(take(5, 10, 3)).toBe(10)
  })
})

// storySettingsSchema declares .int().nonnegative() on both counts, so these
// harden against settings that never went through it rather than pinning
// reachable values — the same hardening lib/prompts/filters.ts → recent pins.
describe('promptBufferTake — unvalidated settings', () => {
  const take = (partialChapterBuffer: number, protectedBuffer: number, openCount: number) =>
    promptBufferTake(openCount, {
      fullChapterInBuffer: false,
      partialChapterBuffer,
      protectedBuffer,
    })

  it.each([0, -5, Number.NaN, undefined])(
    'floors partialChapterBuffer at 1 for %s so it cannot send the whole open region',
    (partialChapterBuffer) => {
      expect(take(partialChapterBuffer as number, 0, 3)).toBe(1)
    },
  )

  it('truncates a fractional partialChapterBuffer', () => {
    expect(take(2.7, 0, 5)).toBe(2)
  })

  it.each([0, -5, Number.NaN, undefined])(
    'treats protectedBuffer %s as no floor rather than spilling the whole history',
    (protectedBuffer) => {
      expect(take(10, protectedBuffer as number, 2)).toBe(2)
    },
  )

  it('truncates a fractional protectedBuffer below 1 to no floor', () => {
    expect(take(10, 0.5, 0)).toBe(0)
  })

  it('truncates a fractional protectedBuffer above 1', () => {
    expect(take(1, 5.9, 2)).toBe(5)
  })
})

describe('readPromptBuffer', () => {
  const DEFAULTS = { fullChapterInBuffer: false, partialChapterBuffer: 10, protectedBuffer: 10 }

  async function seed(rows: E[], branchId = 'br_1') {
    const { db } = await createTestDb()
    await db.insert(stories).values({ id: 'story_1', title: 'T', createdAt: 1, updatedAt: 1 })
    await db.insert(branches).values([
      { id: 'br_1', storyId: 'story_1', name: 'main', createdAt: 1 },
      { id: 'br_2', storyId: 'story_1', name: 'alt', createdAt: 1 },
    ])
    await db
      .insert(storyEntries)
      .values(rows.map((r) => ({ ...r, branchId, metadata: null, createdAt: 1000 - r.position })))
    return db
  }

  it('takes the last window ascending by position', async () => {
    const db = await seed(range(1, 50))
    expect(ids(await readPromptBuffer(db, 'br_1', DEFAULTS))).toEqual(ids(range(41, 50)))
  })

  it('reaches past the reader window instead of stopping at fifty', async () => {
    const db = await seed(range(1, 120))
    const out = await readPromptBuffer(db, 'br_1', { ...DEFAULTS, fullChapterInBuffer: true })
    expect(out).toHaveLength(120)
    expect(out.at(0)?.id).toBe('e1')
  })

  it('excludes system entries from the window', async () => {
    const db = await seed([entry(1), entry(2, null, 'system'), entry(3)])
    const out = await readPromptBuffer(db, 'br_1', { ...DEFAULTS, protectedBuffer: 0 })
    expect(ids(out)).toEqual(['e1', 'e3'])
  })

  it('excludes system entries from the open count', async () => {
    // Closed rows below the open region absorb an inflated take: counting the
    // system row would widen the window to three and pull e5 in.
    const db = await seed([...range(1, 5, 'ch_1'), entry(6), entry(7, null, 'system'), entry(8)])
    const out = await readPromptBuffer(db, 'br_1', { ...DEFAULTS, protectedBuffer: 0 })
    expect(ids(out)).toEqual(['e6', 'e8'])
  })

  it('spills across more than one closed chapter when the previous is too short', async () => {
    const db = await seed([...range(1, 6, 'ch_1'), ...range(7, 10, 'ch_2'), ...range(11, 12)])
    const out = await readPromptBuffer(db, 'br_1', DEFAULTS)
    expect(ids(out)).toEqual(ids(range(3, 12)))
  })

  it('excludes system entries from the spillover too', async () => {
    const db = await seed([...range(1, 8, 'ch_1'), entry(9, 'ch_1', 'system'), entry(10)])
    const out = await readPromptBuffer(db, 'br_1', { ...DEFAULTS, protectedBuffer: 5 })
    expect(ids(out)).toEqual(['e5', 'e6', 'e7', 'e8', 'e10'])
  })

  it('spills across the chapter boundary to satisfy protectedBuffer', async () => {
    const db = await seed(mixed)
    expect(ids(await readPromptBuffer(db, 'br_1', DEFAULTS))).toEqual(ids(range(1, 10)))
  })

  it('returns an empty window when the knobs resolve to no entries', async () => {
    const db = await seed(range(1, 8, 'ch_1'))
    expect(await readPromptBuffer(db, 'br_1', { ...DEFAULTS, protectedBuffer: 0 })).toEqual([])
  })

  it('scopes the window to the branch', async () => {
    const db = await seed(range(1, 5))
    await db.insert(storyEntries).values(
      range(1, 5).map((r) => ({
        ...r,
        id: `other-${r.id}`,
        branchId: 'br_2',
        metadata: null,
        createdAt: 1000 - r.position,
      })),
    )
    const out = await readPromptBuffer(db, 'br_1', DEFAULTS)
    expect(out.every((e) => e.branchId === 'br_1')).toBe(true)
    expect(out).toHaveLength(5)
  })
})
