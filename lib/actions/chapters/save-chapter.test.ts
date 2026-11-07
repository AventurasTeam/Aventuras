import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { chapterDraftFrom } from '@/lib/chapters'
import {
  branches,
  chapters,
  deltas,
  stories,
  type Chapter,
  type Delta,
  type NewChapter,
} from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { logger } from '@/lib/diagnostics'
import { generationStore, resetAllStores } from '@/lib/stores'

import { registerChapters } from './register'
import { saveChapter } from './save-chapter'
import { __resetRegistry } from '../delta/registry'

const KEEP: NewChapter = {
  id: 'chap_keep',
  branchId: 'br_1',
  sequenceNumber: 2,
  title: 'The Keep Leans Closer',
  summary: 'The courier reaches the keep at dusk.',
  theme: 'dread',
  keywords: ['Keep', 'Amulet'],
  startEntryId: 'se_10',
  endEntryId: 'se_20',
  tokenCount: 12_400,
  closedAt: 100,
  // Seeded and closed rows start stale; from 0 a save shows whether it flips the flag.
  embeddingStale: 0,
  createdAt: 1,
  updatedAt: 1,
}

async function setup() {
  // Registration is process-global; reset so only chapters is live for this test.
  __resetRegistry()
  registerChapters()
  resetAllStores()
  const { db, runInTransaction } = await createTestDb()
  await db.insert(stories).values({ id: 'story_1', title: 'T', createdAt: 1, updatedAt: 1 })
  await db.insert(branches).values({ id: 'br_1', storyId: 'story_1', name: 'main', createdAt: 1 })
  await db.insert(chapters).values(KEEP)
  return { db, ctx: { db, runInTransaction } }
}

type Db = Awaited<ReturnType<typeof setup>>['db']

async function keepRow(db: Db): Promise<Chapter> {
  const [row] = (await db.select().from(chapters).where(eq(chapters.id, 'chap_keep'))) as Chapter[]
  if (row == null) throw new Error('chap_keep is gone')
  return row
}

async function deltaRows(db: Db): Promise<Delta[]> {
  return (await db.select().from(deltas).where(eq(deltas.branchId, 'br_1'))) as Delta[]
}

function blockGeneration(): void {
  generationStore.startRun({
    runId: 'run_block',
    kind: 'turn',
    gateBehavior: 'hard-gate',
    interruptible: null,
    beforeTurn: false,
    actionId: 'act_block',
    storyId: 'story_1',
    branchId: 'br_1',
    abortController: new AbortController(),
    currentPhase: 'commit',
    intermediates: {},
    terminal: Promise.resolve(),
    resolveTerminal: () => {},
  })
}

afterEach(() => {
  resetAllStores()
  vi.restoreAllMocks()
})

describe('saveChapter', () => {
  it('writes the changed columns as one user_edit update and reports the id', async () => {
    const { db, ctx } = await setup()
    const row = await keepRow(db)
    const result = await saveChapter(
      {
        branchId: 'br_1',
        row,
        draft: {
          ...chapterDraftFrom(row),
          title: ' The Keep Falls ',
          keywords: ['Keep', 'Amulet', ' Lantern '],
        },
      },
      ctx,
    )
    expect(result).toEqual({ status: 'ok', id: 'chap_keep' })
    expect(await keepRow(db)).toMatchObject({
      title: 'The Keep Falls',
      keywords: ['Keep', 'Amulet', 'Lantern'],
      summary: 'The courier reaches the keep at dusk.',
      theme: 'dread',
    })
    const rows = await deltaRows(db)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      op: 'update',
      targetTable: 'chapters',
      targetId: 'chap_keep',
      source: 'user_edit',
    })
    expect(rows[0].undoPayload).toEqual({
      title: 'The Keep Leans Closer',
      keywords: ['Keep', 'Amulet'],
    })
  })

  it('writes nothing for an unchanged draft and reports ok', async () => {
    const { db, ctx } = await setup()
    const row = await keepRow(db)
    expect(await saveChapter({ branchId: 'br_1', row, draft: chapterDraftFrom(row) }, ctx)).toEqual(
      { status: 'ok', id: 'chap_keep' },
    )
    expect(await deltaRows(db)).toHaveLength(0)
  })

  it('refuses while a run is in flight, logged, and writes nothing', async () => {
    const { db, ctx } = await setup()
    const row = await keepRow(db)
    blockGeneration()
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    const result = await saveChapter(
      { branchId: 'br_1', row, draft: { ...chapterDraftFrom(row), title: 'The Keep Falls' } },
      ctx,
    )
    expect(result).toEqual({
      status: 'rejected',
      reason: 'generation in flight',
      code: 'in-flight',
    })
    expect(warn).toHaveBeenCalledWith('action_layer.chapter_save_rejected', {
      branchId: 'br_1',
      id: 'chap_keep',
      code: 'in-flight',
    })
    expect(await deltaRows(db)).toHaveLength(0)
    expect((await keepRow(db)).title).toBe('The Keep Leans Closer')
  })

  it('reports a chapter that went before the Save as not-found', async () => {
    const { db, ctx } = await setup()
    const row = await keepRow(db)
    await db.delete(chapters).where(eq(chapters.id, 'chap_keep'))
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    const result = await saveChapter(
      { branchId: 'br_1', row, draft: { ...chapterDraftFrom(row), title: 'The Keep Falls' } },
      ctx,
    )
    expect(result).toMatchObject({ status: 'rejected', code: 'not-found' })
    expect(warn).toHaveBeenCalledWith('action_layer.chapter_save_rejected', {
      branchId: 'br_1',
      id: 'chap_keep',
      create: false,
      actions: ['updateChapter'],
      reason: 'update target chapters br_1:chap_keep not found',
      code: 'not-found',
    })
    expect(await deltaRows(db)).toHaveLength(0)
  })

  it('leaves embedding_stale on a title save and sets it on a summary save', async () => {
    const { db, ctx } = await setup()
    const row = await keepRow(db)
    expect(
      await saveChapter(
        { branchId: 'br_1', row, draft: { ...chapterDraftFrom(row), title: 'The Keep Falls' } },
        ctx,
      ),
    ).toMatchObject({ status: 'ok' })
    expect((await keepRow(db)).embeddingStale).toBe(0)

    const titled = await keepRow(db)
    expect(
      await saveChapter(
        {
          branchId: 'br_1',
          row: titled,
          draft: { ...chapterDraftFrom(titled), summary: 'The keep gives way.' },
        },
        ctx,
      ),
    ).toMatchObject({ status: 'ok' })
    expect((await keepRow(db)).embeddingStale).toBe(1)
  })
})
