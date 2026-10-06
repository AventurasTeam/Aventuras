import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { branches, deltas, entities, stories, type Entity } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { entitiesStore, resetAllStores } from '@/lib/stores'

import type { DbCtx, DeltaSource, PipelineAction } from '../types'
import {
  applyDeltaAction,
  applyDeltaActionGroupBuilt,
  settleUserWrites,
  type BuiltGroup,
} from './apply-delta-action'
import {
  __resetBranchWriteLocks,
  holdBranchWriteExclusive,
  releaseBranchWriteExclusive,
} from './branch-write-lock'

const ARIA: Entity = {
  id: 'char_a',
  branchId: 'b1',
  kind: 'character',
  name: 'Aria',
  description: 'seed',
  status: 'active',
  retiredReason: null,
  injectionMode: 'auto',
  nameCollisionFlag: 0,
  state: null,
  tags: [],
  keywords: [],
  priority: 0,
  embeddingStale: 0,
  createdAt: 1,
  updatedAt: 1,
}

function deferred<T = void>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

// The lock advances over microtasks; a macrotask hop runs every queued continuation.
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

// Races a settled flag against a timer turn, so a grant that never comes fails fast.
async function isSettled(promise: Promise<unknown>): Promise<boolean> {
  let settled = false
  promise.then(
    () => {
      settled = true
    },
    () => {
      settled = true
    },
  )
  await flush()
  return settled
}

const describeAria = (description: string, source: DeltaSource): PipelineAction => ({
  kind: 'updateEntity',
  source,
  payload: { branchId: 'b1', id: 'char_a', patch: { description } },
})

describe('applyDeltaActionGroupBuilt', () => {
  let ctx: DbCtx

  beforeEach(async () => {
    resetAllStores()
    const { db, runInTransaction } = await createTestDb()
    ctx = { db, runInTransaction }
    await db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
    await db.insert(branches).values({ id: 'b1', storyId: 's1', name: 'm', createdAt: 1 })
    await db.insert(entities).values(ARIA)
    entitiesStore.hydrate('b1', [ARIA])
  })
  afterEach(() => {
    resetAllStores()
    __resetBranchWriteLocks()
  })

  const actionDeltas = (actionId: string) =>
    ctx.db.select().from(deltas).where(eq(deltas.actionId, actionId))

  const ariaDescription = async () => {
    const [row] = await ctx.db
      .select({ description: entities.description })
      .from(entities)
      .where(eq(entities.id, 'char_a'))
    return row.description
  }

  it("builds only after a no-gate pass releases, so the plan reads the pass's write", async () => {
    await holdBranchWriteExclusive('b1', 'act_pass')
    const seen: { db?: string | null; store?: string | null } = {}
    const build = vi.fn(async (): Promise<BuiltGroup> => {
      seen.db = await ariaDescription()
      seen.store = entitiesStore.getById('char_a')?.description
      return { status: 'ok', actions: [describeAria(`${seen.store}, then the user`, 'user_edit')] }
    })

    const write = applyDeltaActionGroupBuilt(build, { actionId: 'act_user', branchId: 'b1' }, ctx)
    await flush()
    expect(build).not.toHaveBeenCalled()

    expect(
      await applyDeltaAction(
        {
          action: describeAria('from the pass', 'periodic_classifier'),
          actionId: 'act_pass',
          branchId: 'b1',
        },
        ctx,
      ),
    ).toMatchObject({ status: 'ok' })
    releaseBranchWriteExclusive('b1', 'act_pass')

    expect(await write).toEqual({ status: 'ok' })
    expect(build).toHaveBeenCalledTimes(1)
    expect(seen).toEqual({ db: 'from the pass', store: 'from the pass' })
    expect(await ariaDescription()).toBe('from the pass, then the user')
    const [delta] = await actionDeltas('act_user')
    expect(delta.undoPayload).toEqual({ description: 'from the pass' })
  })

  it('returns a build refusal as is, code included, and writes nothing', async () => {
    const refusal: BuiltGroup = {
      status: 'rejected',
      reason: 'the pair is gone',
      code: 'not-found',
    }

    const result = await applyDeltaActionGroupBuilt(
      () => refusal,
      { actionId: 'act_user', branchId: 'b1' },
      ctx,
    )

    expect(result).toEqual({ status: 'rejected', reason: 'the pair is gone', code: 'not-found' })
    expect(await ctx.db.select().from(deltas)).toEqual([])
  })

  it('rejects with a throwing build, writes nothing, and frees the branch lock', async () => {
    await expect(
      applyDeltaActionGroupBuilt(
        () => {
          throw new Error('sync build failure')
        },
        { actionId: 'act_sync', branchId: 'b1' },
        ctx,
      ),
    ).rejects.toThrow('sync build failure')
    await expect(
      applyDeltaActionGroupBuilt(
        async () => {
          throw new Error('async build failure')
        },
        { actionId: 'act_async', branchId: 'b1' },
        ctx,
      ),
    ).rejects.toThrow('async build failure')

    expect(await ctx.db.select().from(deltas)).toEqual([])
    expect(await isSettled(holdBranchWriteExclusive('b1', 'act_next'))).toBe(true)
    releaseBranchWriteExclusive('b1', 'act_next')
  })

  it('commits an empty plan as ok with no delta', async () => {
    expect(
      await applyDeltaActionGroupBuilt(
        () => ({ status: 'ok', actions: [] }),
        { actionId: 'act_user', branchId: 'b1' },
        ctx,
      ),
    ).toEqual({ status: 'ok' })
    expect(await ctx.db.select().from(deltas)).toEqual([])
  })

  it("serializes on the plan's row keys with a concurrent write to the same row", async () => {
    const gate = deferred()
    // The other write holds its row key while it waits here, between its read and its commit.
    const gatedCtx: DbCtx = {
      db: ctx.db,
      runInTransaction: async (ops) => {
        await gate.promise
        await ctx.runInTransaction(ops)
      },
    }
    const other = applyDeltaAction(
      {
        action: describeAria('from the other write', 'user_edit'),
        actionId: 'act_other',
        branchId: 'b1',
      },
      gatedCtx,
    )
    const build = vi.fn(
      (): BuiltGroup => ({ status: 'ok', actions: [describeAria('from the group', 'user_edit')] }),
    )

    const group = applyDeltaActionGroupBuilt(build, { actionId: 'act_user', branchId: 'b1' }, ctx)
    await flush()

    // The build needs only the shared hold; the row key holds the group's read and commit back.
    expect(build).toHaveBeenCalledTimes(1)
    expect(await actionDeltas('act_user')).toEqual([])

    gate.resolve()
    expect(await other).toMatchObject({ status: 'ok' })
    expect(await group).toEqual({ status: 'ok' })
    const [delta] = await actionDeltas('act_user')
    expect(delta.undoPayload).toEqual({ description: 'from the other write' })
    expect(await ariaDescription()).toBe('from the group')
  })

  it('counts as a user write while it waits on the lock', async () => {
    await holdBranchWriteExclusive('b1', 'act_pass')
    const write = applyDeltaActionGroupBuilt(
      () => ({ status: 'ok', actions: [describeAria('from the user', 'user_edit')] }),
      { actionId: 'act_user', branchId: 'b1' },
      ctx,
    )
    let settled = false
    const settling = settleUserWrites().then(() => {
      settled = true
    })
    await flush()

    expect(settled).toBe(false)
    releaseBranchWriteExclusive('b1', 'act_pass')
    await settling
    expect(await write).toEqual({ status: 'ok' })
  })
})
