import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { branches, deltas, stories, threads, type NewThread } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { threadsStore } from '@/lib/stores'

import { registerThreads } from './register'
import { applyDeltaAction, lockKeysFor } from '../delta/apply-delta-action'
import { __resetRegistry } from '../delta/registry'
import { reverseReplayDeltas } from '../delta/reverse-replay'
import { USER_EDITED_SINCE_PROSE } from '../delta/user-precedence'
import { registerStoryEntries } from '../story-entries/register'
import type { PipelineAction } from '../types'

async function setup() {
  __resetRegistry()
  registerThreads()
  const { db, runInTransaction } = await createTestDb()
  await db.insert(stories).values({ id: 'story_1', title: 'T', createdAt: 1, updatedAt: 1 })
  await db.insert(branches).values({ id: 'br_1', storyId: 'story_1', name: 'main', createdAt: 1 })
  threadsStore.__reset()
  threadsStore.hydrate('br_1', [])
  return { db, ctx: { db, runInTransaction } }
}

const THREAD: NewThread = {
  id: 'thr_1',
  branchId: 'br_1',
  title: 'Recover the relic',
  description: 'A quest line.',
  category: 'quest',
  icon: 'sword',
  status: 'pending',
  injectionMode: 'auto',
  createdAt: 1,
  updatedAt: 1,
}

async function rowFor(db: Awaited<ReturnType<typeof setup>>['db'], id: string) {
  const [r] = await db.select().from(threads).where(eq(threads.id, id))
  return r
}

type Ctx = Awaited<ReturnType<typeof setup>>['ctx']
const apply = (ctx: Ctx, action: PipelineAction, actionId: string) =>
  applyDeltaAction({ action, actionId, branchId: 'br_1' }, ctx)
const create = (ctx: Ctx, entry: NewThread, source: 'user_edit' | 'periodic_classifier') =>
  apply(ctx, { kind: 'createThread', source, payload: { entry } }, 'act_c')
const userPatch = (patch: Record<string, unknown>): PipelineAction => ({
  kind: 'updateThread',
  source: 'user_edit',
  payload: { branchId: 'br_1', id: 'thr_1', patch },
})
const undoOf = async (db: Awaited<ReturnType<typeof setup>>['db'], actionId: string) =>
  (await db.select().from(deltas).where(eq(deltas.actionId, actionId)))[0]?.undoPayload

describe('threads CRUD arms', () => {
  it('create writes the row + create-patch into the held-branch store', async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(
      {
        action: { kind: 'createThread', source: 'chapter_close', payload: { entry: THREAD } },
        actionId: 'act_c',
        branchId: 'br_1',
      },
      ctx,
    )
    expect((await rowFor(db, 'thr_1')).title).toBe('Recover the relic')
    expect(threadsStore.getById('thr_1')?.status).toBe('pending')
  })

  it('a write to a non-held branch no-ops against the store', async () => {
    const { db, ctx } = await setup()
    threadsStore.hydrate('br_2', [])
    await applyDeltaAction(
      {
        action: { kind: 'createThread', source: 'chapter_close', payload: { entry: THREAD } },
        actionId: 'act_c',
        branchId: 'br_1',
      },
      ctx,
    )
    expect((await rowFor(db, 'thr_1')).title).toBe('Recover the relic')
    expect(threadsStore.getById('thr_1')).toBeUndefined()
  })

  it('rejects an empty-set update (no updatable fields → no throw, no delta)', async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(
      {
        action: { kind: 'createThread', source: 'chapter_close', payload: { entry: THREAD } },
        actionId: 'act_c',
        branchId: 'br_1',
      },
      ctx,
    )
    const result = await applyDeltaAction(
      {
        action: {
          kind: 'updateThread',
          source: 'user_edit',
          payload: { branchId: 'br_1', id: 'thr_1', patch: {} },
        },
        actionId: 'act_noop',
        branchId: 'br_1',
      },
      ctx,
    )
    expect(result.status).toBe('rejected')
    expect((await rowFor(db, 'thr_1')).title).toBe('Recover the relic') // unchanged
    expect((await db.select().from(deltas)).length).toBe(1) // only the create delta
  })

  // Drizzle skips an undefined key, so committing would leave the row as it was while the
  // store, the undo payload and History recorded a write.
  it('refuses a column set to undefined, and codes a missing row as not-found', async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(
      {
        action: { kind: 'createThread', source: 'chapter_close', payload: { entry: THREAD } },
        actionId: 'act_c',
        branchId: 'br_1',
      },
      ctx,
    )
    const update = (id: string, patch: Record<string, unknown>) =>
      applyDeltaAction(
        {
          action: {
            kind: 'updateThread',
            source: 'user_edit',
            payload: { branchId: 'br_1', id, patch },
          },
          actionId: 'act_u',
          branchId: 'br_1',
        },
        ctx,
      )

    expect(await update('thr_1', { title: undefined, status: 'active' })).toMatchObject({
      status: 'rejected',
    })
    expect((await rowFor(db, 'thr_1')).status).toEqual('pending')
    expect(threadsStore.getById('thr_1')?.title).toBe('Recover the relic')
    expect((await db.select().from(deltas)).length).toBe(1)
    expect(await update('thr_9', { status: 'active' })).toMatchObject({
      status: 'rejected',
      code: 'not-found',
    })
  })

  it('rejects an unknown status on create (no row, no delta)', async () => {
    const { db, ctx } = await setup()
    const bad = { ...THREAD, status: 'abandoned' } as unknown as NewThread
    const result = await applyDeltaAction(
      {
        action: { kind: 'createThread', source: 'chapter_close', payload: { entry: bad } },
        actionId: 'act_bad',
        branchId: 'br_1',
      },
      ctx,
    )
    expect(result.status).toBe('rejected')
    expect(await rowFor(db, 'thr_1')).toBeUndefined()
    expect((await db.select().from(deltas)).length).toBe(0)
  })

  it('update on status + entry-ref produces a whole-value undo; reverse-replay restores row + store', async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(
      {
        action: { kind: 'createThread', source: 'chapter_close', payload: { entry: THREAD } },
        actionId: 'act_c',
        branchId: 'br_1',
      },
      ctx,
    )

    await applyDeltaAction(
      {
        action: {
          kind: 'updateThread',
          source: 'user_edit',
          payload: {
            branchId: 'br_1',
            id: 'thr_1',
            patch: { status: 'active', triggeredAtEntryId: 'se_5' },
          },
        },
        actionId: 'act_u',
        branchId: 'br_1',
      },
      ctx,
    )

    expect((await rowFor(db, 'thr_1')).status).toBe('active')
    expect(threadsStore.getById('thr_1')?.triggeredAtEntryId).toBe('se_5')

    expect(await reverseReplayDeltas('act_u', ctx)).toBe(1)
    const back = await rowFor(db, 'thr_1')
    expect(back.status).toBe('pending')
    expect(back.triggeredAtEntryId).toBeNull()
    expect(threadsStore.getById('thr_1')?.status).toBe('pending')
  })

  it('normalizes an empty-string entry ref to null on update', async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(
      {
        action: {
          kind: 'createThread',
          source: 'chapter_close',
          payload: { entry: { ...THREAD, triggeredAtEntryId: 'se_5' } },
        },
        actionId: 'act_c',
        branchId: 'br_1',
      },
      ctx,
    )
    await applyDeltaAction(
      {
        action: {
          kind: 'updateThread',
          source: 'user_edit',
          payload: { branchId: 'br_1', id: 'thr_1', patch: { triggeredAtEntryId: '' } },
        },
        actionId: 'act_u',
        branchId: 'br_1',
      },
      ctx,
    )
    expect((await rowFor(db, 'thr_1')).triggeredAtEntryId).toBeNull()
  })

  it('normalizes an empty-string entry ref to null on create', async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(
      {
        action: {
          kind: 'createThread',
          source: 'chapter_close',
          payload: { entry: { ...THREAD, triggeredAtEntryId: '' } },
        },
        actionId: 'act_c',
        branchId: 'br_1',
      },
      ctx,
    )
    expect((await rowFor(db, 'thr_1')).triggeredAtEntryId).toBeNull()
  })

  it('delete captures the full row; reverse-replay re-inserts + store create-patch', async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(
      {
        action: { kind: 'createThread', source: 'chapter_close', payload: { entry: THREAD } },
        actionId: 'act_c',
        branchId: 'br_1',
      },
      ctx,
    )
    await applyDeltaAction(
      {
        action: {
          kind: 'deleteThread',
          source: 'user_edit',
          payload: { branchId: 'br_1', id: 'thr_1' },
        },
        actionId: 'act_d',
        branchId: 'br_1',
      },
      ctx,
    )
    expect(await rowFor(db, 'thr_1')).toBeUndefined()
    expect(threadsStore.getById('thr_1')).toBeUndefined()

    expect(await reverseReplayDeltas('act_d', ctx)).toBe(1)
    expect((await rowFor(db, 'thr_1')).title).toBe('Recover the relic')
    expect(threadsStore.getById('thr_1')?.title).toBe('Recover the relic')
  })

  it('defaults embedding_stale to 1 on create', async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(
      {
        action: { kind: 'createThread', source: 'chapter_close', payload: { entry: THREAD } },
        actionId: 'act_c',
        branchId: 'br_1',
      },
      ctx,
    )
    expect((await rowFor(db, 'thr_1')).embeddingStale).toBe(1)
  })

  it('flips embedding_stale only when an embedded column changes', async () => {
    const { db, ctx } = await setup()
    await applyDeltaAction(
      {
        action: {
          kind: 'createThread',
          source: 'chapter_close',
          payload: { entry: { ...THREAD, embeddingStale: 0 } },
        },
        actionId: 'act_c',
        branchId: 'br_1',
      },
      ctx,
    )

    await applyDeltaAction(
      {
        action: {
          kind: 'updateThread',
          source: 'user_edit',
          payload: { branchId: 'br_1', id: 'thr_1', patch: { icon: 'shield' } },
        },
        actionId: 'act_u1',
        branchId: 'br_1',
      },
      ctx,
    )
    expect((await rowFor(db, 'thr_1')).embeddingStale).toBe(0) // non-embedded columns don't flip

    await applyDeltaAction(
      {
        action: {
          kind: 'updateThread',
          source: 'user_edit',
          payload: { branchId: 'br_1', id: 'thr_1', patch: { title: 'Recover the relic' } },
        },
        actionId: 'act_u2',
        branchId: 'br_1',
      },
      ctx,
    )
    expect((await rowFor(db, 'thr_1')).embeddingStale).toBe(0) // same value re-sent compares equal

    await applyDeltaAction(
      {
        action: {
          kind: 'updateThread',
          source: 'user_edit',
          payload: { branchId: 'br_1', id: 'thr_1', patch: { description: 'new text' } },
        },
        actionId: 'act_u3',
        branchId: 'br_1',
      },
      ctx,
    )
    expect((await rowFor(db, 'thr_1')).embeddingStale).toBe(1) // embedded column changed
  })
})

// classifier.md → Threads → The row: the ref is only ever the pass's claim of where a status ended.
describe('updateThread — the entry a status ended on', () => {
  const PASS_THREAD: NewThread = {
    ...THREAD,
    status: 'resolved',
    triggeredAtEntryId: 'e_setup',
    resolvedAtEntryId: 'e_old',
  }

  it.each([
    ['resolved', 'pending'],
    ['resolved', 'active'],
    ['resolved', 'failed'],
    ['failed', 'resolved'],
  ] as const)(
    "clears it when the user changes a pass's %s thread to %s, and undo restores both",
    async (from, to) => {
      const { db, ctx } = await setup()
      await create(ctx, { ...PASS_THREAD, status: from }, 'periodic_classifier')
      expect((await apply(ctx, userPatch({ status: to }), 'act_u')).status).toBe('ok')
      expect(await rowFor(db, 'thr_1')).toMatchObject({ status: to, resolvedAtEntryId: null })
      expect(threadsStore.getById('thr_1')).toMatchObject({ status: to, resolvedAtEntryId: null })
      expect(await undoOf(db, 'act_u')).toEqual({ status: from, resolvedAtEntryId: 'e_old' })

      await reverseReplayDeltas('act_u', ctx)
      const restored = { status: from, resolvedAtEntryId: 'e_old' }
      expect(await rowFor(db, 'thr_1')).toMatchObject(restored)
      expect(threadsStore.getById('thr_1')).toMatchObject(restored)
    },
  )

  it('clears it over a ref the same patch sends', async () => {
    const { db, ctx } = await setup()
    await create(ctx, PASS_THREAD, 'periodic_classifier')
    await apply(ctx, userPatch({ status: 'active', resolvedAtEntryId: 'e_other' }), 'act_u')
    expect(await rowFor(db, 'thr_1')).toMatchObject({ status: 'active', resolvedAtEntryId: null })
  })

  it.each([[{ status: 'resolved' }], [{ title: 'Return the relic' }]])(
    'keeps it on a save that leaves the status as it was (%o)',
    async (patch) => {
      const { db, ctx } = await setup()
      await create(ctx, PASS_THREAD, 'periodic_classifier')
      expect((await apply(ctx, userPatch(patch), 'act_u')).status).toBe('ok')
      expect(await rowFor(db, 'thr_1')).toMatchObject({
        status: 'resolved',
        resolvedAtEntryId: 'e_old',
      })
      expect(Object.keys((await undoOf(db, 'act_u')) ?? {})).toEqual(Object.keys(patch))
    },
  )

  it("writes only the status of a user's thread", async () => {
    const { db, ctx } = await setup()
    await create(ctx, { ...THREAD, status: 'failed' }, 'user_edit')
    await apply(ctx, userPatch({ status: 'active' }), 'act_u')
    expect(await rowFor(db, 'thr_1')).toMatchObject({
      status: 'active',
      triggeredAtEntryId: null,
      resolvedAtEntryId: null,
    })
    expect(await undoOf(db, 'act_u')).toEqual({ status: 'failed' })
  })
})

// classifier.md → Threads → The row: a pass moves a listed thread's status.
describe('setThreadStatus', () => {
  const PROSE = 'e_prose'
  // A thread a pass created carries the turn that set it up.
  const PASS_THREAD: NewThread = { ...THREAD, status: 'active', triggeredAtEntryId: 'e_setup' }
  const USER_THREAD: NewThread = { ...THREAD, status: 'active', triggeredAtEntryId: null }

  async function setupWithProse() {
    const harness = await setup()
    registerStoryEntries()
    return harness
  }
  const writeProse = (ctx: Ctx) =>
    apply(
      ctx,
      {
        kind: 'createStoryEntry',
        source: 'ai_classifier',
        payload: {
          entry: {
            id: PROSE,
            branchId: 'br_1',
            position: 1,
            kind: 'ai_reply',
            content: "The relic lies in Kael's hands at last.",
            createdAt: 1,
          },
        },
      },
      'act_prose',
    )
  const setStatus = (
    status: 'active' | 'resolved' | 'failed',
    {
      resolvedAtEntryId = status === 'active' ? null : PROSE,
      proseEntryId = PROSE,
    }: { resolvedAtEntryId?: string | null; proseEntryId?: string | null } = {},
  ): PipelineAction => ({
    kind: 'setThreadStatus',
    source: 'periodic_classifier',
    payload: { branchId: 'br_1', id: 'thr_1', status, resolvedAtEntryId, proseEntryId },
  })
  const noop = (reason: string) => ({ status: 'rejected', reason, code: 'noop' })

  async function seed(ctx: Ctx, entry: NewThread = PASS_THREAD) {
    await create(ctx, entry, 'periodic_classifier')
    await writeProse(ctx)
  }

  it.each(['resolved', 'failed'] as const)(
    "%s on a pass's thread records the entry it ended on",
    async (status) => {
      const { db, ctx } = await setupWithProse()
      await seed(ctx)
      expect((await apply(ctx, setStatus(status), 'act_s')).status).toBe('ok')
      expect(await rowFor(db, 'thr_1')).toMatchObject({ status, resolvedAtEntryId: PROSE })
      expect(threadsStore.getById('thr_1')).toMatchObject({ status, resolvedAtEntryId: PROSE })
      expect(await undoOf(db, 'act_s')).toEqual({ status: 'active', resolvedAtEntryId: null })
    },
  )

  it("clears the entry when a pass's resolved thread is taken up again, whatever the payload", async () => {
    const { db, ctx } = await setupWithProse()
    await seed(ctx, { ...PASS_THREAD, status: 'resolved', resolvedAtEntryId: 'e_old' })
    expect(
      (await apply(ctx, setStatus('active', { resolvedAtEntryId: PROSE }), 'act_s')).status,
    ).toBe('ok')
    expect(await rowFor(db, 'thr_1')).toMatchObject({ status: 'active', resolvedAtEntryId: null })
    expect(await undoOf(db, 'act_s')).toEqual({ status: 'resolved', resolvedAtEntryId: 'e_old' })
  })

  it("leaves a user's thread with no entry refs, whatever the payload carries", async () => {
    const { db, ctx } = await setupWithProse()
    await create(ctx, USER_THREAD, 'user_edit')
    await writeProse(ctx)
    expect((await apply(ctx, setStatus('resolved', { proseEntryId: null }), 'act_s')).status).toBe(
      'ok',
    )
    expect(await rowFor(db, 'thr_1')).toMatchObject({
      status: 'resolved',
      triggeredAtEntryId: null,
      resolvedAtEntryId: null,
    })
    expect(await undoOf(db, 'act_s')).toEqual({ status: 'active' })
  })

  it('logs only the status when the entry stays as it was', async () => {
    const { db, ctx } = await setupWithProse()
    await seed(ctx, { ...PASS_THREAD, status: 'pending' })
    expect((await apply(ctx, setStatus('active'), 'act_s')).status).toBe('ok')
    expect(await undoOf(db, 'act_s')).toEqual({ status: 'pending' })
  })

  it('reverses to the status and entry before it', async () => {
    const { db, ctx } = await setupWithProse()
    await seed(ctx)
    await apply(ctx, setStatus('resolved'), 'act_s')
    expect(await reverseReplayDeltas('act_s', ctx)).toBe(1)
    expect(await rowFor(db, 'thr_1')).toMatchObject({ status: 'active', resolvedAtEntryId: null })
    expect(threadsStore.getById('thr_1')).toMatchObject({ status: 'active' })
  })

  // generation-pipeline.md → Reverse-replay: a status and its entry ref are restored as one field.
  it('restores the status and entry together past a later edit of the title', async () => {
    const { db, ctx } = await setupWithProse()
    await seed(ctx, { ...PASS_THREAD, status: 'resolved', resolvedAtEntryId: 'e_old' })
    await apply(ctx, setStatus('active'), 'act_s')
    await apply(ctx, userPatch({ title: 'Return the relic' }), 'act_u')
    await reverseReplayDeltas('act_s', ctx)
    const restored = { status: 'resolved', resolvedAtEntryId: 'e_old' }
    expect(await rowFor(db, 'thr_1')).toMatchObject(restored)
    expect(threadsStore.getById('thr_1')).toMatchObject(restored)
  })

  it('keeps both when the user changed the status after the pass took the thread up', async () => {
    const { db, ctx } = await setupWithProse()
    await seed(ctx, { ...PASS_THREAD, status: 'resolved', resolvedAtEntryId: 'e_old' })
    await apply(ctx, setStatus('active'), 'act_s')
    await apply(ctx, userPatch({ status: 'failed' }), 'act_u')
    await reverseReplayDeltas('act_s', ctx)
    const kept = { status: 'failed', resolvedAtEntryId: null }
    expect(await rowFor(db, 'thr_1')).toMatchObject(kept)
    expect(threadsStore.getById('thr_1')).toMatchObject(kept)
  })

  it('keeps no entry once the user fails a thread the pass resolved and the pass is reversed', async () => {
    const { db, ctx } = await setupWithProse()
    await seed(ctx)
    await apply(ctx, setStatus('resolved'), 'act_s')
    await apply(ctx, userPatch({ status: 'failed' }), 'act_u')
    await reverseReplayDeltas('act_s', ctx)
    const kept = { status: 'failed', resolvedAtEntryId: null }
    expect(await rowFor(db, 'thr_1')).toMatchObject(kept)
    expect(threadsStore.getById('thr_1')).toMatchObject(kept)
  })

  it('no-ops when the status already matches', async () => {
    const { db, ctx } = await setupWithProse()
    await seed(ctx)
    expect(await apply(ctx, setStatus('active'), 'act_s')).toEqual(noop('status-unchanged'))
    expect((await db.select().from(deltas).where(eq(deltas.actionId, 'act_s'))).length).toBe(0)
  })

  it('no-ops when the thread is gone', async () => {
    const { ctx } = await setupWithProse()
    expect(await apply(ctx, setStatus('resolved'), 'act_s')).toEqual(
      noop('status target threads br_1:thr_1 not found'),
    )
  })

  // cadence.md → User edits and classifier writes: a status the user wrote after the prose stands.
  it('keeps a status the user wrote after the prose', async () => {
    const { db, ctx } = await setupWithProse()
    await seed(ctx)
    await apply(ctx, userPatch({ status: 'failed' }), 'act_u')
    expect(await apply(ctx, setStatus('resolved'), 'act_s')).toEqual(noop(USER_EDITED_SINCE_PROSE))
    expect((await rowFor(db, 'thr_1')).status).toBe('failed')
  })

  it("changes it past a later edit of the thread's title", async () => {
    const { db, ctx } = await setupWithProse()
    await seed(ctx)
    await apply(ctx, userPatch({ title: 'Return the relic' }), 'act_u')
    expect((await apply(ctx, setStatus('resolved'), 'act_s')).status).toBe('ok')
    expect((await rowFor(db, 'thr_1')).status).toBe('resolved')
  })

  it('changes it over a status the user wrote before the prose', async () => {
    const { ctx } = await setupWithProse()
    await create(ctx, PASS_THREAD, 'periodic_classifier')
    await apply(ctx, userPatch({ status: 'pending' }), 'act_u')
    await writeProse(ctx)
    expect((await apply(ctx, setStatus('resolved'), 'act_s')).status).toBe('ok')
  })

  it('keeps the status of a thread the user created after the prose', async () => {
    const { db, ctx } = await setupWithProse()
    await writeProse(ctx)
    await create(ctx, USER_THREAD, 'user_edit')
    expect(await apply(ctx, setStatus('resolved'), 'act_s')).toEqual(noop(USER_EDITED_SINCE_PROSE))
    expect((await rowFor(db, 'thr_1')).status).toBe('active')
  })

  it("serializes on the thread's row key", () => {
    expect(lockKeysFor(setStatus('resolved'))).toEqual(['threads:br_1:thr_1'])
  })
})
