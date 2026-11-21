import { and, eq, isNull, lt, ne, sql } from 'drizzle-orm'
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest'

import type { generateStructured, generateToolStep } from '@/lib/ai'
import {
  chapters,
  deltas,
  lore,
  STORY_SETTINGS_DEFAULTS,
  storyEntries,
  type StorySettings,
} from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import {
  branchLog,
  closedChapterId,
  deltasOf,
  installCloseHarnessHooks,
  openHarness,
  STAND_IN_STEP,
  TOBIN,
  type CloseCase,
  type CloseHarness,
  type CloseMocks,
  type ScriptedStep,
} from '@/lib/pipeline/__tests__/close-harness'
import { standInSlots } from '@/lib/pipeline/__tests__/close-stand-in'
import { writeTurnEntry } from '@/lib/pipeline/definitions/__tests__/close-fixture'
import { loreTask } from '@/lib/pipeline/definitions/close-agent/lore'
import { generationStore, type OpenStory } from '@/lib/stores'

import { getChapterDeletePreview } from './chapter-delete-preview'
import { CLOSE_RERUN_REFUSAL, getCloseRerunPreview, type CloseRerunPreview } from './close-rerun'
import { applyDeltaAction } from '../delta/apply-delta-action'
import { holdBranchWriteExclusive, releaseBranchWriteExclusive } from '../delta/branch-write-lock'
import { ReversalIntegrityError } from '../delta/reverse-replay'
import type { selectReversalSet } from '../delta/row-closure'
import { shownCounts } from '../story-entries/__tests__/shown-counts'
import type { PipelineAction } from '../types'

const { generateStructuredMock, generateToolStepMock } = vi.hoisted(() => ({
  generateStructuredMock: vi.fn<typeof generateStructured>(),
  generateToolStepMock: vi.fn<typeof generateToolStep>(),
}))

vi.mock('@/lib/ai', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  generateStructured: generateStructuredMock,
  generateToolStep: generateToolStepMock,
}))

// A one-shot hook before the next selection; a rejection refuses it.
const reversalSeams = vi.hoisted(() => ({
  beforeSelection: null as (() => Promise<void>) | null,
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

const MOCKS: CloseMocks = {
  generateStructured: generateStructuredMock,
  generateToolStep: generateToolStepMock,
}

installCloseHarnessHooks(MOCKS)

afterEach(() => {
  reversalSeams.beforeSelection = null
})

// The close writes the Harrow ferry lore row and Tobin's description (close-stand-in.ts).
const STAND_IN: CloseCase = { slots: standInSlots, steps: [STAND_IN_STEP], merge: false }

function story(settings: Partial<StorySettings> = {}): Pick<OpenStory, 'settings'> {
  return { settings: { ...STORY_SETTINGS_DEFAULTS, ...settings } }
}

async function closedStandIn(): Promise<{ h: CloseHarness; chapterId: string }> {
  const h = await openHarness(STAND_IN, MOCKS)
  await h.close()
  return { h, chapterId: closedChapterId(h) }
}

const preview = (h: CloseHarness, chapterId: string, settings?: Partial<StorySettings>) =>
  getCloseRerunPreview(h.fx.branchId, chapterId, story(settings), h.fx.ctx)

// A turn since the close, its entries created through the action layer under one action.
async function turnSince(h: CloseHarness, at: number): Promise<string> {
  const actionId = `act_since_${at}`
  await writeTurnEntry(h.fx, actionId, {
    id: `entry_since_${at}`,
    position: at,
    kind: 'user_action',
    content: 'I ask Tobin to wait for me at the landing.',
  })
  await writeTurnEntry(h.fx, actionId, {
    id: `entry_since_${at + 1}`,
    position: at + 1,
    kind: 'ai_reply',
    content: 'Tobin grunts, which may mean yes, and settles back onto his barrel.',
  })
  return `entry_since_${at + 1}`
}

// A system entry with a create logged above the log's head, as the dataset seed logs one.
async function systemEntry(h: CloseHarness, position: number): Promise<void> {
  const { db } = h.fx.ctx
  await db.insert(storyEntries).values({
    id: `entry_system_${position}`,
    branchId: h.fx.branchId,
    position,
    kind: 'system',
    content: 'The reply failed. Retry?',
    createdAt: position,
  })
  const [head] = await db
    .select({ top: sql<number>`MAX(${deltas.logPosition})` })
    .from(deltas)
    .where(eq(deltas.branchId, h.fx.branchId))
  await db.insert(deltas).values({
    id: `delta_system_${position}`,
    branchId: h.fx.branchId,
    entryId: null,
    actionId: `act_system_${position}`,
    logPosition: head.top + 1,
    source: 'ai_classifier',
    targetTable: 'story_entries',
    targetId: `entry_system_${position}`,
    op: 'create',
    undoPayload: null,
    createdAt: position,
  })
}

// The stand-in close's one lore row.
async function closeLoreId(h: CloseHarness): Promise<string> {
  const rows = await h.fx.ctx.db
    .select({ id: lore.id })
    .from(lore)
    .where(eq(lore.branchId, h.fx.branchId))
  expect(rows).toHaveLength(1)
  return rows[0]!.id
}

// A write of the turn since at 14, on its action and anchored on its reply.
async function sinceWrite(h: CloseHarness, reply: string, action: PipelineAction): Promise<void> {
  const written = await applyDeltaAction(
    { action, actionId: 'act_since_14', branchId: h.fx.branchId, entryId: reply },
    h.fx.ctx,
  )
  expect(written.status).toBe('ok')
}

// The open region's tokens below `position`, from the counts the fixture stored.
async function regionTokens(h: CloseHarness, below: number): Promise<number> {
  const [row] = await h.fx.ctx.db
    .select({ tokens: sql<number>`COALESCE(SUM(${storyEntries.contentTokens}), 0)` })
    .from(storyEntries)
    .where(
      and(
        eq(storyEntries.branchId, h.fx.branchId),
        isNull(storyEntries.chapterId),
        ne(storyEntries.kind, 'system'),
        lt(storyEntries.position, below),
      ),
    )
  return row?.tokens ?? 0
}

describe('getCloseRerunPreview', () => {
  it('reads the confirm for a close no turn has followed', async () => {
    const { h, chapterId } = await closedStandIn()
    const [chapter] = await h.fx.ctx.db
      .select()
      .from(chapters)
      .where(eq(chapters.branchId, h.fx.branchId))

    expect(await preview(h, chapterId)).toEqual({
      chapterNumber: 1,
      model: 'lore-model',
      // What the parts read: the close stored the same sum as the chapter's token count.
      tokens: chapter.tokenCount,
      // The stand-in's lore row, and its description of Tobin.
      reversal: { createdLore: { count: 1, userEdited: false }, otherChanges: 1 },
      shortcut: null,
    })
  })

  it("names lore-mgmt's model, the story's override first, and none it can't resolve", async () => {
    const { h, chapterId } = await closedStandIn()

    expect(
      await preview(h, chapterId, {
        models: { 'lore-mgmt': { providerId: 'prov_close', modelId: 'override-model' } },
      }),
    ).toMatchObject({ model: 'override-model' })
    expect(
      await preview(h, chapterId, {
        models: { 'lore-mgmt': { providerId: 'prov_gone', modelId: 'override-model' } },
      }),
    ).toMatchObject({ model: null })
  })

  it("takes a reply regenerated since back to its player's action, counting as the rollback confirm does", async () => {
    const { h, chapterId } = await closedStandIn()
    const b = h.fx.branchId
    // A regenerate of the last reply: its sweep, then a new take at its position, its own action.
    await h.rollBack(h.fx.replyIds[5])
    const regenerated = 'entry_regen_013'
    await writeTurnEntry(h.fx, 'act_regen_13', {
      id: regenerated,
      position: 13,
      kind: 'ai_reply',
      content: 'Tobin pushes off again without a word, and the far bank comes up out of the rain.',
    })
    // The new take's classifier names Tobin, whose description the close wrote.
    const named = await applyDeltaAction(
      {
        action: {
          kind: 'updateEntity',
          source: 'per_turn_classifier',
          payload: { branchId: b, id: TOBIN.id, patch: { keywords: ['the ferryman'] } },
        },
        actionId: 'act_regen_13',
        branchId: b,
        entryId: regenerated,
      },
      h.fx.ctx,
    )
    expect(named.status).toBe('ok')
    const action = h.fx.entries.find((entry) => entry.position === 12)!.id

    const read = await preview(h, chapterId)

    expect(read).toEqual({
      chapterNumber: 1,
      model: 'lore-model',
      tokens: expect.any(Number),
      // The close's description of Tobin is the re-run's alone; the shortcut takes the keywords.
      reversal: { createdLore: { count: 1, userEdited: false }, otherChanges: 1 },
      shortcut: {
        targetEntryId: action,
        turns: 1,
        entries: { count: 2, first: 12, last: 13 },
        counts: {
          entries: 2,
          chapters: 0,
          worldStateChanges: 1,
          closeWrites: 0,
          reopenedChapter: null,
          removedChapters: [],
        },
      },
    })
    expect((read as CloseRerunPreview).shortcut?.counts).toEqual(
      await shownCounts(b, action, h.fx.ctx),
    )
    await h.rollBack(action)
    expect(await getChapterDeletePreview(b, chapterId, story(), h.fx.ctx)).toMatchObject({
      createdLore: { count: 1, userEdited: false },
      otherChanges: 1,
    })
  })

  it('reads a system entry since the close as no turn', async () => {
    const { h, chapterId } = await closedStandIn()
    await systemEntry(h, 14)

    expect(await preview(h, chapterId)).toMatchObject({ shortcut: null })
  })

  it("leaves a system entry out of the shortcut's replies and range", async () => {
    const { h, chapterId } = await closedStandIn()
    await turnSince(h, 14)
    await systemEntry(h, 16)

    expect(await preview(h, chapterId)).toMatchObject({
      shortcut: {
        targetEntryId: 'entry_since_14',
        turns: 1,
        entries: { count: 2, first: 14, last: 15 },
      },
    })
  })

  it('refuses close-owed for a pending pick the shortcut leaves, not one it removes', async () => {
    const { h, chapterId } = await closedStandIn()
    const b = h.fx.branchId
    generationStore.setPendingClose(b, { endEntryId: h.fx.replyIds[4] })
    expect(await preview(h, chapterId)).toMatchObject({
      status: 'rejected',
      code: CLOSE_RERUN_REFUSAL.closeOwed,
    })

    const reply = await turnSince(h, 14)
    expect(await preview(h, chapterId)).toMatchObject({
      status: 'rejected',
      code: CLOSE_RERUN_REFUSAL.closeOwed,
    })

    generationStore.setPendingClose(b, { endEntryId: reply })
    expect(await preview(h, chapterId)).toMatchObject({
      shortcut: { targetEntryId: 'entry_since_14' },
    })
  })

  it('refuses close-owed with auto-close on when the region the shortcut leaves is at the threshold', async () => {
    const { h, chapterId } = await closedStandIn()
    await turnSince(h, 14)
    const left = await regionTokens(h, 14)
    // The whole region, the turn since included, would be past either threshold below.
    expect(await regionTokens(h, 16)).toBeGreaterThan(left + 1)

    expect(
      await preview(h, chapterId, { chapterAutoClose: true, chapterTokenThreshold: left }),
    ).toMatchObject({ status: 'rejected', code: CLOSE_RERUN_REFUSAL.closeOwed })
    expect(
      await preview(h, chapterId, { chapterAutoClose: true, chapterTokenThreshold: left + 1 }),
    ).toMatchObject({ shortcut: { targetEntryId: 'entry_since_14' } })
    expect(
      await preview(h, chapterId, { chapterAutoClose: false, chapterTokenThreshold: left }),
    ).toMatchObject({ shortcut: { targetEntryId: 'entry_since_14' } })
  })

  it('refuses as the delete preview does, writing nothing', async () => {
    const { h, chapterId } = await closedStandIn()
    const b = h.fx.branchId
    // A chapter row no close wrote, after the closed one.
    await h.fx.ctx.db.insert(chapters).values({
      id: 'chap_by_hand',
      branchId: b,
      sequenceNumber: 2,
      title: 'By hand',
      summary: 'Written with no close.',
      theme: 'None',
      startEntryId: h.fx.entries[7]!.id,
      endEntryId: h.fx.replyIds[4]!,
      tokenCount: 1,
      closedAt: 1,
      createdAt: 1,
      updatedAt: 1,
    })
    const log = await branchLog(h.fx)

    expect(await getCloseRerunPreview(b, 'chap_gone', story(), h.fx.ctx)).toMatchObject({
      status: 'rejected',
      code: CLOSE_RERUN_REFUSAL.notFound,
    })
    expect(await preview(h, chapterId)).toMatchObject({
      status: 'rejected',
      code: CLOSE_RERUN_REFUSAL.notLatest,
    })
    expect(await preview(h, 'chap_by_hand')).toMatchObject({
      status: 'rejected',
      code: CLOSE_RERUN_REFUSAL.noClose,
    })
    expect(await branchLog(h.fx)).toEqual(log)
  })

  it('refuses integrity when the closure refuses, and logs it', async () => {
    const { h, chapterId } = await closedStandIn()
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {})
    reversalSeams.beforeSelection = () =>
      Promise.reject(
        new ReversalIntegrityError('no-create', `lore:${h.fx.branchId}:lore_gone`, h.actionId()),
      )

    expect(await preview(h, chapterId)).toMatchObject({
      status: 'rejected',
      code: CLOSE_RERUN_REFUSAL.integrity,
    })
    expect(error).toHaveBeenCalledWith(
      'action_layer.reversal_refused',
      expect.objectContaining({ branchId: h.fx.branchId, refusal: 'no-create' }),
    )
  })

  it("refuses integrity when the shortcut's sweep refuses", async () => {
    const { h, chapterId } = await closedStandIn()
    await turnSince(h, 14)
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {})
    // The re-run's set selects first; the sweep's selection after it refuses.
    reversalSeams.beforeSelection = async () => {
      reversalSeams.beforeSelection = () =>
        Promise.reject(
          new ReversalIntegrityError(
            'no-create',
            `lore:${h.fx.branchId}:lore_gone`,
            'act_since_14',
          ),
        )
    }

    expect(await preview(h, chapterId)).toMatchObject({
      status: 'rejected',
      code: CLOSE_RERUN_REFUSAL.integrity,
    })
    expect(error).toHaveBeenCalledWith(
      'action_layer.reversal_refused',
      expect.objectContaining({ branchId: h.fx.branchId, refusal: 'no-create' }),
    )
  })

  it('counts a lore row the close created and a turn since edited as the re-run removing it', async () => {
    const { h, chapterId } = await closedStandIn()
    const b = h.fx.branchId
    const reply = await turnSince(h, 14)
    const created = await closeLoreId(h)
    await sinceWrite(h, reply, {
      kind: 'updateLore',
      source: 'per_turn_classifier',
      payload: {
        branchId: b,
        id: created,
        patch: { keywords: ['night crossing'] },
        proseEntryId: null,
      },
    })

    expect(await preview(h, chapterId)).toMatchObject({
      // The shortcut takes back the turn's keywords; the re-run still removes the row.
      reversal: { createdLore: { count: 1, userEdited: false }, otherChanges: 1 },
      shortcut: { targetEntryId: 'entry_since_14', counts: { entries: 2, worldStateChanges: 1 } },
    })
    await h.rollBack('entry_since_14')
    expect(await getChapterDeletePreview(b, chapterId, story(), h.fx.ctx)).toMatchObject({
      createdLore: { count: 1, userEdited: false },
      otherChanges: 1,
    })
  })

  it("counts a turn's write both the re-run and the shortcut reverse once, on the shortcut", async () => {
    const { h, chapterId } = await closedStandIn()
    const b = h.fx.branchId
    const reply = await turnSince(h, 14)
    // A translation names the close's lore row, so the re-run's closure takes the turn's create too.
    await sinceWrite(h, reply, {
      kind: 'createTranslation',
      source: 'per_turn_classifier',
      payload: {
        entry: {
          id: 'tr_since_14',
          branchId: b,
          targetKind: 'lore',
          targetId: await closeLoreId(h),
          field: 'title',
          language: 'es',
          translatedText: 'El transbordador de Harrow',
          createdAt: 14,
          updatedAt: 14,
        },
      },
    })

    expect(await preview(h, chapterId)).toMatchObject({
      reversal: { createdLore: { count: 1, userEdited: false }, otherChanges: 1 },
      shortcut: { targetEntryId: 'entry_since_14', counts: { entries: 2, worldStateChanges: 1 } },
    })
    await h.rollBack('entry_since_14')
    expect(await getChapterDeletePreview(b, chapterId, story(), h.fx.ctx)).toMatchObject({
      createdLore: { count: 1, userEdited: false },
      otherChanges: 1,
    })
  })

  it("counts a close's field a turn since rewrote as the re-run restoring it", async () => {
    const { h, chapterId } = await closedStandIn()
    const b = h.fx.branchId
    const reply = await turnSince(h, 14)
    // The shortcut takes this back first, so the re-run's undo of the close's description lands.
    await sinceWrite(h, reply, {
      kind: 'updateEntity',
      source: 'per_turn_classifier',
      payload: {
        branchId: b,
        id: TOBIN.id,
        patch: { description: 'A ferryman who has stopped asking where anyone is going.' },
      },
    })

    expect(await preview(h, chapterId)).toMatchObject({
      reversal: { createdLore: { count: 1, userEdited: false }, otherChanges: 1 },
      shortcut: { targetEntryId: 'entry_since_14', counts: { entries: 2, worldStateChanges: 1 } },
    })
    await h.rollBack('entry_since_14')
    expect(await getChapterDeletePreview(b, chapterId, story(), h.fx.ctx)).toMatchObject({
      createdLore: { count: 1, userEdited: false },
      otherChanges: 1,
    })
  })

  it('counts a lore row the close created and a delete since took, which the shortcut restores', async () => {
    const { h, chapterId } = await closedStandIn()
    const b = h.fx.branchId
    const reply = await turnSince(h, 14)
    await sinceWrite(h, reply, {
      kind: 'deleteLore',
      source: 'user_edit',
      payload: { branchId: b, id: await closeLoreId(h) },
    })
    const live = await h.fx.ctx.db.select({ id: lore.id }).from(lore).where(eq(lore.branchId, b))
    expect(live).toEqual([])

    expect(await preview(h, chapterId)).toMatchObject({
      reversal: { createdLore: { count: 1, userEdited: false }, otherChanges: 1 },
      shortcut: { targetEntryId: 'entry_since_14', counts: { entries: 2 } },
    })
    await h.rollBack('entry_since_14')
    expect(await getChapterDeletePreview(b, chapterId, story(), h.fx.ctx)).toMatchObject({
      createdLore: { count: 1, userEdited: false },
      otherChanges: 1,
    })
  })

  it("leaves a user's edit of the close's lore row that the shortcut takes back out of userEdited", async () => {
    const { h, chapterId } = await closedStandIn()
    const b = h.fx.branchId
    const reply = await turnSince(h, 14)
    await sinceWrite(h, reply, {
      kind: 'updateLore',
      source: 'user_edit',
      payload: {
        branchId: b,
        id: await closeLoreId(h),
        patch: { keywords: ['night crossing'] },
        proseEntryId: null,
      },
    })
    // The edit stands outside the shortcut: the delete reads it as the user's.
    expect(await getChapterDeletePreview(b, chapterId, story(), h.fx.ctx)).toMatchObject({
      createdLore: { count: 1, userEdited: true },
    })

    expect(await preview(h, chapterId)).toMatchObject({
      reversal: { createdLore: { count: 1, userEdited: false }, otherChanges: 1 },
    })
    await h.rollBack('entry_since_14')
    expect(await getChapterDeletePreview(b, chapterId, story(), h.fx.ctx)).toMatchObject({
      createdLore: { count: 1, userEdited: false },
      otherChanges: 1,
    })
  })

  it('reads under the shared lock, so an exclusive hold waits for its last read', async () => {
    const { h, chapterId } = await closedStandIn()
    await turnSince(h, 14)
    let reversal: Promise<void> | undefined
    let granted = false
    let readsAfterGrant = 0
    const watched = new Proxy(h.fx.ctx.db, {
      get(target, prop, receiver) {
        if (prop === 'select') {
          // The exclusive hold a prose reversal's bracket takes, asked for once the preview reads.
          reversal ??= holdBranchWriteExclusive(h.fx.branchId, 'act_reversal_probe').then(() => {
            granted = true
          })
          if (granted) readsAfterGrant++
        }
        return Reflect.get(target, prop, receiver) as unknown
      },
    })

    const read = await getCloseRerunPreview(h.fx.branchId, chapterId, story(), {
      ...h.fx.ctx,
      db: watched,
    })

    expect(read).toMatchObject({ chapterNumber: 1, shortcut: { targetEntryId: 'entry_since_14' } })
    expect(reversal).toBeDefined()
    expect(readsAfterGrant).toBe(0)
    await reversal
    expect(granted).toBe(true)
    releaseBranchWriteExclusive(h.fx.branchId, 'act_reversal_probe')
  })

  it('types its refusal without in-flight, which only a start returns', () => {
    type RefusedCode<T> = Extract<T, { status: 'rejected'; code: string }>['code']
    expectTypeOf<RefusedCode<Awaited<ReturnType<typeof getCloseRerunPreview>>>>().toEqualTypeOf<
      'not-found' | 'not-latest' | 'no-close' | 'integrity' | 'close-owed'
    >()
  })
})

const CREATE_TWO_LORE: ScriptedStep = {
  calls: [
    {
      toolName: 'create_lore',
      input: {
        title: 'The night ferry',
        body: 'The Harrow ferry crosses at night only when old Tobin chooses, for a price a courier pays.',
        keywords: ['night ferry'],
        turns: ['t5'],
        why: 'The innkeeper says the ferry runs at night when Tobin says it runs.',
      },
    },
    {
      toolName: 'create_lore',
      input: {
        title: 'The Syndicate toll',
        body: 'The Syndicate taxes the ferry, the road and the bread, and reads every letter it can.',
        keywords: ['syndicate toll'],
        turns: ['t7'],
        why: 'The far bank belongs to the Syndicate, which taxes every crossing.',
      },
    },
  ],
}

const TWO_LORE: CloseCase = {
  slots: () => ({ before: [], perPart: [{ kind: 'task', def: loreTask }], after: [] }),
  steps: [CREATE_TWO_LORE],
  merge: false,
}

describe('the previews after a re-run (AC 21)', () => {
  it("count the re-run's two lore creates, in a delete's preview and a second re-run's", async () => {
    const h = await openHarness(TWO_LORE, MOCKS)
    await h.close()
    const chapterId = closedChapterId(h)
    const end = await h.rerun(chapterId)
    expect(end.result.outcome).toBe('completed')
    // Every live lore row is one the re-run created: the close's went with its reversal.
    const rerunCreates = (await deltasOf(h.fx, h.rerunActionId()!))
      .filter((d) => d.targetTable === 'lore' && d.op === 'create')
      .map((d) => d.targetId)
      .sort()
    const live = (
      await h.fx.ctx.db.select({ id: lore.id }).from(lore).where(eq(lore.branchId, h.fx.branchId))
    )
      .map((row) => row.id)
      .sort()
    expect(live).toHaveLength(2)
    expect(live).toEqual(rerunCreates)

    expect(
      await getChapterDeletePreview(h.fx.branchId, chapterId, story(), h.fx.ctx),
    ).toMatchObject({ createdLore: { count: 2, userEdited: false } })
    expect(await preview(h, chapterId)).toMatchObject({
      reversal: { createdLore: { count: 2, userEdited: false } },
    })
  })
})
