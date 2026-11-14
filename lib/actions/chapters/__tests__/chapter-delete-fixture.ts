import { and, asc, desc, eq } from 'drizzle-orm'
import { afterEach, beforeEach, expect, vi, type Mock } from 'vitest'

import type { generateStructured } from '@/lib/ai'
import {
  chapters,
  deltas,
  entities,
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
import { expectRan, resetSingletons } from '@/lib/pipeline/__tests__/harness'
import {
  metadataReplyResult,
  openCloseFixture,
  type CloseFixture,
} from '@/lib/pipeline/definitions/__tests__/close-fixture'
import { __setCloseAgentSlots, NO_CLOSE_TASKS } from '@/lib/pipeline/definitions/close-agent/slots'

import { applyDeltaAction, applyDeltaActionGroupWithOutcomes } from '../../delta/apply-delta-action'
import type { DeltaSource, PipelineAction } from '../../types'
import { startManualClose } from '../start-manual-close'

/** The file-level hooks every chapter-delete suite shares. */
export function installChapterDeleteHooks(
  generateStructuredMock: Mock<typeof generateStructured>,
): void {
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
}

// The third of six replies (position 7 of 13): turns lie on both sides of the close.
export const END_REPLY = 2

export const SEEDED_AT = 1_767_225_700_000
export const CLOSED_AT = 1_767_225_900_000

export const TOBIN_STATE: CharacterState = {
  visual: { attire: 'a tarred coat' },
  traits: ['taciturn'],
  drives: [],
  current_location_id: null,
  equipped_items: [],
  inventory: [],
  faction_id: null,
  lastSeenAt: null,
}

export const TOBIN: Omit<NewEntity, 'branchId'> = {
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

export const TOBIN_CLOSE_DESCRIPTION =
  'The Harrow ferryman, who poled Wren across at night for a courier price.'

export const THREAD_KEPT: Omit<NewThread, 'branchId'> = {
  id: 'thr_letter',
  title: 'The letter for Low Ashby',
  description: 'Wren carries a sealed letter to the reeve of Low Ashby.',
  status: 'active',
  injectionMode: 'auto',
  createdAt: SEEDED_AT,
  updatedAt: SEEDED_AT,
}

export const THREAD_ABSORBED: Omit<NewThread, 'branchId'> = {
  id: 'thr_seal',
  title: 'The sealed letter',
  description: 'The courier seal must reach Low Ashby unbroken.',
  status: 'active',
  injectionMode: 'auto',
  createdAt: SEEDED_AT + 1,
  updatedAt: SEEDED_AT + 1,
}

export const MERGED_DESCRIPTION =
  'Wren carries a sealed letter to the reeve of Low Ashby, its courier seal unbroken.'

export const CLOSE_LORE_ID = 'lore_harrow_ferry'

export type WorldRows = { entities: Entity[]; lore: Lore[]; threads: Thread[] }

export type ClosedChapter = {
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

export async function worldRows(fx: CloseFixture): Promise<WorldRows> {
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

export async function chapterRows(fx: CloseFixture): Promise<Chapter[]> {
  return fx.ctx.db
    .select()
    .from(chapters)
    .where(eq(chapters.branchId, fx.branchId))
    .orderBy(asc(chapters.sequenceNumber))
}

export async function entryRows(fx: CloseFixture): Promise<StoryEntry[]> {
  return fx.ctx.db
    .select()
    .from(storyEntries)
    .where(eq(storyEntries.branchId, fx.branchId))
    .orderBy(asc(storyEntries.position))
}

// Newest first, as CTRL-Z reads the log.
export async function logRows(fx: CloseFixture): Promise<Delta[]> {
  return (await fx.ctx.db
    .select()
    .from(deltas)
    .where(eq(deltas.branchId, fx.branchId))
    .orderBy(desc(deltas.logPosition))) as Delta[]
}

export async function deltasOf(fx: CloseFixture, actionId: string): Promise<Delta[]> {
  return (await logRows(fx)).filter((d) => d.actionId === actionId)
}

// A pass's write before any close, anchored on the first reply, where no rollback here reaches.
export async function seedPassWrite(fx: CloseFixture, action: PipelineAction): Promise<void> {
  const result = await applyDeltaAction(
    { action, actionId: 'act_seed_pass', branchId: fx.branchId, entryId: fx.replyIds[0] },
    fx.ctx,
  )
  if (result.status !== 'ok') throw new Error(`seed refused: ${result.reason}`)
}

/** The close fixture with Tobin and the two threads a merge joins, written by a pass. */
export async function openSeeded(): Promise<CloseFixture> {
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
export async function closeOn(fx: CloseFixture, endEntryId: string): Promise<ClosedChapter> {
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
export async function openClosed(): Promise<ClosedChapter> {
  const fx = await openSeeded()
  return closeOn(fx, fx.replyIds[END_REPLY])
}

/** Lands `actions` as one group under the close's action, anchored on E, as a close's tool does. */
export async function writeUnderClose(
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
export async function writeLater(
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

export const loreCreate = (branchId: string, id: string, title: string): PipelineAction => ({
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

export const describeTobin = (
  branchId: string,
  description: string,
  source: DeltaSource,
): PipelineAction => ({
  kind: 'updateEntity',
  source,
  payload: { branchId, id: TOBIN.id, patch: { description } },
})

/** The close's tool work: a lore create, Tobin's description, and the seal thread merged in. */
export async function writeCloseWork(c: ClosedChapter): Promise<void> {
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

export const LATER_DESCRIPTION = 'The Harrow ferryman, who charges double after dark.'

export async function entityOf(fx: CloseFixture, id: string): Promise<Entity | undefined> {
  const [row] = await fx.ctx.db
    .select()
    .from(entities)
    .where(and(eq(entities.branchId, fx.branchId), eq(entities.id, id)))
  return row
}

/** An update of an awareness row's retrieval count alone: the shape a close's reset logs. */
export const retrievalWrite = (
  branchId: string,
  id: string,
  priorCount: number,
  source: DeltaSource,
): PipelineAction => ({
  kind: 'bumpAwarenessRetrieval',
  source,
  payload: { branchId, id, priorCount },
})

export const editLore = (
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
export async function seedPlaces(fx: CloseFixture): Promise<void> {
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

export const placeUnder = (
  branchId: string,
  id: string,
  parentId: string,
  source: DeltaSource,
): PipelineAction => ({
  kind: 'placeLocation',
  source,
  payload: { branchId, id, placement: { kind: 'under', parentId }, proseEntryId: null },
})
