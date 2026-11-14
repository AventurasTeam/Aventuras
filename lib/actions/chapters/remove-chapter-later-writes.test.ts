import { and, eq } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'

import type { generateStructured } from '@/lib/ai'
import { happeningAwareness, type CharacterState } from '@/lib/db'
import { type CloseFixture } from '@/lib/pipeline/definitions/__tests__/close-fixture'

import { removeChapter } from './remove-chapter'
import { undoLastAction } from '../story-entries/undo'
import type { DeltaSource, PipelineAction } from '../types'
import {
  installChapterDeleteHooks,
  END_REPLY,
  SEEDED_AT,
  CLOSED_AT,
  TOBIN_STATE,
  TOBIN,
  TOBIN_CLOSE_DESCRIPTION,
  CLOSE_LORE_ID,
  type ClosedChapter,
  worldRows,
  entryRows,
  logRows,
  deltasOf,
  seedPassWrite,
  openSeeded,
  closeOn,
  openClosed,
  writeUnderClose,
  writeLater,
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
    writer: 'a pass anchored past the end entry',
    source: 'periodic_classifier',
    anchor: (c) => c.fx.replyIds[END_REPLY + 1],
  },
  {
    writer: 'a turn fold write, null anchor',
    source: 'per_turn_classifier',
    anchor: () => null,
  },
  {
    writer: 'a pass anchored on the end entry',
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
    expect(await deltasOf(c.fx, c.actionId)).toEqual([])
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
    expect(await deltasOf(fx, 'act_turn_bump')).toHaveLength(1)
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
      entryId: fx.replyIds[END_REPLY + 1],
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
    expect(await deltasOf(fx, c.actionId)).toEqual([])
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
    expect(await deltasOf(c.fx, c.actionId)).toEqual([])

    expect(await undoLastAction(c.fx.branchId, c.fx.ctx)).toEqual({ status: 'ok' })

    expect((await entityOf(c.fx, TOBIN.id))?.description).toBe(TOBIN_CLOSE_DESCRIPTION)
    expect((await entryRows(c.fx)).map((e) => e.id)).not.toContain('entry_later_action')
  })

  // A normalized record a later write touched yields whole: restored key by key, a merged-away key
  // would come back beside the later record and double-count.
  it('keeps a later write of a record the close normalized, whole', async () => {
    const fx = await openSeeded()
    const stackables = (counts: Record<string, number>, source: DeltaSource): PipelineAction => ({
      kind: 'updateEntityStackables',
      source,
      payload: { branchId: fx.branchId, id: TOBIN.id, stackables: counts },
    })
    await seedPassWrite(fx, stackables({ gold: 5, 'gold coins': 2 }, 'periodic_classifier'))
    const c = await closeOn(fx, fx.replyIds[END_REPLY])
    await writeUnderClose(c, [stackables({ gold: 7 }, 'chapter_close')])
    await writeLater(fx, stackables({ gold: 9 }, 'periodic_classifier'), {
      actionId: 'act_pass_later',
      entryId: fx.replyIds[END_REPLY + 1],
    })

    expect(await removeChapter(fx.branchId, c.chapter.id, 'whole', fx.ctx)).toEqual({
      status: 'ok',
    })

    expect(((await entityOf(fx, TOBIN.id))?.state as CharacterState).stackables).toEqual({
      gold: 9,
    })
  })
})
