import { and, eq } from 'drizzle-orm'
import { describe, expect, expectTypeOf, it, vi } from 'vitest'

import type { generateStructured } from '@/lib/ai'
import {
  branches,
  chapters,
  entities,
  happeningAwareness,
  happenings,
  lore,
  STORY_SETTINGS_DEFAULTS,
  storyEntries,
  type CharacterState,
  type StorySettings,
} from '@/lib/db'
import {
  openCloseFixture,
  type CloseFixture,
} from '@/lib/pipeline/definitions/__tests__/close-fixture'
import { generationStore } from '@/lib/stores'

import { getChapterDeletePreview } from './chapter-delete-preview'
import { CHAPTER_DELETE_REFUSAL, resolveChapterDeleteSet } from './chapter-delete-set'
import { removeChapter } from './remove-chapter'
import { applyDeltaAction, applyDeltaActionGroupWithOutcomes } from '../delta/apply-delta-action'
import { holdBranchWriteExclusive, releaseBranchWriteExclusive } from '../delta/branch-write-lock'
import { registerStoreOnlyRun } from '../turns/__tests__/stand-in-pass'
import type { DeltaSource, PipelineAction } from '../types'
import {
  installChapterDeleteHooks,
  END_REPLY,
  CLOSED_AT,
  TOBIN_STATE,
  TOBIN,
  THREAD_KEPT,
  THREAD_ABSORBED,
  CLOSE_LORE_ID,
  worldRows,
  chapterRows,
  logRows,
  seedPassWrite,
  openSeeded,
  closeOn,
  openClosed,
  writeUnderClose,
  writeLater,
  loreCreate,
  describeTobin,
  writeCloseWork,
  LATER_DESCRIPTION,
  entityOf,
  retrievalWrite,
  editLore,
  seedPlaces,
  placeUnder,
} from './__tests__/chapter-delete-fixture'

const { generateStructuredMock } = vi.hoisted(() => ({
  generateStructuredMock: vi.fn<typeof generateStructured>(),
}))

vi.mock('@/lib/ai', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  generateStructured: generateStructuredMock,
}))

installChapterDeleteHooks(generateStructuredMock)

describe('getChapterDeletePreview', () => {
  const PREVIEW_TOBIN = 'char_tobin_preview'
  const PREVIEW_CROSSING = 'hap_crossing_preview'
  const PREVIEW_TOBIN_KNOWS = 'haw_tobin_crossing_preview'
  const PREVIEW_TOLL = 'lore_toll_preview'
  const PREVIEW_FERRY = 'lore_ferry_preview'
  const TOLL_ID = 'lore_harrow_toll'
  const LANDED = { status: 'landed' }

  function previewStory(fx: CloseFixture, settings: Partial<StorySettings> = {}) {
    return { branchId: fx.branchId, settings: { ...STORY_SETTINGS_DEFAULTS, ...settings } }
  }

  it('counts what a whole delete takes, by the lines the confirm shows', async () => {
    const fx = await openCloseFixture()
    // Rows the close's writes need, written before the log as the opening is.
    await fx.ctx.db.insert(entities).values({
      id: PREVIEW_TOBIN,
      branchId: fx.branchId,
      kind: 'character',
      name: 'Tobin',
      description: 'The ferryman at Harrow.',
      status: 'active',
      injectionMode: 'auto',
      createdAt: 1,
      updatedAt: 1,
    })
    await fx.ctx.db.insert(happenings).values({
      id: PREVIEW_CROSSING,
      branchId: fx.branchId,
      title: 'The night crossing',
      createdAt: 1,
      updatedAt: 1,
    })
    await fx.ctx.db.insert(happeningAwareness).values({
      id: PREVIEW_TOBIN_KNOWS,
      branchId: fx.branchId,
      happeningId: PREVIEW_CROSSING,
      characterId: PREVIEW_TOBIN,
      learnedAtEntryId: null,
      decayResistance: null,
      retrievalCount: 4,
      source: null,
    })
    const { chapter, actionId } = await closeOn(fx, fx.replyIds[END_REPLY])
    const asClose = { actionId, branchId: fx.branchId, entryId: chapter.endEntryId }
    expect(
      await applyDeltaActionGroupWithOutcomes(
        [
          {
            kind: 'createLore',
            source: 'chapter_close',
            payload: {
              entry: {
                id: PREVIEW_TOLL,
                branchId: fx.branchId,
                title: 'The toll',
                injectionMode: 'auto',
                createdAt: 2,
                updatedAt: 2,
              },
            },
          },
          {
            kind: 'createLore',
            source: 'chapter_close',
            payload: {
              entry: {
                id: PREVIEW_FERRY,
                branchId: fx.branchId,
                title: 'The night ferry',
                injectionMode: 'auto',
                createdAt: 2,
                updatedAt: 2,
              },
            },
          },
          {
            kind: 'updateEntity',
            source: 'chapter_close',
            payload: {
              branchId: fx.branchId,
              id: PREVIEW_TOBIN,
              patch: { description: 'Poles faster when a light shows on the far bank.' },
            },
          },
          // Only retrieval_count moves: the shape of the close's reset.
          retrievalWrite(fx.branchId, PREVIEW_TOBIN_KNOWS, 4, 'chapter_close'),
        ],
        asClose,
        fx.ctx,
      ),
    ).toEqual({ status: 'ok', outcomes: [LANDED, LANDED, LANDED, LANDED] })
    const closeUpdate = await applyDeltaAction(
      {
        action: {
          kind: 'updateLore',
          source: 'chapter_close',
          payload: {
            branchId: fx.branchId,
            id: PREVIEW_TOLL,
            patch: { body: 'Paid at the far bank, in silver.' },
            proseEntryId: chapter.endEntryId,
          },
        },
        ...asClose,
      },
      fx.ctx,
    )
    expect(closeUpdate.status).toBe('ok')
    const userEdit = await applyDeltaAction(
      {
        action: {
          kind: 'updateLore',
          source: 'user_edit',
          payload: {
            branchId: fx.branchId,
            id: PREVIEW_TOLL,
            patch: { title: 'The Syndicate toll' },
            proseEntryId: null,
          },
        },
        actionId: 'act_user_toll',
        branchId: fx.branchId,
        entryId: null,
      },
      fx.ctx,
    )
    expect(userEdit.status).toBe('ok')
    // The close consumed its pick, so `after` reads the threshold alone.
    expect(generationStore.getTxState().pendingClose.has(fx.branchId)).toBe(false)

    expect(
      await getChapterDeletePreview(fx.branchId, chapter.id, previewStory(fx), fx.ctx),
    ).toEqual({
      chapterNumber: 1,
      // The toll and the ferry; the user's later edit of the toll is in the set.
      createdLore: { count: 2, userEdited: true },
      // Tobin's description alone: the stamps, the chapter row and its report, every write to
      // the two lore rows and the retrieval-count update are left out.
      otherChanges: 1,
      // The three replies past the end; their three actions don't count.
      turnsSince: 3,
      after: 'waits',
    })
  })

  it('reports created lore the user left alone as not edited', async () => {
    const c = await openClosed()
    await writeCloseWork(c)

    expect(
      await getChapterDeletePreview(c.fx.branchId, c.chapter.id, previewStory(c.fx), c.fx.ctx),
    ).toMatchObject({ createdLore: { count: 1, userEdited: false } })
  })

  // The user edits the toll, then deletes it: the delete removes only the ferry, which they left
  // alone, and a write to the gone toll changes nothing. A fork's toll, under the same id, isn't
  // this branch's.
  it('counts only created lore still live on the branch, and only edits of it', async () => {
    const c = await openClosed()
    const { branchId } = c.fx
    await writeUnderClose(c, [
      loreCreate(branchId, CLOSE_LORE_ID, 'The Harrow ferry'),
      loreCreate(branchId, TOLL_ID, 'The Harrow toll'),
    ])
    await writeLater(c.fx, editLore(branchId, TOLL_ID, 'Doubled after dark.', 'user_edit'), {
      actionId: 'act_user_toll',
      entryId: null,
    })
    await writeLater(
      c.fx,
      { kind: 'deleteLore', source: 'user_edit', payload: { branchId, id: TOLL_ID } },
      { actionId: 'act_user_toll_delete', entryId: null },
    )
    await c.fx.ctx.db.insert(branches).values({
      id: 'branch_fork',
      storyId: c.fx.storyId,
      parentBranchId: branchId,
      name: 'Fork',
      createdAt: CLOSED_AT,
    })
    await c.fx.ctx.db.insert(lore).values({
      id: TOLL_ID,
      branchId: 'branch_fork',
      title: 'The Harrow toll',
      injectionMode: 'auto',
      createdAt: CLOSED_AT,
      updatedAt: CLOSED_AT,
    })
    expect((await worldRows(c.fx)).lore.map((row) => row.id)).toEqual([CLOSE_LORE_ID])

    expect(
      await getChapterDeletePreview(branchId, c.chapter.id, previewStory(c.fx), c.fx.ctx),
    ).toMatchObject({ createdLore: { count: 1, userEdited: false }, otherChanges: 0 })

    expect(await removeChapter(branchId, c.chapter.id, 'whole', c.fx.ctx)).toEqual({
      status: 'ok',
    })
    expect((await worldRows(c.fx)).lore).toEqual([])
  })

  // The close creates a place; the user later moves the pier under it. The move stands, so the
  // pier's parent ref is cleared: one change for the place's create, one for the clear.
  it('counts a reference the delete clears among the other changes', async () => {
    const fx = await openSeeded()
    await seedPlaces(fx)
    const c = await closeOn(fx, fx.replyIds[END_REPLY])
    await writeUnderClose(c, [
      {
        kind: 'createEntity',
        source: 'chapter_close',
        payload: {
          entry: {
            id: 'loc_ford',
            branchId: fx.branchId,
            kind: 'location',
            name: 'The Ford',
            status: 'active',
            injectionMode: 'auto',
            state: { parent_location_id: null },
            createdAt: CLOSED_AT,
            updatedAt: CLOSED_AT,
          },
        },
      },
    ])
    await writeLater(fx, placeUnder(fx.branchId, 'loc_pier', 'loc_ford', 'user_edit'), {
      actionId: 'act_user_pier',
      entryId: null,
    })
    const resolved = await resolveChapterDeleteSet(fx.branchId, c.chapter.id, 'whole', fx.ctx)
    if ('status' in resolved) throw new Error(`refused: ${resolved.reason}`)
    expect(resolved.set.refClears).toHaveLength(1)

    expect(
      await getChapterDeletePreview(fx.branchId, c.chapter.id, previewStory(fx), fx.ctx),
    ).toMatchObject({ createdLore: { count: 0, userEdited: false }, otherChanges: 2 })
  })

  // A pass's later edit of created lore isn't the user's, and the user's edit of a created place
  // isn't an edit of lore: the place's create and that edit are the 2.
  it("counts only a user's edit of created lore as an edit, and every other write as a change", async () => {
    const fx = await openSeeded()
    await seedPlaces(fx)
    const c = await closeOn(fx, fx.replyIds[END_REPLY])
    await writeUnderClose(c, [
      loreCreate(fx.branchId, CLOSE_LORE_ID, 'The Harrow ferry'),
      {
        kind: 'createEntity',
        source: 'chapter_close',
        payload: {
          entry: {
            id: 'loc_ford',
            branchId: fx.branchId,
            kind: 'location',
            name: 'The Ford',
            status: 'active',
            injectionMode: 'auto',
            state: { parent_location_id: null },
            createdAt: CLOSED_AT,
            updatedAt: CLOSED_AT,
          },
        },
      },
    ])
    await writeLater(fx, editLore(fx.branchId, CLOSE_LORE_ID, 'later', 'periodic_classifier'), {
      actionId: 'act_pass_lore',
      entryId: fx.replyIds[END_REPLY + 1],
    })
    await writeLater(
      fx,
      {
        kind: 'updateEntity',
        source: 'user_edit',
        payload: {
          branchId: fx.branchId,
          id: 'loc_ford',
          patch: { description: 'A shallow ford.' },
        },
      },
      { actionId: 'act_user_ford', entryId: null },
    )

    expect(
      await getChapterDeletePreview(fx.branchId, c.chapter.id, previewStory(fx), fx.ctx),
    ).toMatchObject({ createdLore: { count: 1, userEdited: false }, otherChanges: 2 })
  })

  // The close's three changes: Tobin's description, the kept thread's merge and the absorbed
  // thread's delete. A later write replaces the description, so the delete leaves it standing.
  it('leaves out a close update a later write replaced in every field', async () => {
    const c = await openClosed()
    await writeCloseWork(c)
    const preview = () =>
      getChapterDeletePreview(c.fx.branchId, c.chapter.id, previewStory(c.fx), c.fx.ctx)
    expect(await preview()).toMatchObject({ otherChanges: 3 })
    await writeLater(c.fx, describeTobin(c.fx.branchId, LATER_DESCRIPTION, 'per_turn_classifier'), {
      actionId: 'act_turn_fold',
      entryId: null,
    })

    expect(await preview()).toMatchObject({ otherChanges: 2 })

    expect(await removeChapter(c.fx.branchId, c.chapter.id, 'whole', c.fx.ctx)).toEqual({
      status: 'ok',
    })
    expect((await entityOf(c.fx, TOBIN.id))?.description).toBe(LATER_DESCRIPTION)
    expect((await worldRows(c.fx)).threads.map((t) => [t.id, t.description])).toEqual([
      [THREAD_KEPT.id, THREAD_KEPT.description],
      [THREAD_ABSORBED.id, THREAD_ABSORBED.description],
    ])
  })

  it('counts a close update a later write replaced in part', async () => {
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

    expect(
      await getChapterDeletePreview(c.fx.branchId, c.chapter.id, previewStory(c.fx), c.fx.ctx),
    ).toMatchObject({ otherChanges: 1 })

    expect(await removeChapter(c.fx.branchId, c.chapter.id, 'whole', c.fx.ctx)).toEqual({
      status: 'ok',
    })
    const state = (await entityOf(c.fx, TOBIN.id))?.state as CharacterState
    expect(state.visual).toEqual({ attire: 'a salt-stained oilskin' })
    expect(state.traits).toEqual(['taciturn'])
  })

  // The close normalized the record, so a later write of it yields the whole record, not its keys.
  it('leaves out a close update of a record a later write replaced', async () => {
    const fx = await openSeeded()
    const stackables = (counts: Record<string, number>, source: DeltaSource): PipelineAction => ({
      kind: 'updateEntityStackables',
      source,
      payload: { branchId: fx.branchId, id: TOBIN.id, stackables: counts },
    })
    await seedPassWrite(fx, stackables({ gold: 5, 'gold coins': 2 }, 'periodic_classifier'))
    const c = await closeOn(fx, fx.replyIds[END_REPLY])
    await writeUnderClose(c, [stackables({ gold: 7 }, 'chapter_close')])
    const preview = () =>
      getChapterDeletePreview(fx.branchId, c.chapter.id, previewStory(fx), fx.ctx)
    expect(await preview()).toMatchObject({ otherChanges: 1 })
    await writeLater(fx, stackables({ gold: 9 }, 'periodic_classifier'), {
      actionId: 'act_pass_later',
      entryId: fx.replyIds[END_REPLY + 1],
    })

    expect(await preview()).toMatchObject({ otherChanges: 0 })

    expect(await removeChapter(fx.branchId, c.chapter.id, 'whole', fx.ctx)).toEqual({
      status: 'ok',
    })
    expect(((await entityOf(fx, TOBIN.id))?.state as CharacterState).stackables).toEqual({
      gold: 9,
    })
  })

  it('reads what follows a delete from the region it leaves', async () => {
    const fx = await openCloseFixture()
    const first = await closeOn(fx, fx.replyIds[0])
    const { chapter } = await closeOn(fx, fx.replyIds[END_REPLY])
    // Neither the token snapshot nor a system row stamped with the chapter is an input.
    await fx.ctx.db
      .update(chapters)
      .set({ tokenCount: 0 })
      .where(and(eq(chapters.branchId, fx.branchId), eq(chapters.id, chapter.id)))
    await fx.ctx.db.insert(storyEntries).values({
      id: 'entry_close_system',
      branchId: fx.branchId,
      position: 100,
      kind: 'system',
      content: 'The chapter closed.',
      contentTokens: 5000,
      chapterId: chapter.id,
      createdAt: 1,
    })
    // The earlier chapter stays closed: only the rows past its end rejoin the region.
    const rows = await fx.ctx.db
      .select({
        position: storyEntries.position,
        kind: storyEntries.kind,
        tokens: storyEntries.contentTokens,
      })
      .from(storyEntries)
      .where(eq(storyEntries.branchId, fx.branchId))
    const firstEnd = fx.entries.find((entry) => entry.id === first.chapter.endEntryId)
    if (!firstEnd) throw new Error('no entry ends chapter 1')
    const tokensOf = (keep: (position: number) => boolean) =>
      rows
        .filter((row) => row.kind !== 'system' && keep(row.position))
        .reduce((sum, row) => sum + (row.tokens ?? 0), 0)
    const tokensAfter = tokensOf((position) => position > firstEnd.position)
    expect(tokensOf((position) => position <= firstEnd.position)).toBeGreaterThan(0)
    const preview = (settings: Partial<StorySettings>) =>
      getChapterDeletePreview(fx.branchId, chapter.id, previewStory(fx, settings), fx.ctx)

    expect(await preview({ chapterTokenThreshold: tokensAfter })).toEqual({
      chapterNumber: 2,
      createdLore: { count: 0, userEdited: false },
      otherChanges: 0,
      turnsSince: 3,
      after: 'closes-next-send',
    })
    expect(await preview({ chapterTokenThreshold: tokensAfter + 1 })).toMatchObject({
      after: 'waits',
    })
    expect(
      await preview({ chapterTokenThreshold: tokensAfter, chapterAutoClose: false }),
    ).toMatchObject({ after: 'stays-open' })

    generationStore.setPendingClose(fx.branchId, { endEntryId: fx.replyIds[5] })
    expect(await preview({ chapterTokenThreshold: tokensAfter + 1 })).toMatchObject({
      after: 'closes-next-send',
    })
    expect(
      await preview({ chapterTokenThreshold: tokensAfter + 1, chapterAutoClose: false }),
    ).toMatchObject({ after: 'closes-next-send' })
  })

  it('reads under the shared lock, so a reversal waits for its last read', async () => {
    const fx = await openCloseFixture()
    const { chapter } = await closeOn(fx, fx.replyIds[END_REPLY])
    let reversal: Promise<void> | undefined
    let granted = false
    let readsAfterGrant = 0
    const watched = new Proxy(fx.ctx.db, {
      get(target, prop, receiver) {
        if (prop === 'select') {
          // The exclusive hold a prose reversal's bracket takes, asked for once the preview reads.
          reversal ??= holdBranchWriteExclusive(fx.branchId, 'act_reversal_probe').then(() => {
            granted = true
          })
          if (granted) readsAfterGrant++
        }
        return Reflect.get(target, prop, receiver) as unknown
      },
    })

    const preview = await getChapterDeletePreview(fx.branchId, chapter.id, previewStory(fx), {
      ...fx.ctx,
      db: watched,
    })

    expect(preview).toMatchObject({ chapterNumber: 1, turnsSince: 3 })
    expect(reversal).toBeDefined()
    expect(readsAfterGrant).toBe(0)
    await reversal
    expect(granted).toBe(true)
    releaseBranchWriteExclusive(fx.branchId, 'act_reversal_probe')
  })

  it('refuses as the action does, writing nothing', async () => {
    const fx = await openCloseFixture()
    const first = await closeOn(fx, fx.replyIds[END_REPLY])
    await closeOn(fx, fx.replyIds[4])
    const log = await logRows(fx)
    const rows = await chapterRows(fx)

    const notLatest = await getChapterDeletePreview(
      fx.branchId,
      first.chapter.id,
      previewStory(fx),
      fx.ctx,
    )

    expect(notLatest).toMatchObject({
      status: 'rejected',
      code: CHAPTER_DELETE_REFUSAL.notLatest,
    })
    expect(notLatest).toEqual(await removeChapter(fx.branchId, first.chapter.id, 'whole', fx.ctx))
    expect(
      await getChapterDeletePreview(fx.branchId, 'chap_gone', previewStory(fx), fx.ctx),
    ).toMatchObject({ status: 'rejected', code: CHAPTER_DELETE_REFUSAL.notFound })
    expect(await logRows(fx)).toEqual(log)
    expect(await chapterRows(fx)).toEqual(rows)
  })

  it('types its refusal and the set read without in-flight, which only the action returns', () => {
    type RefusedCode<T> = Extract<T, { status: 'rejected'; code: string }>['code']
    type ReadCode = 'not-found' | 'not-latest' | 'no-close' | 'integrity'

    expectTypeOf<
      RefusedCode<Awaited<ReturnType<typeof getChapterDeletePreview>>>
    >().toEqualTypeOf<ReadCode>()
    expectTypeOf<
      RefusedCode<Awaited<ReturnType<typeof resolveChapterDeleteSet>>>
    >().toEqualTypeOf<ReadCode>()
    expectTypeOf<RefusedCode<Awaited<ReturnType<typeof removeChapter>>>>().toEqualTypeOf<
      ReadCode | 'in-flight'
    >()
  })

  it('refuses a chapter no close made, writing nothing', async () => {
    const fx = await openCloseFixture()
    await fx.ctx.db.insert(chapters).values({
      id: 'chap_by_hand',
      branchId: fx.branchId,
      sequenceNumber: 1,
      title: 'By hand',
      summary: 'Written with no close.',
      theme: 'None',
      startEntryId: fx.entries[0].id,
      endEntryId: fx.replyIds[END_REPLY],
      tokenCount: 1,
      closedAt: 1,
      createdAt: 1,
      updatedAt: 1,
    })
    const log = await logRows(fx)

    const refused = await getChapterDeletePreview(
      fx.branchId,
      'chap_by_hand',
      previewStory(fx),
      fx.ctx,
    )

    expect(refused).toMatchObject({ status: 'rejected', code: CHAPTER_DELETE_REFUSAL.noClose })
    expect(refused).toEqual(await removeChapter(fx.branchId, 'chap_by_hand', 'whole', fx.ctx))
    expect(await logRows(fx)).toEqual(log)
  })

  it('reads while a run holds the gate', async () => {
    const fx = await openCloseFixture()
    const { chapter } = await closeOn(fx, fx.replyIds[END_REPLY])
    registerStoreOnlyRun('turn-stand-in', fx.branchId)
    expect(generationStore.isUserEditBlocked()).toBe(true)

    expect(
      await getChapterDeletePreview(fx.branchId, chapter.id, previewStory(fx), fx.ctx),
    ).toMatchObject({ chapterNumber: 1, turnsSince: 3 })
  })
})
