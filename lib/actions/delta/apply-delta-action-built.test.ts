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
  nameCollisionPartnerId: null,
  nameCollisionReason: null,
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

const describeEntity = (id: string, description: string, source: DeltaSource): PipelineAction => ({
  kind: 'updateEntity',
  source,
  payload: { branchId: 'b1', id, patch: { description } },
})
const describeAria = (description: string, source: DeltaSource) =>
  describeEntity('char_a', description, source)

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
    let seen: string | null | undefined
    const build = vi.fn((): BuiltGroup => {
      seen = entitiesStore.getById('char_a')?.description
      return { status: 'ok', actions: [describeAria(`${seen}, then the user`, 'user_edit')] }
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
    expect(seen).toBe('from the pass')
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
          throw new Error('build failure')
        },
        { actionId: 'act_user', branchId: 'b1' },
        ctx,
      ),
    ).rejects.toThrow('build failure')

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

  it("locks every action's row key, not only the first's", async () => {
    const BRIA: Entity = { ...ARIA, id: 'char_b', name: 'Bria' }
    await ctx.db.insert(entities).values(BRIA)
    entitiesStore.hydrate('b1', [ARIA, BRIA])
    const gate = deferred()
    const gatedCtx: DbCtx = {
      db: ctx.db,
      runInTransaction: async (ops) => {
        await gate.promise
        await ctx.runInTransaction(ops)
      },
    }
    const other = applyDeltaAction(
      {
        action: describeEntity('char_b', 'from the other write', 'user_edit'),
        actionId: 'act_other',
        branchId: 'b1',
      },
      gatedCtx,
    )
    const group = applyDeltaActionGroupBuilt(
      () => ({
        status: 'ok',
        actions: [
          describeEntity('char_a', 'a from the group', 'user_edit'),
          describeEntity('char_b', 'b from the group', 'user_edit'),
        ],
      }),
      { actionId: 'act_user', branchId: 'b1' },
      ctx,
    )
    await flush()
    expect(await actionDeltas('act_user')).toEqual([])

    gate.resolve()
    expect(await other).toMatchObject({ status: 'ok' })
    expect(await group).toEqual({ status: 'ok' })
    const groupDeltas = await actionDeltas('act_user')
    expect(groupDeltas.find((d) => d.targetId === 'char_b')?.undoPayload).toEqual({
      description: 'from the other write',
    })
  })

  it('keeps the hold from the build through the commit, so a pass asked for meanwhile waits', async () => {
    let pass: Promise<void> | undefined
    const write = applyDeltaActionGroupBuilt(
      () => {
        pass = holdBranchWriteExclusive('b1', 'act_pass')
        return { status: 'ok', actions: [describeAria('from the group', 'user_edit')] }
      },
      { actionId: 'act_user', branchId: 'b1' },
      ctx,
    )
    await flush()
    if (pass == null) throw new Error('expected the build to have run')

    await pass
    expect(await actionDeltas('act_user')).toHaveLength(1)
    releaseBranchWriteExclusive('b1', 'act_pass')
    expect(await write).toEqual({ status: 'ok' })
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
