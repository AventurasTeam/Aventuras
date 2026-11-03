import { getTableColumns, getTableName } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { ID_PATTERN } from '@/lib/ids'
import { countTokens } from '@/lib/tokens'

import { buildLongBranchSteps, LONG_BRANCH_SCALES } from './long-branch'
import { SCALES } from '../../bench/fixture'
import { rowsPerInsert } from '../../lib/db/bind-limit'
import type { SeedStep } from '../../lib/db/devtools/seed-dataset'
import { entryMetadataSchema } from '../../lib/db/story-entries/entry-metadata'
import type { NewBranch, NewChapter, NewStory, NewStoryEntry } from '../../lib/db/types'

type EntryRow = NewStoryEntry & { contentTokens: number }

function rowsOf<T>(steps: readonly SeedStep[], table: string): T[] {
  return steps.filter((s) => getTableName(s.table) === table).flatMap((s) => s.rows as T[])
}

// Thousands of rows repeat a few dozen texts; tokenizing every row takes seconds on CI.
const tokenCounts = new Map<string, number>()
function tokensOf(content: string): number {
  let count = tokenCounts.get(content)
  if (count === undefined) {
    count = countTokens(content)
    tokenCounts.set(content, count)
  }
  return count
}

function tokensByChapter(rows: readonly EntryRow[]): Map<string | null, number> {
  const totals = new Map<string | null, number>()
  for (const row of rows) {
    const chapterId = row.chapterId ?? null
    totals.set(chapterId, (totals.get(chapterId) ?? 0) + tokensOf(row.content))
  }
  return totals
}

describe('LONG_BRANCH_SCALES', () => {
  it('matches the chapter counts bench/fixture.ts prices against', () => {
    expect([...LONG_BRANCH_SCALES]).toEqual([SCALES[0]!.chapters, SCALES[2]!.chapters])
  })
})

describe.each([
  { chapters: 20, branchId: 'br_long_20', entries: 2655, lastStart: 2510, lastEnd: 2641 },
  { chapters: 60, branchId: 'br_long_60', entries: 7935, lastStart: 7790, lastEnd: 7921 },
])('buildLongBranchSteps($chapters)', ({ chapters, branchId, entries, lastStart, lastEnd }) => {
  const steps = buildLongBranchSteps(chapters)
  const rows = rowsOf<EntryRow>(steps, 'story_entries')
  const closed = rowsOf<NewChapter>(steps, 'chapters')
  const [story] = rowsOf<NewStory>(steps, 'stories')
  const [branch] = rowsOf<NewBranch>(steps, 'branches')
  const byId = new Map(rows.map((r) => [r.id, r]))
  const totals = tokensByChapter(rows)
  const positionOf = (id: string) => byId.get(id)!.position

  it('counts one story, one branch, its entries and its chapters', () => {
    expect(rowsOf(steps, 'stories')).toHaveLength(1)
    expect(rowsOf(steps, 'branches')).toHaveLength(1)
    expect(rows).toHaveLength(entries)
    expect(closed).toHaveLength(chapters)
  })

  it('writes only these four tables, so nothing rolls back', () => {
    expect(new Set(steps.map((s) => getTableName(s.table)))).toEqual(
      new Set(['stories', 'branches', 'story_entries', 'chapters']),
    )
  })

  it('dates the story on a real calendar, so the decoration walk runs', () => {
    expect(story!.title).toBe(`Long branch, ${chapters} chapters`)
    expect(story!.definition?.calendarSystemId).toBe('earth-gregorian')
    expect(story!.definition?.worldTimeOrigin).toEqual({
      year: 1247,
      month: 1,
      day: 1,
      hour: 0,
      minute: 0,
      second: 0,
    })
  })

  it('inserts parents before children', () => {
    const tables = steps.map((s) => getTableName(s.table))
    expect(tables[0]).toBe('stories')
    expect(tables[1]).toBe('branches')
    expect(tables.at(-1)).toBe('chapters')
  })

  it('names the branch as the story current one, so openStory finds it', () => {
    expect(story!.status).toBe('active')
    expect(story!.currentBranchId).toBe(branchId)
    expect(branch!.id).toBe(branchId)
    expect(branch!.storyId).toBe(story!.id)
  })

  it('runs retrieval on the local embedder, which is why the device needs the model', () => {
    expect(story!.settings?.embeddingBackend).toBe('local')
  })

  it('parks the classifier at the tail', () => {
    expect(branch!.classifierStatus).toEqual({
      state: 'idle',
      lastSuccessAt: null,
      lastError: null,
      processedThrough: entries,
    })
  })

  it('keeps every step inside one INSERT under the bind cap', () => {
    for (const step of steps) {
      const columns = Object.keys(getTableColumns(step.table)).length
      expect(step.rows.length).toBeLessThanOrEqual(rowsPerInsert(columns))
    }
  })

  it('walks opening, then action, reply, action', () => {
    expect(rows.map((r) => r.position)).toEqual(Array.from({ length: entries }, (_, i) => i + 1))
    expect(rows.slice(0, 4).map((r) => r.kind)).toEqual([
      'opening',
      'user_action',
      'ai_reply',
      'user_action',
    ])
  })

  it('starts and ends each chapter where the close rule puts it', () => {
    expect([positionOf(closed[0]!.startEntryId), positionOf(closed[0]!.endEntryId)]).toEqual([
      1, 133,
    ])
    expect([positionOf(closed[1]!.startEntryId), positionOf(closed[1]!.endEntryId)]).toEqual([
      134, 265,
    ])
    const last = closed.at(-1)!
    expect([positionOf(last.startEntryId), positionOf(last.endEntryId)]).toEqual([
      lastStart,
      lastEnd,
    ])
  })

  it('ends every chapter on a reply', () => {
    for (const chapter of closed) expect(byId.get(chapter.endEntryId)!.kind).toBe('ai_reply')
  })

  it('leaves fourteen open entries, ending on a reply', () => {
    const open = rows.filter((r) => r.chapterId === null)
    expect(open).toHaveLength(14)
    expect(open[0]!.position).toBe(lastEnd + 1)
    expect(open.at(-1)!.kind).toBe('ai_reply')
  })

  it('stamps each closed entry with the chapter holding it', () => {
    for (const chapter of closed) {
      for (const position of [positionOf(chapter.startEntryId), positionOf(chapter.endEntryId)]) {
        expect(rows[position - 1]!.chapterId).toBe(chapter.id)
      }
    }
  })

  it('gives every chapter a substitutable prefix_<uuid> id', () => {
    for (const chapter of closed) expect(chapter.id).toMatch(ID_PATTERN)
    expect(new Set(closed.map((c) => c.id)).size).toBe(chapters)
  })

  it('sums each chapter tokenCount over its entries', () => {
    for (const chapter of closed) expect(chapter.tokenCount).toBe(totals.get(chapter.id))
  })

  it('numbers chapters from 1', () => {
    expect(closed.map((c) => c.sequenceNumber)).toEqual(
      Array.from({ length: chapters }, (_, i) => i + 1),
    )
  })

  // No vector row comes with them, and sync embeds only stale rows.
  it('marks every row of an embeddable table stale', () => {
    const embeddable = steps.filter((s) => 'embeddingStale' in getTableColumns(s.table))
    expect(embeddable.map((s) => getTableName(s.table))).toContain('chapters')
    for (const step of embeddable) {
      for (const row of step.rows as { embeddingStale?: number }[]) {
        expect(row.embeddingStale).toBe(1)
      }
    }
  })

  it('comes to about 24,000 tokens a chapter', () => {
    for (const chapter of closed) {
      expect(totals.get(chapter.id)).toBeGreaterThanOrEqual(21_600)
      expect(totals.get(chapter.id)).toBeLessThanOrEqual(26_400)
    }
  })

  it('carries each row its content tokens', () => {
    for (const row of rows) expect(row.contentTokens).toBe(tokensOf(row.content))
  })

  it('parses every row metadata', () => {
    for (const row of rows) expect(() => entryMetadataSchema.parse(row.metadata)).not.toThrow()
  })
})

describe('entry shape', () => {
  const rows = rowsOf<EntryRow>(buildLongBranchSteps(20), 'story_entries')
  const byPosition = (position: number) => rows[position - 1]!

  it('names entries by branch size and position', () => {
    expect(byPosition(1).id).toBe('entry_long_20_0001')
    expect(byPosition(2655).id).toBe('entry_long_20_2655')
  })

  it('rebuilds identically', () => {
    expect(rowsOf<EntryRow>(buildLongBranchSteps(20), 'story_entries')).toEqual(rows)
  })

  it('writes replies of three or four paragraphs at real length', () => {
    const replies = rows.filter((r) => r.kind === 'ai_reply')
    for (const reply of replies) {
      expect(reply.content.length).toBeGreaterThan(1_250)
      expect(reply.content.length).toBeLessThan(1_550)
      expect([3, 4]).toContain(reply.content.split('\n\n').length)
      expect(reply.content).toMatch(/\*[^*]+\*/)
    }
    expect(new Set(replies.map((r) => r.content.split('\n\n').length))).toEqual(new Set([3, 4]))
  })

  it('writes actions of about 120 characters, from the whole pool', () => {
    const actions = rows.filter((r) => r.kind === 'user_action')
    for (const action of actions) {
      expect(action.content.length).toBeGreaterThan(100)
      expect(action.content.length).toBeLessThan(140)
    }
    expect(new Set(actions.map((a) => a.content)).size).toBe(6)
  })

  it('gives a reply the metadata that loads the bridge', () => {
    const { metadata } = byPosition(3)
    expect(metadata?.model).toBe('seed/narrative')
    expect(metadata?.tokens).toBeDefined()
    expect(metadata?.reasoning?.length).toBeGreaterThan(850)
    expect(metadata?.reasoning?.length).toBeLessThan(1_150)
    expect(metadata?.summary?.length).toBeGreaterThan(150)
    expect(metadata?.summary?.length).toBeLessThan(270)
    expect(metadata?.retrievalQueries).toHaveLength(3)
  })

  it('leaves an action without reply metadata', () => {
    const { metadata } = byPosition(4)
    expect(metadata?.reasoning).toBeUndefined()
    expect(metadata?.summary).toBeUndefined()
    expect(metadata?.sceneEntities).toEqual([])
    expect(metadata?.currentLocationId).toBeNull()
  })

  it('shares a world time between a reply and the action after it', () => {
    const times = [1, 2, 3, 4, 5, 6].map((p) => byPosition(p).metadata?.worldTime)
    expect(times).toEqual([0, 0, 600, 600, 1200, 1200])
  })
})
