import { beforeEach, describe, expect, it, vi } from 'vitest'

import { branches, stories, storyEntries, type StoryEntry } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'

import { buildScanText, readScanEntries } from './scan-surface'

const warnSpy = vi.hoisted(() => vi.fn())
vi.mock('@/lib/diagnostics', () => ({ logger: { warn: warnSpy } }))

beforeEach(() => warnSpy.mockClear())

type E = {
  id: string
  position: number
  kind: StoryEntry['kind']
  content: string
}

const entry = (n: number, kind: StoryEntry['kind'] = 'ai_reply', content = `entry ${n}`): E => ({
  id: `e${n}`,
  position: n,
  kind,
  content,
})

const ids = (entries: readonly { id: string }[]): string[] => entries.map((e) => e.id)

async function seed(rows: E[], branchId = 'br_1') {
  const { db } = await createTestDb()
  await db.insert(stories).values({ id: 'story_1', title: 'T', createdAt: 1, updatedAt: 1 })
  await db.insert(branches).values([
    { id: 'br_1', storyId: 'story_1', name: 'main', createdAt: 1 },
    { id: 'br_2', storyId: 'story_1', name: 'alt', createdAt: 1 },
  ])
  await db.insert(storyEntries).values(
    rows.map((r) => ({
      ...r,
      branchId,
      chapterId: null,
      metadata: null,
      createdAt: 1000 - r.position,
    })),
  )
  return db
}

const row = (content: string, kind: StoryEntry['kind'] = 'ai_reply') =>
  ({ kind, content }) as StoryEntry

describe('buildScanText', () => {
  it('joins the user action with the trailing prose', () => {
    const text = buildScanText({
      userAction: 'I draw the blade',
      trailing: [row('The Veilstone hummed.')],
    })
    expect(text).toBe('I draw the blade\nThe Veilstone hummed.')
  })

  it('keeps the trailing entries in the order given', () => {
    const text = buildScanText({
      userAction: 'I wait',
      trailing: [row('older'), row('newer')],
    })
    expect(text).toBe('I wait\nolder\nnewer')
  })

  it('is the user action alone when nothing trails it', () => {
    expect(buildScanText({ userAction: 'I wait', trailing: [] })).toBe('I wait')
  })

  // An empty haystack matches nothing, which is the honest answer for a turn
  // with no prose — not a surface that reads present and scores zero.
  it('is empty when there is no action and no trailing prose', () => {
    expect(buildScanText({ userAction: '   ', trailing: [row('')] })).toBe('')
  })

  // promptProse, not raw content: a keyword has to match what the model read,
  // and a tagged trailing block is not part of that.
  it('strips the piggyback block from a narrative entry', () => {
    const text = buildScanText({
      userAction: '',
      trailing: [row('The Veilstone hummed.\n<state>\n<summary>Kara found it</summary>\n</state>')],
    })
    expect(text).toBe('The Veilstone hummed.')
  })
})

describe('readScanEntries', () => {
  it('returns the entry standing before this turn’s action', async () => {
    const db = await seed([entry(1), entry(2, 'user_action'), entry(3), entry(4, 'user_action')])
    expect(ids(await readScanEntries(db, 'br_1', 1))).toEqual(['e3'])
  })

  it('returns the last take entries oldest-first', async () => {
    const db = await seed([entry(1), entry(2), entry(3), entry(4, 'user_action')])
    expect(ids(await readScanEntries(db, 'br_1', 3))).toEqual(['e1', 'e2', 'e3'])
  })

  it('takes the tail as-is when it is not a user action', async () => {
    // Regenerate and the opening turn both leave a narrative row at the tail.
    const db = await seed([entry(1), entry(2), entry(3)])
    expect(ids(await readScanEntries(db, 'br_1', 2))).toEqual(['e2', 'e3'])
  })

  it('returns what exists when the branch is shorter than take', async () => {
    const db = await seed([entry(1), entry(2, 'user_action')])
    expect(ids(await readScanEntries(db, 'br_1', 5))).toEqual(['e1'])
  })

  it('returns nothing on a branch holding only this turn’s action', async () => {
    const db = await seed([entry(1, 'user_action')])
    expect(await readScanEntries(db, 'br_1', 3)).toEqual([])
  })

  // A failure notice carries no narrative prose, and scanning it would let a
  // system message decide what lore gets seated.
  it('excludes system entries', async () => {
    const db = await seed([entry(1), entry(2, 'system'), entry(3, 'user_action')])
    expect(ids(await readScanEntries(db, 'br_1', 2))).toEqual(['e1'])
  })

  it('does not reach into another branch', async () => {
    const db = await seed([entry(1), entry(2, 'user_action')])
    await db.insert(storyEntries).values({
      id: 'other',
      branchId: 'br_2',
      position: 9,
      kind: 'ai_reply',
      chapterId: null,
      content: 'elsewhere',
      metadata: null,
      createdAt: 1,
    })
    expect(ids(await readScanEntries(db, 'br_1', 5))).toEqual(['e1'])
  })

  it('warns when two entries share a position', async () => {
    const db = await seed([entry(1), { ...entry(2), position: 1 }, entry(3, 'user_action')])
    await readScanEntries(db, 'br_1', 2)
    expect(warnSpy).toHaveBeenCalledWith(
      'retrieval.duplicate_entry_positions',
      expect.objectContaining({ branchId: 'br_1' }),
    )
  })
})
