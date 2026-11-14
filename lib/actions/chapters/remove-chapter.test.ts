import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { generateStructured } from '@/lib/ai'
import { chapterDraftFrom } from '@/lib/chapters'
import { branches, chapters, type Delta } from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import { type CloseFixture } from '@/lib/pipeline/definitions/__tests__/close-fixture'
import { entriesStore, generationStore, undoRedoStore } from '@/lib/stores'

import { CHAPTER_DELETE_REFUSAL, resolveChapterDeleteSet } from './chapter-delete-set'
import { removeChapter } from './remove-chapter'
import { saveChapter } from './save-chapter'
import { __redoGroupForTest } from '../delta/redo'
import {
  DeltaReplayError,
  ReversalIntegrityError,
  type reverseAndPruneDeltaRows,
} from '../delta/reverse-replay'
import type { selectReversalSet } from '../delta/row-closure'
import { shownCounts } from '../story-entries/__tests__/shown-counts'
import { rollbackToEntry } from '../story-entries/operational'
import { redoLastAction, undoLastAction } from '../story-entries/undo'
import {
  installChapterDeleteHooks,
  END_REPLY,
  CLOSED_AT,
  TOBIN,
  THREAD_KEPT,
  THREAD_ABSORBED,
  CLOSE_LORE_ID,
  worldRows,
  chapterRows,
  entryRows,
  logRows,
  deltasOf,
  openSeeded,
  closeOn,
  openClosed,
  writeLater,
  writeCloseWork,
} from './__tests__/chapter-delete-fixture'

const { generateStructuredMock } = vi.hoisted(() => ({
  generateStructuredMock: vi.fn<typeof generateStructured>(),
}))

vi.mock('@/lib/ai', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  generateStructured: generateStructuredMock,
}))

// One-shot seams into the reversal: a hook before the next selection (a rejection refuses it), and
// a refusal of the next commit before it writes.
const reversalSeams = vi.hoisted(() => ({
  beforeSelection: null as (() => Promise<void>) | null,
  failCommit: null as Error | null,
}))

vi.mock('../delta/row-closure', async (importOriginal) => {
  const actual = await importOriginal<
    Record<string, unknown> & { selectReversalSet: typeof selectReversalSet }
  >()
  const seamed: typeof selectReversalSet = async (ctx, seed) => {
    const before = reversalSeams.beforeSelection
    reversalSeams.beforeSelection = null
    if (before) await before()
    return actual.selectReversalSet(ctx, seed)
  }
  return { ...actual, selectReversalSet: seamed }
})

vi.mock('../delta/reverse-replay', async (importOriginal) => {
  const actual = await importOriginal<
    Record<string, unknown> & { reverseAndPruneDeltaRows: typeof reverseAndPruneDeltaRows }
  >()
  const seamed: typeof reverseAndPruneDeltaRows = async (set, ctx, options, extraOps) => {
    const fault = reversalSeams.failCommit
    reversalSeams.failCommit = null
    if (fault) throw fault
    return actual.reverseAndPruneDeltaRows(set, ctx, options, extraOps)
  }
  return { ...actual, reverseAndPruneDeltaRows: seamed }
})

installChapterDeleteHooks(generateStructuredMock)

afterEach(() => {
  reversalSeams.beforeSelection = null
  reversalSeams.failCommit = null
})

async function processedThrough(fx: CloseFixture): Promise<number | null | undefined> {
  const [row] = await fx.ctx.db
    .select({ status: branches.classifierStatus })
    .from(branches)
    .where(eq(branches.id, fx.branchId))
  return row?.status?.processedThrough
}

// A turn holding the edit gate, as any run in flight does.
function holdGate(fx: CloseFixture): void {
  generationStore.startRun({
    runId: 'run_gate',
    kind: 'turn',
    gateBehavior: 'hard-gate',
    interruptible: null,
    beforeTurn: false,
    actionId: 'act_gate',
    storyId: fx.storyId,
    branchId: fx.branchId,
    abortController: new AbortController(),
    currentPhase: 'narrative',
    intermediates: {},
    terminal: Promise.resolve(),
    resolveTerminal: () => {},
  })
}

// A pass on the branch holding the gate: a head reversal may interrupt it, a chapter delete may not.
function holdPass(fx: CloseFixture): void {
  generationStore.startRun({
    runId: 'run_pass',
    kind: 'periodic-classifier',
    gateBehavior: 'hard-gate',
    interruptible: 'pass',
    beforeTurn: false,
    actionId: 'act_pass',
    storyId: fx.storyId,
    branchId: fx.branchId,
    abortController: new AbortController(),
    currentPhase: 'classify',
    intermediates: {},
    terminal: Promise.resolve(),
    resolveTerminal: () => {},
  })
}

describe("removeChapter 'whole'", () => {
  it('reverses the close groups and leaves every entry in place', async () => {
    const c = await openClosed()
    await writeCloseWork(c)
    expect(c.chapter.closeReport).not.toBeNull()
    const closedEntries = await entryRows(c.fx)
    expect(
      closedEntries.filter((e) => e.chapterId === c.chapter.id).map((e) => e.position),
    ).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect((await worldRows(c.fx)).lore.map((row) => row.id)).toEqual([CLOSE_LORE_ID])

    expect(await removeChapter(c.fx.branchId, c.chapter.id, 'whole', c.fx.ctx)).toEqual({
      status: 'ok',
    })

    expect(await chapterRows(c.fx)).toEqual([])
    expect(await entryRows(c.fx)).toEqual(closedEntries.map((e) => ({ ...e, chapterId: null })))
    const world = await worldRows(c.fx)
    expect(world.lore).toEqual([])
    expect(world.entities.find((row) => row.id === TOBIN.id)?.description).toBe(TOBIN.description)
    expect(world.threads.map((row) => row.id)).toEqual([THREAD_KEPT.id, THREAD_ABSORBED.id])
    expect(world).toEqual(c.before)
    expect(await deltasOf(c.fx, c.actionId)).toEqual([])
  })
})

// The close work's deltas, newest first: what 'divider-only' leaves in the group.
const KEPT_WORK = [
  'delete threads:thr_seal',
  'update threads:thr_letter',
  'update entities:char_tobin',
  'create lore:lore_harrow_ferry',
]

const shapeOf = (d: Delta): string => `${d.op} ${d.targetTable}:${d.targetId}`

describe("removeChapter 'divider-only'", () => {
  it('reverses the row, its report and its stamps, and leaves the rest of the group standing', async () => {
    const c = await openClosed()
    await writeCloseWork(c)
    const closedEntries = await entryRows(c.fx)
    const worked = await worldRows(c.fx)
    const kept = (await deltasOf(c.fx, c.actionId)).filter(
      (d) => d.targetTable !== 'chapters' && d.targetTable !== 'story_entries',
    )
    expect(kept.map(shapeOf)).toEqual(KEPT_WORK)
    expect(kept.every((d) => d.source === 'chapter_close' && d.entryId === c.endEntryId)).toBe(true)

    expect(await removeChapter(c.fx.branchId, c.chapter.id, 'divider-only', c.fx.ctx)).toEqual({
      status: 'ok',
    })

    expect(await chapterRows(c.fx)).toEqual([])
    expect(await entryRows(c.fx)).toEqual(closedEntries.map((e) => ({ ...e, chapterId: null })))
    expect(await deltasOf(c.fx, c.actionId)).toEqual(kept)
    expect(await worldRows(c.fx)).toEqual(worked)
  })

  it('leaves the kept writes to CTRL-Z, which reverses them, and to redo, which restores them', async () => {
    const c = await openClosed()
    await writeCloseWork(c)
    const worked = await worldRows(c.fx)
    expect(await removeChapter(c.fx.branchId, c.chapter.id, 'divider-only', c.fx.ctx)).toEqual({
      status: 'ok',
    })
    expect(await chapterRows(c.fx)).toEqual([])
    const kept = await deltasOf(c.fx, c.actionId)
    expect(kept.map(shapeOf)).toEqual(KEPT_WORK)

    expect(await undoLastAction(c.fx.branchId, c.fx.ctx)).toEqual({ status: 'ok' })
    expect(await worldRows(c.fx)).toEqual(c.before)
    expect(await deltasOf(c.fx, c.actionId)).toEqual([])

    expect(await redoLastAction(c.fx.branchId, c.fx.ctx)).toEqual({ status: 'ok' })
    expect(await worldRows(c.fx)).toEqual(worked)
    expect(await deltasOf(c.fx, c.actionId)).toEqual(kept)
    // The divider's deltas were pruned, so redo has nothing to bring it back from.
    expect(await chapterRows(c.fx)).toEqual([])
  })

  it('leaves the kept writes to a rollback to the end entry', async () => {
    const c = await openClosed()
    await writeCloseWork(c)
    expect(await removeChapter(c.fx.branchId, c.chapter.id, 'divider-only', c.fx.ctx)).toEqual({
      status: 'ok',
    })
    expect(await chapterRows(c.fx)).toEqual([])
    expect((await deltasOf(c.fx, c.actionId)).map(shapeOf)).toEqual(KEPT_WORK)

    const counts = await shownCounts(c.fx.branchId, c.endEntryId, c.fx.ctx)
    expect(
      await rollbackToEntry(c.fx.branchId, c.endEntryId, c.fx.ctx, { expectedCounts: counts }),
    ).toEqual({ status: 'ok', counts })

    expect(await deltasOf(c.fx, c.actionId)).toEqual([])
    expect(await chapterRows(c.fx)).toEqual([])
    expect(await worldRows(c.fx)).toEqual(c.before)
    expect((await entryRows(c.fx)).map((e) => e.position)).toEqual([1, 2, 3, 4, 5, 6])
  })
})

describe('removeChapter scope', () => {
  it.each(['whole', 'divider-only'] as const)(
    "reverses only the latest chapter's groups, leaving an earlier close whole (%s)",
    async (mode) => {
      const fx = await openSeeded()
      const first = await closeOn(fx, fx.replyIds[1])
      const second = await closeOn(fx, fx.replyIds[3])
      const firstDeltas = await deltasOf(fx, first.actionId)

      expect(await removeChapter(fx.branchId, second.chapter.id, mode, fx.ctx)).toEqual({
        status: 'ok',
      })

      expect(await chapterRows(fx)).toEqual([first.chapter])
      expect(await deltasOf(fx, first.actionId)).toEqual(firstDeltas)
    },
  )
})

describe('removeChapter after a Timeline save', () => {
  it.each(['whole', 'divider-only'] as const)(
    "takes the user's rename with the chapter (%s)",
    async (mode) => {
      const c = await openClosed()
      const draft = { ...chapterDraftFrom(c.chapter), title: 'The Ferry at Night' }
      expect(await saveChapter({ row: c.chapter, draft }, c.fx.ctx)).toEqual({
        status: 'ok',
        id: c.chapter.id,
      })
      const [rename] = (await logRows(c.fx)).filter((d) => d.source === 'user_edit')
      expect(shapeOf(rename)).toBe(`update chapters:${c.chapter.id}`)

      expect(await removeChapter(c.fx.branchId, c.chapter.id, mode, c.fx.ctx)).toEqual({
        status: 'ok',
      })

      expect(await chapterRows(c.fx)).toEqual([])
      expect(await deltasOf(c.fx, rename.actionId)).toEqual([])
    },
  )
})

describe('removeChapter refusals', () => {
  it('refuses in-flight while a run holds the gate, writing nothing', async () => {
    const c = await openClosed()
    const log = await logRows(c.fx)
    holdGate(c.fx)

    expect(await removeChapter(c.fx.branchId, c.chapter.id, 'whole', c.fx.ctx)).toMatchObject({
      status: 'rejected',
      code: CHAPTER_DELETE_REFUSAL.inFlight,
    })

    expect(await logRows(c.fx)).toEqual(log)
    expect(await chapterRows(c.fx)).toEqual([c.chapter])
  })

  it('refuses in-flight while an interruptible pass on the branch holds the gate', async () => {
    const c = await openClosed()
    const log = await logRows(c.fx)
    holdPass(c.fx)

    expect(await removeChapter(c.fx.branchId, c.chapter.id, 'whole', c.fx.ctx)).toMatchObject({
      status: 'rejected',
      code: CHAPTER_DELETE_REFUSAL.inFlight,
    })

    expect(await logRows(c.fx)).toEqual(log)
    expect(await chapterRows(c.fx)).toEqual([c.chapter])
  })

  it('refuses a second call issued in the same tick as in-flight, not as re-entry', async () => {
    const c = await openClosed()

    const first = removeChapter(c.fx.branchId, c.chapter.id, 'whole', c.fx.ctx)
    const second = removeChapter(c.fx.branchId, c.chapter.id, 'divider-only', c.fx.ctx)

    expect(await second).toMatchObject({
      status: 'rejected',
      code: CHAPTER_DELETE_REFUSAL.inFlight,
    })
    expect(await first).toEqual({ status: 'ok' })
    expect(await chapterRows(c.fx)).toEqual([])
    expect(await deltasOf(c.fx, c.actionId)).toEqual([])
  })

  it('refuses not-latest on an earlier chapter, in either mode', async () => {
    const fx = await openSeeded()
    const first = await closeOn(fx, fx.replyIds[1])
    await closeOn(fx, fx.replyIds[3])
    const log = await logRows(fx)

    for (const mode of ['whole', 'divider-only'] as const)
      expect(await removeChapter(fx.branchId, first.chapter.id, mode, fx.ctx)).toMatchObject({
        status: 'rejected',
        code: CHAPTER_DELETE_REFUSAL.notLatest,
      })

    expect(await logRows(fx)).toEqual(log)
  })

  it('refuses not-latest on a chapter read as the latest before a later close committed', async () => {
    const fx = await openSeeded()
    const first = await closeOn(fx, fx.replyIds[1])
    // What a confirm opened on it read: the latest then.
    expect(
      await resolveChapterDeleteSet(fx.branchId, first.chapter.id, 'whole', fx.ctx),
    ).not.toHaveProperty('status')
    await closeOn(fx, fx.replyIds[3])
    const log = await logRows(fx)

    expect(await removeChapter(fx.branchId, first.chapter.id, 'whole', fx.ctx)).toMatchObject({
      status: 'rejected',
      code: CHAPTER_DELETE_REFUSAL.notLatest,
    })

    expect(await logRows(fx)).toEqual(log)
    expect((await chapterRows(fx)).map((ch) => ch.sequenceNumber)).toEqual([1, 2])
  })

  it('refuses no-close on a chapter row no close wrote, even one the user edited', async () => {
    const fx = await openSeeded()
    await fx.ctx.db.insert(chapters).values({
      id: 'chapter_by_hand',
      branchId: fx.branchId,
      sequenceNumber: 1,
      title: 'Written by hand',
      summary: 'No close wrote this row.',
      theme: 'none',
      keywords: [],
      startEntryId: fx.entries[0].id,
      endEntryId: fx.replyIds[END_REPLY],
      tokenCount: 0,
      closedAt: CLOSED_AT,
      createdAt: CLOSED_AT,
      updatedAt: CLOSED_AT,
    })
    // A delta on the row, but no chapter_close one: the group read filters by source.
    await writeLater(
      fx,
      {
        kind: 'updateChapter',
        source: 'user_edit',
        payload: { branchId: fx.branchId, id: 'chapter_by_hand', patch: { title: 'Renamed' } },
      },
      { actionId: 'act_user_title', entryId: null },
    )
    const log = await logRows(fx)

    expect(await removeChapter(fx.branchId, 'chapter_by_hand', 'whole', fx.ctx)).toMatchObject({
      status: 'rejected',
      code: CHAPTER_DELETE_REFUSAL.noClose,
    })

    expect(await logRows(fx)).toEqual(log)
  })

  it('refuses not-found on a chapter id with no row', async () => {
    const c = await openClosed()
    const log = await logRows(c.fx)

    expect(await removeChapter(c.fx.branchId, 'chapter_missing', 'whole', c.fx.ctx)).toMatchObject({
      status: 'rejected',
      code: CHAPTER_DELETE_REFUSAL.notFound,
    })

    expect(await logRows(c.fx)).toEqual(log)
  })

  it('refuses integrity when the closure refuses at selection, and logs it', async () => {
    const c = await openClosed()
    await writeCloseWork(c)
    const log = await logRows(c.fx)
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {})
    reversalSeams.beforeSelection = () =>
      Promise.reject(
        new ReversalIntegrityError(
          'no-create',
          `lore:${c.fx.branchId}:${CLOSE_LORE_ID}`,
          c.actionId,
        ),
      )

    expect(await removeChapter(c.fx.branchId, c.chapter.id, 'whole', c.fx.ctx)).toMatchObject({
      status: 'rejected',
      code: CHAPTER_DELETE_REFUSAL.integrity,
    })

    expect(error).toHaveBeenCalledWith(
      'action_layer.reversal_refused',
      expect.objectContaining({ branchId: c.fx.branchId, refusal: 'no-create' }),
    )
    expect(await logRows(c.fx)).toEqual(log)
    expect(await chapterRows(c.fx)).toEqual([c.chapter])
  })

  it('refuses integrity when the planner refuses at commit, and logs it', async () => {
    const c = await openClosed()
    await writeCloseWork(c)
    const log = await logRows(c.fx)
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {})
    reversalSeams.failCommit = new ReversalIntegrityError(
      'write-back',
      `entities:${c.fx.branchId}:${TOBIN.id}`,
      c.actionId,
    )

    expect(await removeChapter(c.fx.branchId, c.chapter.id, 'whole', c.fx.ctx)).toMatchObject({
      status: 'rejected',
      code: CHAPTER_DELETE_REFUSAL.integrity,
    })

    expect(error).toHaveBeenCalledWith(
      'action_layer.reversal_refused',
      expect.objectContaining({ branchId: c.fx.branchId, refusal: 'write-back' }),
    )
    expect(await logRows(c.fx)).toEqual(log)
    expect(await chapterRows(c.fx)).toEqual([c.chapter])
  })
})

describe('removeChapter and the bracket', () => {
  it('ticks settleCount once, leaves the watermark where it was and clears redo', async () => {
    const c = await openClosed()
    await writeCloseWork(c)
    // The fixture's last entry: a close never moves the watermark, and neither may its delete.
    expect(await processedThrough(c.fx)).toBe(13)
    const settled = generationStore.getSettleCount()
    undoRedoStore.pushRedoGroup(__redoGroupForTest())

    expect(await removeChapter(c.fx.branchId, c.chapter.id, 'whole', c.fx.ctx)).toEqual({
      status: 'ok',
    })

    expect(generationStore.getSettleCount()).toBe(settled + 1)
    expect(await processedThrough(c.fx)).toBe(13)
    expect(undoRedoStore.hasRedo()).toBe(false)
  })

  it('clears redo when the delete commits and only its store sync throws', async () => {
    const c = await openClosed()
    const settled = generationStore.getSettleCount()
    undoRedoStore.pushRedoGroup(__redoGroupForTest())
    vi.spyOn(entriesStore, 'patch').mockImplementation(() => {
      throw new Error('store sync boom')
    })

    const error: unknown = await removeChapter(
      c.fx.branchId,
      c.chapter.id,
      'whole',
      c.fx.ctx,
    ).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(DeltaReplayError)
    expect((error as DeltaReplayError).committed).toBe(true)
    expect(undoRedoStore.hasRedo()).toBe(false)
    expect(await chapterRows(c.fx)).toEqual([])
    expect(generationStore.getSettleCount()).toBe(settled + 1)
  })
})
