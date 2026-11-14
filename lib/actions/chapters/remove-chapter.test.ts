import { and, asc, desc, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { generateStructured } from '@/lib/ai'
import {
  branches,
  chapters,
  deltas,
  entities,
  happeningAwareness,
  lore,
  storyEntries,
  threads,
  type Chapter,
  type CharacterState,
  type Delta,
  type Entity,
  type Lore,
  type NewEntity,
  type NewThread,
  type StoryEntry,
  type Thread,
} from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import { expectRan, resetSingletons } from '@/lib/pipeline/__tests__/harness'
import {
  metadataReplyResult,
  openCloseFixture,
  type CloseFixture,
} from '@/lib/pipeline/definitions/__tests__/close-fixture'
import { __setCloseAgentSlots, NO_CLOSE_TASKS } from '@/lib/pipeline/definitions/close-agent/slots'
import { entriesStore, generationStore, undoRedoStore } from '@/lib/stores'

import { CHAPTER_DELETE_REFUSAL, resolveChapterDeleteSet } from './chapter-delete-set'
import { removeChapter } from './remove-chapter'
import { startManualClose } from './start-manual-close'
import { applyDeltaAction, applyDeltaActionGroupWithOutcomes } from '../delta/apply-delta-action'
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
import type { DeltaSource, PipelineAction } from '../types'

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

beforeEach(() => {
  resetSingletons()
  __setCloseAgentSlots(NO_CLOSE_TASKS)
  generateStructuredMock.mockReset()
  generateStructuredMock.mockResolvedValue(metadataReplyResult())
})

afterEach(() => {
  reversalSeams.beforeSelection = null
  reversalSeams.failCommit = null
  __setCloseAgentSlots(undefined)
  resetSingletons()
  vi.restoreAllMocks()
})

// The third of six replies (position 7 of 13): turns lie on both sides of the close.
const END_REPLY = 2

const SEEDED_AT = 1_767_225_700_000
const CLOSED_AT = 1_767_225_900_000

const TOBIN_STATE: CharacterState = {
  visual: { attire: 'a tarred coat' },
  traits: ['taciturn'],
  drives: [],
  current_location_id: null,
  equipped_items: [],
  inventory: [],
  faction_id: null,
  lastSeenAt: null,
}

const TOBIN: Omit<NewEntity, 'branchId'> = {
  id: 'char_tobin',
  kind: 'character',
  name: 'Tobin',
  description: 'The ferryman at Harrow.',
  status: 'active',
  injectionMode: 'auto',
  state: TOBIN_STATE,
  createdAt: SEEDED_AT,
  updatedAt: SEEDED_AT,
}

const TOBIN_CLOSE_DESCRIPTION =
  'The Harrow ferryman, who poled Wren across at night for a courier price.'

const THREAD_KEPT: Omit<NewThread, 'branchId'> = {
  id: 'thr_letter',
  title: 'The letter for Low Ashby',
  description: 'Wren carries a sealed letter to the reeve of Low Ashby.',
  status: 'active',
  injectionMode: 'auto',
  createdAt: SEEDED_AT,
  updatedAt: SEEDED_AT,
}

const THREAD_ABSORBED: Omit<NewThread, 'branchId'> = {
  id: 'thr_seal',
  title: 'The sealed letter',
  description: 'The courier seal must reach Low Ashby unbroken.',
  status: 'active',
  injectionMode: 'auto',
  createdAt: SEEDED_AT + 1,
  updatedAt: SEEDED_AT + 1,
}

const MERGED_DESCRIPTION =
  'Wren carries a sealed letter to the reeve of Low Ashby, its courier seal unbroken.'

const CLOSE_LORE_ID = 'lore_harrow_ferry'

type WorldRows = { entities: Entity[]; lore: Lore[]; threads: Thread[] }

type ClosedChapter = {
  fx: CloseFixture
  /** The close's action: its own group's, and every write `writeUnderClose` lands. */
  actionId: string
  /** E, the reply the chapter ends on. */
  endEntryId: string
  /** The row as the close left it, its report written. */
  chapter: Chapter
  /** The world tables just before the close ran. */
  before: WorldRows
}

async function worldRows(fx: CloseFixture): Promise<WorldRows> {
  const { db } = fx.ctx
  return {
    entities: await db
      .select()
      .from(entities)
      .where(eq(entities.branchId, fx.branchId))
      .orderBy(asc(entities.id)),
    lore: await db.select().from(lore).where(eq(lore.branchId, fx.branchId)).orderBy(asc(lore.id)),
    threads: await db
      .select()
      .from(threads)
      .where(eq(threads.branchId, fx.branchId))
      .orderBy(asc(threads.id)),
  }
}

async function chapterRows(fx: CloseFixture): Promise<Chapter[]> {
  return fx.ctx.db
    .select()
    .from(chapters)
    .where(eq(chapters.branchId, fx.branchId))
    .orderBy(asc(chapters.sequenceNumber))
}

async function entryRows(fx: CloseFixture): Promise<StoryEntry[]> {
  return fx.ctx.db
    .select()
    .from(storyEntries)
    .where(eq(storyEntries.branchId, fx.branchId))
    .orderBy(asc(storyEntries.position))
}

// Newest first, as CTRL-Z reads the log.
async function logRows(fx: CloseFixture): Promise<Delta[]> {
  return (await fx.ctx.db
    .select()
    .from(deltas)
    .where(eq(deltas.branchId, fx.branchId))
    .orderBy(desc(deltas.logPosition))) as Delta[]
}

async function deltasOf(fx: CloseFixture, actionId: string): Promise<Delta[]> {
  return (await logRows(fx)).filter((d) => d.actionId === actionId)
}

async function processedThrough(fx: CloseFixture): Promise<number | null | undefined> {
  const [row] = await fx.ctx.db
    .select({ status: branches.classifierStatus })
    .from(branches)
    .where(eq(branches.id, fx.branchId))
  return row?.status?.processedThrough
}

// A pass's write before any close, anchored on the first reply, where no rollback here reaches.
async function seedPassWrite(fx: CloseFixture, action: PipelineAction): Promise<void> {
  const result = await applyDeltaAction(
    { action, actionId: 'act_seed_pass', branchId: fx.branchId, entryId: fx.replyIds[0] },
    fx.ctx,
  )
  if (result.status !== 'ok') throw new Error(`seed refused: ${result.reason}`)
}

/** The close fixture with Tobin and the two threads a merge joins, written by a pass. */
async function openSeeded(): Promise<CloseFixture> {
  const fx = await openCloseFixture()
  await seedPassWrite(fx, {
    kind: 'createEntity',
    source: 'periodic_classifier',
    payload: { entry: { ...TOBIN, branchId: fx.branchId } },
  })
  for (const thread of [THREAD_KEPT, THREAD_ABSORBED])
    await seedPassWrite(fx, {
      kind: 'createThread',
      source: 'periodic_classifier',
      payload: { entry: { ...thread, branchId: fx.branchId } },
    })
  return fx
}

/** Runs a manual close ending on `endEntryId` to completion. */
async function closeOn(fx: CloseFixture, endEntryId: string): Promise<ClosedChapter> {
  const before = await worldRows(fx)
  const tx = expectRan(await startManualClose(fx.branchId, endEntryId, fx.ctx))
  expect(tx.outcome).toBe('completed')
  const [chapter] = await fx.ctx.db
    .select()
    .from(chapters)
    .where(and(eq(chapters.branchId, fx.branchId), eq(chapters.endEntryId, endEntryId)))
  if (!chapter) throw new Error(`no chapter ends on ${endEntryId}`)
  return { fx, actionId: tx.actionId, endEntryId, chapter, before }
}

/** `openSeeded`, then a close ending on E, the third reply. */
async function openClosed(): Promise<ClosedChapter> {
  const fx = await openSeeded()
  return closeOn(fx, fx.replyIds[END_REPLY])
}

/** Lands `actions` as one group under the close's action, anchored on E, as a close's tool does. */
async function writeUnderClose(
  c: ClosedChapter,
  actions: readonly PipelineAction[],
): Promise<void> {
  const outcome = await applyDeltaActionGroupWithOutcomes(
    actions,
    { actionId: c.actionId, branchId: c.fx.branchId, entryId: c.endEntryId },
    c.fx.ctx,
  )
  if (outcome.status !== 'ok' || outcome.outcomes.some((one) => one.status !== 'landed'))
    throw new Error(`close writes refused: ${JSON.stringify(outcome)}`)
}

/** Lands one write under its own action, as a pass, a turn or a user's save does. */
async function writeLater(
  fx: CloseFixture,
  action: PipelineAction,
  at: { actionId: string; entryId: string | null },
): Promise<void> {
  const result = await applyDeltaAction(
    { action, actionId: at.actionId, branchId: fx.branchId, entryId: at.entryId },
    fx.ctx,
  )
  if (result.status !== 'ok') throw new Error(`${at.actionId} refused: ${result.reason}`)
}

const loreCreate = (branchId: string, id: string, title: string): PipelineAction => ({
  kind: 'createLore',
  source: 'chapter_close',
  payload: {
    entry: {
      id,
      branchId,
      title,
      body: `${title}, as the close wrote it.`,
      category: null,
      keywords: [],
      priority: 0,
      injectionMode: 'auto',
      tags: [],
      embeddingStale: 1,
      createdAt: CLOSED_AT,
      updatedAt: CLOSED_AT,
    },
  },
})

const describeTobin = (
  branchId: string,
  description: string,
  source: DeltaSource,
): PipelineAction => ({
  kind: 'updateEntity',
  source,
  payload: { branchId, id: TOBIN.id, patch: { description } },
})

/** The close's tool work: a lore create, Tobin's description, and the seal thread merged in. */
async function writeCloseWork(c: ClosedChapter): Promise<void> {
  const { branchId } = c.fx
  await writeUnderClose(c, [
    loreCreate(branchId, CLOSE_LORE_ID, 'The Harrow ferry'),
    describeTobin(branchId, TOBIN_CLOSE_DESCRIPTION, 'chapter_close'),
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

const LATER_DESCRIPTION = 'The Harrow ferryman, who charges double after dark.'

async function entityOf(fx: CloseFixture, id: string): Promise<Entity | undefined> {
  const [row] = await fx.ctx.db
    .select()
    .from(entities)
    .where(and(eq(entities.branchId, fx.branchId), eq(entities.id, id)))
  return row
}

/** An update of an awareness row's retrieval count alone: the shape a close's reset logs. */
const retrievalWrite = (
  branchId: string,
  id: string,
  priorCount: number,
  source: DeltaSource,
): PipelineAction => ({
  kind: 'bumpAwarenessRetrieval',
  source,
  payload: { branchId, id, priorCount },
})

/** A happening Tobin knows of, written by a pass, and his awareness of it, counted twice. */
async function seedAwareness(fx: CloseFixture): Promise<string> {
  await seedPassWrite(fx, {
    kind: 'createHappening',
    source: 'periodic_classifier',
    payload: {
      entry: {
        id: 'hap_crossing',
        branchId: fx.branchId,
        title: 'The night crossing',
        createdAt: SEEDED_AT,
        updatedAt: SEEDED_AT,
      },
    },
  })
  await writeLater(
    fx,
    {
      kind: 'upsertHappeningAwareness',
      source: 'user_edit',
      payload: {
        branchId: fx.branchId,
        characterId: TOBIN.id,
        happeningId: 'hap_crossing',
        retrievalCount: 2,
        proseEntryId: null,
      },
    },
    { actionId: 'act_seed_awareness', entryId: null },
  )
  const [row] = await fx.ctx.db
    .select({ id: happeningAwareness.id })
    .from(happeningAwareness)
    .where(
      and(
        eq(happeningAwareness.branchId, fx.branchId),
        eq(happeningAwareness.characterId, TOBIN.id),
      ),
    )
  if (!row) throw new Error('no awareness row for Tobin')
  return row.id
}

async function retrievalCountOf(fx: CloseFixture, id: string): Promise<number | undefined> {
  const [row] = await fx.ctx.db
    .select({ count: happeningAwareness.retrievalCount })
    .from(happeningAwareness)
    .where(and(eq(happeningAwareness.branchId, fx.branchId), eq(happeningAwareness.id, id)))
  return row?.count
}

const editLore = (
  branchId: string,
  id: string,
  body: string,
  source: DeltaSource,
): PipelineAction => ({
  kind: 'updateLore',
  source,
  payload: { branchId, id, patch: { body }, proseEntryId: null },
})

// R, Q and S at the top, and the pier, P, under R.
async function seedPlaces(fx: CloseFixture): Promise<void> {
  const places = [
    ['loc_ridge', 'Harrow Ridge', null],
    ['loc_quay', 'Harrow Quay', null],
    ['loc_shrine', 'The River Shrine', null],
    ['loc_pier', "Tobin's Pier", 'loc_ridge'],
  ] as const
  for (const [id, name, parent] of places)
    await seedPassWrite(fx, {
      kind: 'createEntity',
      source: 'periodic_classifier',
      payload: {
        entry: {
          id,
          branchId: fx.branchId,
          kind: 'location',
          name,
          status: 'active',
          injectionMode: 'auto',
          state: { parent_location_id: parent },
          createdAt: SEEDED_AT,
          updatedAt: SEEDED_AT,
        },
      },
    })
}

const placeUnder = (
  branchId: string,
  id: string,
  parentId: string,
  source: DeltaSource,
): PipelineAction => ({
  kind: 'placeLocation',
  source,
  payload: { branchId, id, placement: { kind: 'under', parentId }, proseEntryId: null },
})

// A turn past the fixture's last entry: its action and reply created under one action id.
async function writeLaterTurn(fx: CloseFixture, actionId: string): Promise<void> {
  const last = fx.entries[fx.entries.length - 1].position
  const turn = [
    { id: 'entry_later_action', kind: 'user_action', content: 'I ask Tobin his price after dark.' },
    { id: 'entry_later_reply', kind: 'ai_reply', content: 'Double, he says, and does not smile.' },
  ] as const
  for (const [offset, entry] of turn.entries()) {
    const position = last + 1 + offset
    await writeLater(
      fx,
      {
        kind: 'createStoryEntry',
        source: entry.kind === 'user_action' ? 'user_edit' : 'ai_classifier',
        payload: {
          entry: {
            id: entry.id,
            branchId: fx.branchId,
            position,
            kind: entry.kind,
            content: entry.content,
            chapterId: null,
            metadata: { sceneEntities: [], currentLocationId: null, worldTime: position * 60 },
            createdAt: CLOSED_AT + position,
          },
        },
      },
      { actionId, entryId: entry.kind === 'ai_reply' ? entry.id : null },
    )
  }
}

type LaterWriter = {
  writer: string
  source: DeltaSource
  anchor: (c: ClosedChapter) => string | null
}

const LATER_WRITERS: LaterWriter[] = [
  { writer: 'a later user_edit', source: 'user_edit', anchor: () => null },
  {
    writer: 'a periodic_classifier delta anchored past the end entry',
    source: 'periodic_classifier',
    anchor: (c) => c.fx.replyIds[3],
  },
  {
    writer: 'a per_turn_classifier fold write with a null anchor',
    source: 'per_turn_classifier',
    anchor: () => null,
  },
  {
    writer: 'a pass anchored on the end entry and logged after the close',
    source: 'periodic_classifier',
    anchor: (c) => c.endEntryId,
  },
]

describe('later writes win over a whole delete (C13)', () => {
  it.each(LATER_WRITERS)("keeps the value $writer wrote over the close's", async (later) => {
    const c = await openClosed()
    await writeCloseWork(c)
    await writeLater(c.fx, describeTobin(c.fx.branchId, LATER_DESCRIPTION, later.source), {
      actionId: 'act_later',
      entryId: later.anchor(c),
    })

    expect(await removeChapter(c.fx.branchId, c.chapter.id, 'whole', c.fx.ctx)).toEqual({
      status: 'ok',
    })

    expect((await entityOf(c.fx, TOBIN.id))?.description).toBe(LATER_DESCRIPTION)
    expect(await deltasOf(c.fx, 'act_later')).toHaveLength(1)
    expect((await worldRows(c.fx)).lore).toEqual([])
  })

  it("keeps the state sub-field a later write changed and reverses the close's other one", async () => {
    const c = await openClosed()
    await writeUnderClose(c, [
      {
        kind: 'updateEntity',
        source: 'chapter_close',
        payload: {
          branchId: c.fx.branchId,
          id: TOBIN.id,
          patch: {
            state: {
              ...TOBIN_STATE,
              visual: { attire: 'an oilskin' },
              traits: ['taciturn', 'greedy'],
            },
          },
        },
      },
    ])
    await writeLater(
      c.fx,
      {
        kind: 'updateEntityVisualState',
        source: 'per_turn_classifier',
        payload: {
          branchId: c.fx.branchId,
          id: TOBIN.id,
          visual: { attire: 'a salt-stained oilskin' },
        },
      },
      { actionId: 'act_turn_fold', entryId: null },
    )

    expect(await removeChapter(c.fx.branchId, c.chapter.id, 'whole', c.fx.ctx)).toEqual({
      status: 'ok',
    })

    const state = (await entityOf(c.fx, TOBIN.id))?.state as CharacterState
    expect(state.visual).toEqual({ attire: 'a salt-stained oilskin' })
    expect(state.traits).toEqual(['taciturn'])
  })

  it('restores the count a later retrieval bump moved, which holds no field', async () => {
    const fx = await openSeeded()
    const awarenessId = await seedAwareness(fx)
    const c = await closeOn(fx, fx.replyIds[END_REPLY])
    await writeUnderClose(c, [retrievalWrite(fx.branchId, awarenessId, 2, 'chapter_close')])
    await writeLater(fx, retrievalWrite(fx.branchId, awarenessId, 3, 'ai_classifier'), {
      actionId: 'act_turn_bump',
      entryId: null,
    })
    expect(await retrievalCountOf(fx, awarenessId)).toBe(4)

    expect(await removeChapter(fx.branchId, c.chapter.id, 'whole', fx.ctx)).toEqual({
      status: 'ok',
    })

    expect(await retrievalCountOf(fx, awarenessId)).toBe(2)
  })

  // P under R; the close moves P to Q; a later pass moves it to S; the user deletes R. The ref
  // clears read the same later writes as the walk, so P isn't unplaced over a move that stands.
  it('leaves a place where a later pass moved it after the user deleted its old parent', async () => {
    const fx = await openSeeded()
    await seedPlaces(fx)
    const c = await closeOn(fx, fx.replyIds[END_REPLY])
    await writeUnderClose(c, [placeUnder(fx.branchId, 'loc_pier', 'loc_quay', 'chapter_close')])
    await writeLater(fx, placeUnder(fx.branchId, 'loc_pier', 'loc_shrine', 'periodic_classifier'), {
      actionId: 'act_pass_later',
      entryId: fx.replyIds[3],
    })
    await writeLater(
      fx,
      {
        kind: 'deleteEntity',
        source: 'user_edit',
        payload: { branchId: fx.branchId, id: 'loc_ridge' },
      },
      { actionId: 'act_user_delete', entryId: null },
    )

    expect(await removeChapter(fx.branchId, c.chapter.id, 'whole', fx.ctx)).toEqual({
      status: 'ok',
    })

    expect((await entityOf(fx, 'loc_pier'))?.state).toEqual({ parent_location_id: 'loc_shrine' })
  })

  // The closure takes the user's edit with the row, as any machine create's later writes.
  it('removes a lore row the close created though the user edited it since', async () => {
    const c = await openClosed()
    await writeCloseWork(c)
    await writeLater(
      c.fx,
      editLore(c.fx.branchId, CLOSE_LORE_ID, 'Tobin charges double after dark.', 'user_edit'),
      { actionId: 'act_user_lore', entryId: null },
    )

    expect(await removeChapter(c.fx.branchId, c.chapter.id, 'whole', c.fx.ctx)).toEqual({
      status: 'ok',
    })

    expect((await worldRows(c.fx)).lore).toEqual([])
    expect((await logRows(c.fx)).filter((d) => d.targetTable === 'lore')).toEqual([])
    expect(await deltasOf(c.fx, 'act_user_lore')).toEqual([])
  })

  // C13's accepted residue: the later write's undo holds the close's value, so undoing that turn
  // after the delete writes it back.
  it("lets a later turn's undo write the close's value back after the delete", async () => {
    const c = await openClosed()
    await writeCloseWork(c)
    await writeLaterTurn(c.fx, 'act_turn_later')
    await writeLater(c.fx, describeTobin(c.fx.branchId, LATER_DESCRIPTION, 'per_turn_classifier'), {
      actionId: 'act_turn_later',
      entryId: null,
    })

    expect(await removeChapter(c.fx.branchId, c.chapter.id, 'whole', c.fx.ctx)).toEqual({
      status: 'ok',
    })
    expect((await entityOf(c.fx, TOBIN.id))?.description).toBe(LATER_DESCRIPTION)

    expect(await undoLastAction(c.fx.branchId, c.fx.ctx)).toEqual({ status: 'ok' })

    expect((await entityOf(c.fx, TOBIN.id))?.description).toBe(TOBIN_CLOSE_DESCRIPTION)
    expect((await entryRows(c.fx)).map((e) => e.id)).not.toContain('entry_later_action')
  })
})
