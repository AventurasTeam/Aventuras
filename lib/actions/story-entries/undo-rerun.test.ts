import { afterEach, describe, expect, it, vi } from 'vitest'

import type { generateStructured } from '@/lib/ai'
import {
  parseRerunJournal,
  reversalJournals,
  type Chapter,
  type Delta,
  type NewEntity,
  type StoryEntry,
} from '@/lib/db'
import { getDiagnosticsSnapshot } from '@/lib/diagnostics'
import { writeTurnEntry } from '@/lib/pipeline/definitions/__tests__/close-fixture'
import { entitiesStore, loreStore, resetAllStores, threadsStore, undoRedoStore } from '@/lib/stores'

import { redoLastAction, undoLastAction } from './undo'
import { readUndoImpact } from './undo-target'
import {
  CLOSE_LORE_ID,
  MERGED_DESCRIPTION,
  SEEDED_AT,
  THREAD_ABSORBED,
  THREAD_KEPT,
  TOBIN,
  TOBIN_CLOSE_DESCRIPTION,
  TOBIN_STATE,
  chapterRows,
  describeTobin,
  entityOf,
  entryRows,
  installChapterDeleteHooks,
  logRows,
  loreCreate,
  openClosed,
  worldRows,
  writeCloseWork,
  writeLater,
  writeUnderClose,
  type ClosedChapter,
  type WorldRows,
} from '../chapters/__tests__/chapter-delete-fixture'
import { __redoGroupForTest } from '../delta/redo'
import { reverseCloseForRerun } from '../delta/rerun-journal'
import { DeltaReplayError, describeDeltaReplayError } from '../delta/reverse-replay'
import { loadOpenStory } from '../stories/operational'

const { generateStructuredMock } = vi.hoisted(() => ({
  generateStructuredMock: vi.fn<typeof generateStructured>(),
}))

vi.mock('@/lib/ai', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  generateStructured: generateStructuredMock,
}))

installChapterDeleteHooks(generateStructuredMock)

afterEach(() => {
  undoRedoStore.clear()
})

const RERUN = 'act_rerun'
const RERUN_LORE_ID = 'lore_harrow_toll'
const RERUN_DESCRIPTION = 'The Harrow ferryman, who poles only for coin.'

type BeforeRerun = {
  /** The branch's log, newest first, just before the re-run. */
  log: Delta[]
  world: WorldRows
  chapters: Chapter[]
  entries: StoryEntry[]
}

// A re-run as the close pipeline runs one (chapter-close.md → Re-running a close): the journaled
// reversal, the tasks' writes again as one group on E, re-merging the same threads, then the report.
async function rerun(c: ClosedChapter): Promise<BeforeRerun> {
  const before: BeforeRerun = {
    log: await logRows(c.fx),
    world: await worldRows(c.fx),
    chapters: await chapterRows(c.fx),
    entries: await entryRows(c.fx),
  }
  const { branchId, ctx } = c.fx
  await reverseCloseForRerun({ branchId, chapterId: c.chapter.id, actionId: RERUN }, ctx)
  const asRerun: ClosedChapter = { ...c, actionId: RERUN }
  await writeUnderClose(asRerun, [
    loreCreate(branchId, RERUN_LORE_ID, 'The Harrow toll'),
    describeTobin(branchId, RERUN_DESCRIPTION, 'chapter_close'),
    {
      kind: 'updateThread',
      source: 'chapter_close',
      payload: {
        branchId,
        id: THREAD_KEPT.id,
        patch: { description: MERGED_DESCRIPTION },
        proseEntryId: c.endEntryId,
      },
    },
    {
      kind: 'deleteThread',
      source: 'chapter_close',
      payload: { branchId, id: THREAD_ABSORBED.id },
    },
  ])
  await writeUnderClose(asRerun, [
    {
      kind: 'updateChapter',
      source: 'chapter_close',
      payload: {
        branchId,
        id: c.chapter.id,
        patch: {
          closeReport: { version: 1, actionId: RERUN, calls: [], stopped: [], noToolCalls: true },
        },
      },
    },
  ])
  return before
}

const journalRows = (c: ClosedChapter) => c.fx.ctx.db.select().from(reversalJournals)

const undoneLogLevels = (): string[] =>
  getDiagnosticsSnapshot()
    .logEntries.filter((e) => e.kind === 'action_layer.rerun_close_undone')
    .map((e) => e.level)

const MIRA: Omit<NewEntity, 'branchId'> = {
  id: 'char_mira',
  kind: 'character',
  name: 'Mira',
  description: 'A drover at the Harrow inn.',
  status: 'active',
  injectionMode: 'auto',
  state: TOBIN_STATE,
  createdAt: SEEDED_AT,
  updatedAt: SEEDED_AT,
}

describe('CTRL-Z of a re-run', () => {
  it('restores the close it replaced, positions included, and empties the redo stack', async () => {
    const c = await openClosed()
    await writeCloseWork(c)
    const before = await rerun(c)
    expect((await worldRows(c.fx)).lore.map((row) => row.id)).toEqual([RERUN_LORE_ID])
    expect(await journalRows(c)).toHaveLength(1)
    undoRedoStore.pushRedoGroup(__redoGroupForTest())

    expect(await undoLastAction(c.fx.branchId, c.fx.ctx)).toStrictEqual({ status: 'ok' })

    expect(await logRows(c.fx)).toEqual(before.log)
    expect(await worldRows(c.fx)).toEqual(before.world)
    expect(await chapterRows(c.fx)).toEqual(before.chapters)
    expect(await entryRows(c.fx)).toEqual(before.entries)
    expect(await journalRows(c)).toEqual([])
    expect(undoRedoStore.hasRedo()).toBe(false)
    // The stores end as the DB does: the write-back's patches emit after the group's own.
    expect(loreStore.getById(CLOSE_LORE_ID)).toBeDefined()
    expect(loreStore.getById(RERUN_LORE_ID)).toBeUndefined()
    expect(threadsStore.getById(THREAD_ABSORBED.id)).toBeUndefined()
    expect(entitiesStore.getById(TOBIN.id)?.description).toBe(TOBIN_CLOSE_DESCRIPTION)
  })

  it('restores a close that changed nothing in the world, and leaves no journal', async () => {
    const c = await openClosed()
    const before = {
      log: await logRows(c.fx),
      world: await worldRows(c.fx),
      chapters: await chapterRows(c.fx),
    }
    const { branchId, ctx } = c.fx
    await reverseCloseForRerun({ branchId, chapterId: c.chapter.id, actionId: RERUN }, ctx)
    const [journal] = await journalRows(c)
    // Empty but for the chapter: an abort can tell "reversed nothing" from "never reversed".
    expect(parseRerunJournal(journal?.journal)).toMatchObject({
      chapterId: c.chapter.id,
      rows: [],
      deltas: [],
      journals: [],
    })
    await writeUnderClose({ ...c, actionId: RERUN }, [
      {
        kind: 'updateChapter',
        source: 'chapter_close',
        payload: {
          branchId,
          id: c.chapter.id,
          patch: {
            closeReport: { version: 1, actionId: RERUN, calls: [], stopped: [], noToolCalls: true },
          },
        },
      },
    ])
    undoRedoStore.pushRedoGroup(__redoGroupForTest())

    expect(await undoLastAction(branchId, ctx)).toStrictEqual({ status: 'ok' })

    expect(await logRows(c.fx)).toEqual(before.log)
    expect(await worldRows(c.fx)).toEqual(before.world)
    expect(await chapterRows(c.fx)).toEqual(before.chapters)
    expect(await journalRows(c)).toEqual([])
    expect(undoRedoStore.hasRedo()).toBe(false)
  })

  it('empties the redo stack when only the store sync after the commit throws', async () => {
    const c = await openClosed()
    await writeCloseWork(c)
    const before = await rerun(c)
    undoRedoStore.pushRedoGroup(__redoGroupForTest())
    vi.spyOn(loreStore, 'patch').mockImplementation(() => {
      throw new Error('store sync boom')
    })

    await expect(undoLastAction(c.fx.branchId, c.fx.ctx)).rejects.toBeInstanceOf(DeltaReplayError)

    expect(undoRedoStore.hasRedo()).toBe(false)
    expect(await logRows(c.fx)).toEqual(before.log)
    expect(await journalRows(c)).toEqual([])
  })

  // generation-pipeline.md → Reverse-replay: a later edit's snapshot can hold the re-run's values,
  // and redo writes an update's whole row back.
  it("leaves redo nothing to write over the restored close, a later edit's snapshot included", async () => {
    const c = await openClosed()
    await writeCloseWork(c)
    await rerun(c)
    await writeLater(
      c.fx,
      {
        kind: 'updateEntity',
        source: 'user_edit',
        payload: { branchId: c.fx.branchId, id: TOBIN.id, patch: { name: 'Old Tobin' } },
      },
      { actionId: 'act_rename', entryId: null },
    )

    expect(await undoLastAction(c.fx.branchId, c.fx.ctx)).toStrictEqual({ status: 'ok' })
    expect(undoRedoStore.hasRedo()).toBe(true)
    expect(await undoLastAction(c.fx.branchId, c.fx.ctx)).toStrictEqual({ status: 'ok' })

    expect(await redoLastAction(c.fx.branchId, c.fx.ctx)).toEqual({
      status: 'rejected',
      code: 'nothing-to-apply',
      reason: 'nothing to redo',
    })
    const tobin = await entityOf(c.fx, TOBIN.id)
    expect(tobin?.name).toBe('Tobin')
    expect(tobin?.description).toBe(TOBIN_CLOSE_DESCRIPTION)
  })

  it.each<[string, (c: ClosedChapter) => Promise<void>]>([
    [
      'a pass logged a delta above it',
      (c) =>
        writeLater(
          c.fx,
          {
            kind: 'createEntity',
            source: 'periodic_classifier',
            payload: { entry: { ...MIRA, branchId: c.fx.branchId } },
          },
          { actionId: 'act_pass_above', entryId: c.fx.replyIds[5]! },
        ),
    ],
    [
      'a sweep dropped its journal',
      async (c) => {
        await c.fx.ctx.db.delete(reversalJournals)
      },
    ],
  ])('undoes the close altogether when %s, naming the chapter', async (_label, spoil) => {
    const c = await openClosed()
    await writeCloseWork(c)
    expect(c.chapter.sequenceNumber).toBe(1)
    await rerun(c)
    await spoil(c)
    undoRedoStore.pushRedoGroup(__redoGroupForTest())

    expect(await undoLastAction(c.fx.branchId, c.fx.ctx)).toStrictEqual({
      status: 'ok',
      closeUndone: { chapterNumber: 1 },
    })

    expect(await chapterRows(c.fx)).toEqual([])
    expect((await entryRows(c.fx)).every((e) => e.chapterId === null)).toBe(true)
    const world = await worldRows(c.fx)
    expect({ ...world, entities: world.entities.filter((e) => e.id !== MIRA.id) }).toEqual(c.before)
    expect(await journalRows(c)).toEqual([])
    expect(
      (await logRows(c.fx)).filter((d) => d.actionId === c.actionId || d.actionId === RERUN),
    ).toEqual([])
    expect(undoRedoStore.hasRedo()).toBe(false)
    expect(undoneLogLevels()).toEqual(['warn'])
  })

  it('logs the close undone when only the store sync after the commit throws', async () => {
    const c = await openClosed()
    await writeCloseWork(c)
    await rerun(c)
    await c.fx.ctx.db.delete(reversalJournals)
    vi.spyOn(loreStore, 'patch').mockImplementation(() => {
      throw new Error('store sync boom')
    })

    await expect(undoLastAction(c.fx.branchId, c.fx.ctx)).rejects.toBeInstanceOf(DeltaReplayError)

    expect(await chapterRows(c.fx)).toEqual([])
    expect(undoneLogLevels()).toEqual(['warn'])
  })

  // reader-composer.md → The notice: the surface needs the outcome to warn instead of failing.
  it('carries the undone close and its chapter on the error when only the store sync throws', async () => {
    const c = await openClosed()
    await writeCloseWork(c)
    await rerun(c)
    await c.fx.ctx.db.delete(reversalJournals)
    vi.spyOn(loreStore, 'patch').mockImplementation(() => {
      throw new Error('store sync boom')
    })

    const error = await undoLastAction(c.fx.branchId, c.fx.ctx).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(DeltaReplayError)
    expect(describeDeltaReplayError(error)).toStrictEqual({
      detail: 'Error: store sync boom',
      committed: true,
      refusal: null,
      rerun: { journal: 'undone', chapterNumber: 1 },
    })
    expect(await chapterRows(c.fx)).toEqual([])
  })

  it('carries the restored journal on the error when only the store sync throws', async () => {
    const c = await openClosed()
    await writeCloseWork(c)
    await rerun(c)
    vi.spyOn(loreStore, 'patch').mockImplementation(() => {
      throw new Error('store sync boom')
    })

    const error = await undoLastAction(c.fx.branchId, c.fx.ctx).catch((e: unknown) => e)

    expect(describeDeltaReplayError(error)).toStrictEqual({
      detail: 'Error: store sync boom',
      committed: true,
      refusal: null,
      rerun: { journal: 'restored' },
    })
  })

  it('carries no outcome on an error from an undo that never commits', async () => {
    const c = await openClosed()
    await writeCloseWork(c)
    await rerun(c)
    await c.fx.ctx.db.delete(reversalJournals)
    const locked = {
      ...c.fx.ctx,
      runInTransaction: async () => {
        throw new Error('database is locked')
      },
    }

    const error = await undoLastAction(c.fx.branchId, locked).catch((e: unknown) => e)

    expect(describeDeltaReplayError(error)).toStrictEqual({
      detail: 'Error: database is locked',
      committed: false,
      refusal: null,
    })
  })

  it('logs no close undone when the undo never commits', async () => {
    const c = await openClosed()
    await writeCloseWork(c)
    await rerun(c)
    await c.fx.ctx.db.delete(reversalJournals)
    const locked = {
      ...c.fx.ctx,
      runInTransaction: async () => {
        throw new Error('database is locked')
      },
    }

    await expect(undoLastAction(c.fx.branchId, locked)).rejects.toBeInstanceOf(DeltaReplayError)

    expect(await chapterRows(c.fx)).toHaveLength(1)
    expect(undoneLogLevels()).toEqual([])
  })

  // Nothing the write-back needs lives in memory.
  it('restores from the database alone after a restart between the commit and the undo', async () => {
    const c = await openClosed()
    await writeCloseWork(c)
    const before = await rerun(c)
    resetAllStores()
    expect((await loadOpenStory(c.fx.branchId, c.fx.ctx)).status).toBe('ok')

    expect(await undoLastAction(c.fx.branchId, c.fx.ctx)).toStrictEqual({ status: 'ok' })

    expect(await logRows(c.fx)).toEqual(before.log)
    expect(await worldRows(c.fx)).toEqual(before.world)
    expect(await chapterRows(c.fx)).toEqual(before.chapters)
    expect(await journalRows(c)).toEqual([])
    expect(loreStore.getById(CLOSE_LORE_ID)).toBeDefined()
  })
})

// reader-composer.md → Undo and redo: the confirm reads whether the undo will take the close too,
// by the predicate the write-back itself runs.
describe("the CTRL-Z confirm's read of a re-run", () => {
  // A turn after the re-run, its entries through the action layer as a turn writes them.
  async function turnAfter(c: ClosedChapter): Promise<void> {
    const position = (await entryRows(c.fx)).length + 1
    await writeTurnEntry(c.fx, 'act_turn_after', {
      id: `entry_after_${position}`,
      position,
      kind: 'user_action',
      content: 'I ask Tobin for the night crossing.',
    })
    await writeTurnEntry(c.fx, 'act_turn_after', {
      id: `entry_after_${position + 1}`,
      position: position + 1,
      kind: 'ai_reply',
      content: 'Tobin names his price and pushes off.',
    })
  }

  it("names the close when a pass's fact sits above it once the turns are undone, and the undo takes it", async () => {
    const c = await openClosed()
    await writeCloseWork(c)
    expect(c.chapter.sequenceNumber).toBe(1)
    await rerun(c)
    await turnAfter(c)
    await writeLater(
      c.fx,
      {
        kind: 'createEntity',
        source: 'periodic_classifier',
        payload: { entry: { ...MIRA, branchId: c.fx.branchId } },
      },
      { actionId: 'act_pass_above', entryId: c.fx.replyIds[5]! },
    )
    // CTRL-Z takes the turn and steps over the pass, whose fact stays above the re-run.
    expect(await undoLastAction(c.fx.branchId, c.fx.ctx)).toStrictEqual({ status: 'ok' })
    expect(await entityOf(c.fx, MIRA.id)).toBeDefined()

    expect(await readUndoImpact(c.fx.branchId, RERUN, c.fx.ctx)).toMatchObject({
      closeUndone: { chapterNumber: 1 },
    })
    expect(await undoLastAction(c.fx.branchId, c.fx.ctx)).toStrictEqual({
      status: 'ok',
      closeUndone: { chapterNumber: 1 },
    })
    expect(await chapterRows(c.fx)).toEqual([])
  })

  it('names no close while the re-run can restore the one it replaced', async () => {
    const c = await openClosed()
    await writeCloseWork(c)
    await rerun(c)
    await turnAfter(c)
    expect(await undoLastAction(c.fx.branchId, c.fx.ctx)).toStrictEqual({ status: 'ok' })

    expect(await readUndoImpact(c.fx.branchId, RERUN, c.fx.ctx)).not.toHaveProperty('closeUndone')
    expect(await undoLastAction(c.fx.branchId, c.fx.ctx)).toStrictEqual({ status: 'ok' })
    expect(await chapterRows(c.fx)).toHaveLength(1)
  })
})
