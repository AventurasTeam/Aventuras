import { eq } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'

import {
  branches,
  deltas,
  emptyEntityState,
  emptyWorkingState,
  entities,
  stories,
  storyEntries,
  wizardSessions,
  type SqlOp,
  type WizardWorkingState,
} from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { navigationStore, storiesStore } from '@/lib/stores'

import { finishWizard } from './finish'

const APP_DEFAULTS = { defaultStorySettings: {}, embeddingModelId: null }
const LEAD_ID = 'char_11111111-1111-1111-1111-111111111111'

type MakeStateInput = {
  mode?: WizardWorkingState['definition']['mode']
  narration?: WizardWorkingState['definition']['narration']
  title?: string
  description?: string
  leadName?: string
  leadEntityId?: string | null
  opening?: Partial<WizardWorkingState['opening']>
}

function makeState(input: MakeStateInput = {}): WizardWorkingState {
  const base = emptyWorkingState()
  return {
    ...base,
    step: 5,
    leadName: input.leadName ?? base.leadName,
    leadEntityId: input.leadEntityId ?? base.leadEntityId,
    definition: {
      ...base.definition,
      mode: input.mode ?? base.definition.mode,
      narration: input.narration ?? base.definition.narration,
      title: input.title ?? base.definition.title,
      description: input.description ?? base.definition.description,
    },
    opening: { ...base.opening, ...input.opening },
  }
}

async function setup() {
  const { db, runInTransaction } = await createTestDb()
  storiesStore.__reset()
  navigationStore.__reset()
  return { db, ctx: { db, runInTransaction } }
}

describe('finishWizard', () => {
  it('creative+third: commits story+branch+opening with zero deltas and navigates', async () => {
    const { db, ctx } = await setup()
    const navigate = vi.fn()

    const result = await finishWizard(
      makeState({ title: 'The Floating Isles', opening: { content: 'Once upon a time.' } }),
      ctx,
      navigate,
      APP_DEFAULTS,
      1000,
    )

    expect(result).toEqual({ status: 'ok', storyId: expect.any(String) })
    const storyId = result.status === 'ok' ? result.storyId : ''

    const storyRow = (await db.select().from(stories).where(eq(stories.id, storyId)))[0]
    expect(storyRow.status).toBe('active')

    const branchRows = await db.select().from(branches).where(eq(branches.storyId, storyId))
    expect(branchRows).toHaveLength(1)
    expect(storyRow.currentBranchId).toBe(branchRows[0].id)

    const entryRows = await db
      .select()
      .from(storyEntries)
      .where(eq(storyEntries.branchId, branchRows[0].id))
    expect(entryRows).toHaveLength(1)
    expect(entryRows[0]).toMatchObject({
      position: 1,
      kind: 'opening',
      content: 'Once upon a time.',
    })
    expect(entryRows[0].metadata!.model).toBeUndefined()
    expect(entryRows[0].metadata!.sceneEntities).toEqual([])

    expect(await db.select().from(entities)).toHaveLength(0)
    expect(await db.select().from(deltas)).toHaveLength(0)
    expect(navigate).toHaveBeenCalledWith(branchRows[0].id)
  })

  it('adventure+first: writes the lead entity, definition.leadEntityId, and opening refs to one id', async () => {
    const { db, ctx } = await setup()
    const navigate = vi.fn()

    const result = await finishWizard(
      makeState({
        mode: 'adventure',
        narration: 'first',
        title: 'Aria Rising',
        leadName: 'Aria',
        leadEntityId: LEAD_ID,
        opening: {
          content: 'You wake at dawn.',
          sceneEntities: [LEAD_ID],
          currentLocationId: 'loc_99999999-9999-9999-9999-999999999999',
          model: 'gpt-x',
        },
      }),
      ctx,
      navigate,
      APP_DEFAULTS,
      2000,
    )

    expect(result.status).toBe('ok')
    const storyId = result.status === 'ok' ? result.storyId : ''

    const storyRow = (await db.select().from(stories).where(eq(stories.id, storyId)))[0]
    expect(storyRow.definition!.leadEntityId).toBe(LEAD_ID)

    const entityRows = await db.select().from(entities)
    expect(entityRows).toHaveLength(1)
    expect(entityRows[0]).toMatchObject({
      id: LEAD_ID,
      kind: 'character',
      name: 'Aria',
      status: 'active',
    })
    expect(entityRows[0].state).toEqual(emptyEntityState('character'))

    const branchRows = await db.select().from(branches).where(eq(branches.storyId, storyId))
    const entryRows = await db
      .select()
      .from(storyEntries)
      .where(eq(storyEntries.branchId, branchRows[0].id))
    expect(entryRows[0].metadata!.sceneEntities).toEqual([LEAD_ID])
    expect(entryRows[0].metadata!.model).toBe('gpt-x')
    // M2 never materializes a location entity — currentLocationId is always
    // nulled, even when the working-state opening carried one.
    expect(entryRows[0].metadata!.currentLocationId).toBeNull()

    // The load-bearing id-consistency invariant: the committed opening ref, the
    // lead entities row, and definition.leadEntityId are all the SAME real id.
    expect(entityRows[0].id).toBe(entryRows[0].metadata!.sceneEntities[0])
    expect(entityRows[0].id).toBe(storyRow.definition!.leadEntityId)

    expect(await db.select().from(deltas)).toHaveLength(0)
    expect(navigate).toHaveBeenCalledWith(branchRows[0].id)
  })

  it('mints a lead id when the path needs one but the wizard never ran opening-assist', async () => {
    const { db, ctx } = await setup()

    const result = await finishWizard(
      makeState({
        mode: 'adventure',
        narration: 'first',
        title: 'Untold',
        leadName: 'Bran',
        leadEntityId: null,
        opening: { content: 'The gate opened.' },
      }),
      ctx,
      vi.fn(),
      APP_DEFAULTS,
      2500,
    )

    expect(result.status).toBe('ok')
    const storyId = result.status === 'ok' ? result.storyId : ''
    const storyRow = (await db.select().from(stories).where(eq(stories.id, storyId)))[0]
    const entityRows = await db.select().from(entities)
    expect(entityRows).toHaveLength(1)
    expect(entityRows[0].name).toBe('Bran')
    expect(storyRow.definition!.leadEntityId).toBe(entityRows[0].id)
    expect(entityRows[0].id).toMatch(/^char_/)
  })

  it('drops stale opening refs when the lead requirement was cleared by a back-jump', async () => {
    const { db, ctx } = await setup()

    // creative+third (no lead) but opening carries a ref minted on an earlier
    // adventure+first pass — the commit must not persist a dangling entity ref.
    const result = await finishWizard(
      makeState({
        title: 'Reframed',
        leadName: 'Aria',
        leadEntityId: LEAD_ID,
        opening: { content: 'Once.', sceneEntities: [LEAD_ID], model: 'gpt-x' },
      }),
      ctx,
      vi.fn(),
      APP_DEFAULTS,
      4500,
    )

    expect(result.status).toBe('ok')
    const storyId = result.status === 'ok' ? result.storyId : ''
    const storyRow = (await db.select().from(stories).where(eq(stories.id, storyId)))[0]
    expect(storyRow.definition!.leadEntityId).toBeNull()
    expect(await db.select().from(entities)).toHaveLength(0)

    const branchRows = await db.select().from(branches).where(eq(branches.storyId, storyId))
    const entryRows = await db
      .select()
      .from(storyEntries)
      .where(eq(storyEntries.branchId, branchRows[0].id))
    expect(entryRows[0].metadata!.sceneEntities).toEqual([])
  })

  it('blocks Finish when the title is empty; DB untouched, no navigation', async () => {
    const { db, ctx } = await setup()
    const navigate = vi.fn()

    const result = await finishWizard(
      makeState({ title: '   ', opening: { content: 'Once.' } }),
      ctx,
      navigate,
      APP_DEFAULTS,
      3000,
    )

    expect(result.status).toBe('invalid')
    expect(result.status === 'invalid' && result.reasons).toContain('title')
    expect(await db.select().from(stories)).toHaveLength(0)
    expect(await db.select().from(branches)).toHaveLength(0)
    expect(await db.select().from(storyEntries)).toHaveLength(0)
    expect(navigate).not.toHaveBeenCalled()
  })

  it('blocks Finish when the opening is empty; DB untouched', async () => {
    const { db, ctx } = await setup()

    const result = await finishWizard(
      makeState({ title: 'A title', opening: { content: '' } }),
      ctx,
      vi.fn(),
      APP_DEFAULTS,
      3500,
    )

    expect(result.status).toBe('invalid')
    expect(result.status === 'invalid' && result.reasons).toContain('opening')
    expect(await db.select().from(stories)).toHaveLength(0)
  })

  it('blocks Finish when a lead is required but the name is empty', async () => {
    const { db, ctx } = await setup()

    const result = await finishWizard(
      makeState({
        mode: 'adventure',
        narration: 'first',
        title: 'A title',
        leadName: '',
        opening: { content: 'Once.' },
      }),
      ctx,
      vi.fn(),
      APP_DEFAULTS,
      4000,
    )

    expect(result.status).toBe('invalid')
    expect(result.status === 'invalid' && result.reasons).toContain('lead')
    expect(await db.select().from(stories)).toHaveLength(0)
    expect(await db.select().from(entities)).toHaveLength(0)
  })

  it('promoteDraftStoryId: a resumed draft is promoted in place, its session row is gone', async () => {
    const { db, ctx } = await setup()
    const draftId = 'story_draft_resumed'
    const navigate = vi.fn()

    await db.insert(stories).values({
      id: draftId,
      title: 'Untitled story',
      status: 'draft',
      createdAt: 100,
      updatedAt: 100,
    })
    await db
      .insert(wizardSessions)
      .values({ id: draftId, storyId: draftId, state: emptyWorkingState(), updatedAt: 100 })

    const result = await finishWizard(
      makeState({ title: 'Promoted', opening: { content: 'The draft becomes real.' } }),
      ctx,
      navigate,
      APP_DEFAULTS,
      5000,
      draftId,
    )

    expect(result).toEqual({ status: 'ok', storyId: draftId })

    const storyRow = (await db.select().from(stories).where(eq(stories.id, draftId)))[0]
    expect(storyRow.status).toBe('active')
    expect(storyRow.title).toBe('Promoted')

    const branchRows = await db.select().from(branches).where(eq(branches.storyId, draftId))
    expect(branchRows).toHaveLength(1)
    expect(storyRow.currentBranchId).toBe(branchRows[0].id)

    const entryRows = await db
      .select()
      .from(storyEntries)
      .where(eq(storyEntries.branchId, branchRows[0].id))
    expect(entryRows).toHaveLength(1)
    expect(entryRows[0].content).toBe('The draft becomes real.')

    const sessionRows = await db.select().from(wizardSessions).where(eq(wizardSessions.id, draftId))
    expect(sessionRows).toHaveLength(0)

    expect(await db.select().from(deltas)).toHaveLength(0)
    expect(navigate).toHaveBeenCalledWith(branchRows[0].id)
  })

  it('still navigates and returns ok when clearing the live session fails post-commit', async () => {
    const { db, ctx } = await setup()
    const navigate = vi.fn()
    await db
      .insert(wizardSessions)
      .values({ id: 'live', storyId: null, state: emptyWorkingState(), updatedAt: 1 })

    // Fail only the live-session clear — its lone single-op wizard_sessions
    // delete. The story commit (multi-op) and the open must still go through.
    const failingCtx = {
      ...ctx,
      runInTransaction: (ops: SqlOp[]) =>
        ops.length === 1 && /wizard_sessions/.test(ops[0].sql)
          ? Promise.reject(new Error('clear failed'))
          : ctx.runInTransaction(ops),
    }

    const result = await finishWizard(
      makeState({ title: 'Survives', opening: { content: 'Committed anyway.' } }),
      failingCtx,
      navigate,
      APP_DEFAULTS,
      1000,
    )

    expect(result).toEqual({ status: 'ok', storyId: expect.any(String) })
    expect(navigate).toHaveBeenCalledTimes(1)

    const storyId = result.status === 'ok' ? result.storyId : ''
    const storyRow = (await db.select().from(stories).where(eq(stories.id, storyId)))[0]
    expect(storyRow.status).toBe('active')
    // Cleanup threw, so the live row is intentionally left behind.
    const liveRows = await db.select().from(wizardSessions).where(eq(wizardSessions.id, 'live'))
    expect(liveRows).toHaveLength(1)
  })
})
