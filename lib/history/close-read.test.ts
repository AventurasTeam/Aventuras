import type { DatabaseSync } from 'node:sqlite'

import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/sqlite-proxy'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ZodError } from 'zod'

import { redoLastAction, saveChapter, startManualClose, undoLastAction } from '@/lib/actions'
import type { generateStructured } from '@/lib/ai'
import { chapterDraftFrom } from '@/lib/chapters'
import {
  branches,
  chapters,
  deltas,
  stories,
  type Chapter,
  type CloseReport,
  type DbCtx,
  type NewChapter,
  type NewDelta,
} from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { dbSchema } from '@/lib/db/schema'
import { expectRan, resetSingletons } from '@/lib/pipeline/__tests__/harness'
import {
  metadataReplyResult,
  openCloseFixture,
  type CloseFixture,
} from '@/lib/pipeline/definitions/__tests__/close-fixture'
import { __setCloseAgentSlots, NO_CLOSE_TASKS } from '@/lib/pipeline/definitions/close-agent/slots'

import {
  loadCloseDeltas,
  readCloseReport,
  readDeletedEntityKinds,
  readLatestCloseReport,
} from './close-read'

const { generateStructuredMock } = vi.hoisted(() => ({
  generateStructuredMock: vi.fn<typeof generateStructured>(),
}))

vi.mock('@/lib/ai', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  generateStructured: generateStructuredMock,
}))

beforeEach(() => {
  resetSingletons()
  __setCloseAgentSlots(NO_CLOSE_TASKS)
  generateStructuredMock.mockReset()
  generateStructuredMock.mockResolvedValue(metadataReplyResult())
})

afterEach(() => {
  __setCloseAgentSlots(undefined)
  resetSingletons()
  vi.restoreAllMocks()
})

// The third of six replies: turns lie on both sides of the close.
const END_REPLY = 2

async function closed(): Promise<{ fx: CloseFixture; actionId: string; chapter: Chapter }> {
  const fx = await openCloseFixture()
  const tx = expectRan(await startManualClose(fx.branchId, fx.replyIds[END_REPLY], fx.ctx))
  expect(tx.outcome).toBe('completed')
  const [chapter] = (await fx.ctx.db
    .select()
    .from(chapters)
    .where(eq(chapters.branchId, fx.branchId))) as Chapter[]
  return { fx, actionId: tx.actionId, chapter: chapter! }
}

describe('readCloseReport and loadCloseDeltas over a real close', () => {
  it('reads the report a close wrote, and its deltas less the stamps', async () => {
    const { fx, actionId, chapter } = await closed()

    expect(await readCloseReport(fx.ctx.db, fx.branchId, chapter.id)).toEqual({
      version: 1,
      actionId,
      calls: [],
      stopped: [],
      noToolCalls: true,
    })
    const read = await loadCloseDeltas(fx.ctx.db, fx.branchId, chapter.id, actionId)
    expect(read.map((d) => [d.targetTable, d.targetId, d.op])).toEqual([
      ['chapters', chapter.id, 'create'],
      ['chapters', chapter.id, 'update'],
    ])
    expect(read.every((d) => d.actionId === actionId)).toBe(true)
    expect(read[1]!.undoPayload).toEqual({ closeReport: null })
    const logged = await fx.ctx.db.select().from(deltas).where(eq(deltas.actionId, actionId))
    expect(logged.filter((d) => d.targetTable === 'story_entries').length).toBeGreaterThan(0)
  })

  it('leaves out a later title save on the chapter', async () => {
    const { fx, actionId, chapter } = await closed()
    const before = await loadCloseDeltas(fx.ctx.db, fx.branchId, chapter.id, actionId)

    const saved = await saveChapter(
      { row: chapter, draft: { ...chapterDraftFrom(chapter), title: 'The Ferry at Night' } },
      fx.ctx,
    )

    expect(saved).toEqual({ status: 'ok', id: chapter.id })
    const titleSaves = await fx.ctx.db.select().from(deltas).where(eq(deltas.targetId, chapter.id))
    expect(titleSaves.filter((d) => d.actionId !== actionId)).toHaveLength(1)
    expect(await loadCloseDeltas(fx.ctx.db, fx.branchId, chapter.id, actionId)).toEqual(before)
  })

  it('reads the same rows after CTRL-Z and redo, and nothing between them', async () => {
    const { fx, actionId, chapter } = await closed()
    const report = await readCloseReport(fx.ctx.db, fx.branchId, chapter.id)
    const before = await loadCloseDeltas(fx.ctx.db, fx.branchId, chapter.id, actionId)

    expect(await undoLastAction(fx.branchId, fx.ctx)).toEqual({ status: 'ok' })
    expect(await readCloseReport(fx.ctx.db, fx.branchId, chapter.id)).toBeNull()
    expect(await loadCloseDeltas(fx.ctx.db, fx.branchId, chapter.id, actionId)).toEqual([])

    expect(await redoLastAction(fx.branchId, fx.ctx)).toEqual({ status: 'ok' })
    expect(await readCloseReport(fx.ctx.db, fx.branchId, chapter.id)).toEqual(report)
    expect(await loadCloseDeltas(fx.ctx.db, fx.branchId, chapter.id, actionId)).toEqual(before)
  })
})

const BRANCH = 'br_read'
const OTHER_BRANCH = 'br_other'

function chapterRow(
  id: string,
  sequenceNumber: number,
  closeReport: CloseReport | null,
): NewChapter {
  return {
    id,
    branchId: BRANCH,
    sequenceNumber,
    title: `Chapter ${sequenceNumber}`,
    summary: 'S',
    theme: 'T',
    keywords: [],
    startEntryId: 'entry_start',
    endEntryId: 'entry_end',
    tokenCount: 10,
    closedAt: 1,
    createdAt: 1,
    updatedAt: 1,
    closeReport,
  }
}

function report(actionId: string): CloseReport {
  return { version: 1, actionId, calls: [], stopped: [], noToolCalls: true }
}

function delta(
  logPosition: number,
  fields: Pick<NewDelta, 'actionId' | 'targetTable' | 'targetId' | 'op'> &
    Partial<Pick<NewDelta, 'undoPayload' | 'branchId'>>,
): NewDelta {
  return {
    id: `delta_${fields.branchId ?? BRANCH}_${logPosition}`,
    branchId: BRANCH,
    entryId: 'entry_end',
    logPosition,
    source: 'chapter_close',
    undoPayload: null,
    createdAt: logPosition,
    ...fields,
  }
}

async function seededDb() {
  const test = await createTestDb()
  await test.db.insert(stories).values({ id: 'story_read', title: 'T', createdAt: 1, updatedAt: 1 })
  await test.db.insert(branches).values([
    { id: BRANCH, storyId: 'story_read', name: 'main', createdAt: 1 },
    { id: OTHER_BRANCH, storyId: 'story_read', name: 'fork', createdAt: 1 },
  ])
  return test
}

describe('loadCloseDeltas over a hand-written log', () => {
  it("drops another action's delta inside the range, and the stamps, keeping log order", async () => {
    const { db } = await seededDb()
    await db.insert(chapters).values(chapterRow('chap_1', 1, report('act_close')))
    await db.insert(deltas).values([
      delta(10, {
        actionId: 'act_close',
        targetTable: 'chapters',
        targetId: 'chap_1',
        op: 'create',
      }),
      delta(11, {
        actionId: 'act_close',
        targetTable: 'story_entries',
        targetId: 'entry_end',
        op: 'update',
        undoPayload: { chapterId: null },
      }),
      delta(12, {
        actionId: 'act_close',
        targetTable: 'entities',
        targetId: 'char_1',
        op: 'update',
        undoPayload: { description: 'Old' },
      }),
      delta(13, {
        actionId: 'act_user',
        targetTable: 'entities',
        targetId: 'char_1',
        op: 'update',
        undoPayload: { description: 'Older' },
      }),
      delta(14, {
        actionId: 'act_close',
        targetTable: 'chapters',
        targetId: 'chap_1',
        op: 'update',
        undoPayload: { closeReport: null },
      }),
      delta(15, {
        actionId: 'act_user',
        targetTable: 'chapters',
        targetId: 'chap_1',
        op: 'update',
        undoPayload: { title: 'Chapter 1' },
      }),
    ])

    const read = await loadCloseDeltas(db, BRANCH, 'chap_1', 'act_close')

    expect(read.map((d) => d.logPosition)).toEqual([10, 12, 14])
  })

  it('reads nothing for a chapter with no delta under the action', async () => {
    const { db } = await seededDb()
    await db.insert(chapters).values(chapterRow('chap_1', 1, null))

    expect(await loadCloseDeltas(db, BRANCH, 'chap_1', 'act_close')).toEqual([])
  })
})

describe('readCloseReport on a hand-written row', () => {
  it('reads null for a chapter no close wrote, or one absent', async () => {
    const { db } = await seededDb()
    await db
      .insert(chapters)
      .values([chapterRow('chap_1', 1, null), chapterRow('chap_2', 2, report('act_two'))])

    expect(await readCloseReport(db, BRANCH, 'chap_1')).toBeNull()
    expect(await readCloseReport(db, BRANCH, 'chap_gone')).toBeNull()
    expect(await readCloseReport(db, OTHER_BRANCH, 'chap_2')).toBeNull()
    expect(await readCloseReport(db, BRANCH, 'chap_2')).toEqual(report('act_two'))
  })

  it('throws on a report failing its schema', async () => {
    const { db } = await seededDb()
    const broken = { version: 2, actionId: 'act_close' } as unknown as CloseReport
    await db.insert(chapters).values(chapterRow('chap_1', 1, broken))

    await expect(readCloseReport(db, BRANCH, 'chap_1')).rejects.toBeInstanceOf(ZodError)
  })
})

describe('readLatestCloseReport', () => {
  it("reads the highest sequence number's chapter and its report", async () => {
    const { db } = await seededDb()
    await db
      .insert(chapters)
      .values([
        chapterRow('chap_2', 2, report('act_two')),
        chapterRow('chap_1', 1, report('act_one')),
      ])

    expect(await readLatestCloseReport(db, BRANCH)).toEqual({
      chapterId: 'chap_2',
      report: report('act_two'),
    })
  })

  it('reads a null report when the latest has none, though an earlier one does', async () => {
    const { db } = await seededDb()
    await db
      .insert(chapters)
      .values([chapterRow('chap_1', 1, report('act_one')), chapterRow('chap_2', 2, null)])

    expect(await readLatestCloseReport(db, BRANCH)).toEqual({ chapterId: 'chap_2', report: null })
  })

  it('reads null on a branch with no chapter', async () => {
    const { db } = await seededDb()
    await db.insert(chapters).values(chapterRow('chap_1', 1, report('act_one')))

    expect(await readLatestCloseReport(db, OTHER_BRANCH)).toBeNull()
  })
})

describe('readDeletedEntityKinds', () => {
  it("takes each id's latest delete, and leaves out an id with none or a kind that isn't one", async () => {
    const { db } = await seededDb()
    await db.insert(deltas).values([
      delta(1, {
        actionId: 'act_1',
        targetTable: 'entities',
        targetId: 'char_twice',
        op: 'delete',
        undoPayload: { id: 'char_twice', kind: 'character', name: 'Kael' },
      }),
      delta(2, {
        actionId: 'act_2',
        targetTable: 'entities',
        targetId: 'char_twice',
        op: 'create',
      }),
      delta(3, {
        actionId: 'act_3',
        targetTable: 'entities',
        targetId: 'char_twice',
        op: 'delete',
        undoPayload: { id: 'char_twice', kind: 'faction', name: 'Kael' },
      }),
      delta(4, {
        actionId: 'act_4',
        targetTable: 'entities',
        targetId: 'item_once',
        op: 'delete',
        undoPayload: { id: 'item_once', kind: 'item', name: 'Lamp' },
      }),
      delta(5, {
        actionId: 'act_5',
        targetTable: 'threads',
        targetId: 'char_live',
        op: 'delete',
        undoPayload: { id: 'char_live', kind: 'location' },
      }),
      delta(7, {
        actionId: 'act_7',
        targetTable: 'entities',
        targetId: 'odd_kind',
        op: 'delete',
        undoPayload: { id: 'odd_kind', kind: 'place' },
      }),
      delta(8, {
        actionId: 'act_8',
        targetTable: 'entities',
        targetId: 'no_kind',
        op: 'delete',
        undoPayload: null,
      }),
      delta(6, {
        branchId: OTHER_BRANCH,
        actionId: 'act_6',
        targetTable: 'entities',
        targetId: 'char_live',
        op: 'delete',
        undoPayload: { id: 'char_live', kind: 'location' },
      }),
    ])

    const kinds = await readDeletedEntityKinds(db, BRANCH, [
      'char_twice',
      'item_once',
      'char_live',
      'odd_kind',
      'no_kind',
    ])

    expect(Object.fromEntries(kinds)).toEqual({ char_twice: 'faction', item_once: 'item' })
    expect((await readDeletedEntityKinds(db, BRANCH, [])).size).toBe(0)
  })
})

// The SQL each read sends, captured on the way to node:sqlite, so EXPLAIN reads what runs.
function recordingDb(sqlite: DatabaseSync, sent: { sql: string; params: unknown[] }[]) {
  return drizzle(
    async (query, params, method) => {
      sent.push({ sql: query, params })
      const stmt = sqlite.prepare(query)
      if (method === 'run') {
        stmt.run(...(params as never[]))
        return { rows: [] }
      }
      const rows = (stmt.all(...(params as never[])) as Record<string, unknown>[]).map((row) =>
        Object.values(row),
      )
      return { rows: method === 'get' ? (rows[0] ?? []) : rows }
    },
    { schema: dbSchema },
  ) as unknown as DbCtx['db']
}

function planOf(sqlite: DatabaseSync, { sql, params }: { sql: string; params: unknown[] }): string {
  const rows = sqlite.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...(params as never[])) as {
    detail: string
  }[]
  return rows.map((row) => row.detail).join('\n')
}

describe("loadCloseDeltas's query plan", () => {
  it('bounds the range on deltas_chain_idx and reads it off deltas_log_position_uniq, unsorted', async () => {
    const { db, sqlite } = await seededDb()
    await db.insert(deltas).values([
      delta(10, {
        actionId: 'act_close',
        targetTable: 'chapters',
        targetId: 'chap_1',
        op: 'create',
      }),
      delta(11, {
        actionId: 'act_close',
        targetTable: 'chapters',
        targetId: 'chap_1',
        op: 'update',
      }),
    ])
    const sent: { sql: string; params: unknown[] }[] = []

    await loadCloseDeltas(recordingDb(sqlite, sent), BRANCH, 'chap_1', 'act_close')

    expect(sent).toHaveLength(2)
    const [range, rows] = sent.map((query) => planOf(sqlite, query))
    expect(range).toContain('USING INDEX deltas_chain_idx')
    expect(rows).toContain('USING INDEX deltas_log_position_uniq')
    expect(rows).not.toContain('USE TEMP B-TREE')
  })
})
