import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

import { branches, stories, type ClassifierStatus } from '@/lib/db'
import { createTestDb } from '@/lib/db/__tests__/test-db'
import { generationStore } from '@/lib/stores'

import { bracketProseReversal, classifierWatermarkClampOps } from './prose-reversal'

describe('bracketProseReversal', () => {
  beforeEach(() => {
    generationStore.__reset()
  })

  it('sets reversalInProgress across the body and clears it after', async () => {
    const seen: boolean[] = []
    await bracketProseReversal(async () => {
      seen.push(generationStore.getTxState().reversalInProgress)
    })
    expect(seen).toEqual([true])
    expect(generationStore.getTxState().reversalInProgress).toBe(false)
  })

  it('clears reversalInProgress even when the body throws', async () => {
    await expect(
      bracketProseReversal(async () => {
        throw new Error('sweep failed')
      }),
    ).rejects.toThrow('sweep failed')
    expect(generationStore.getTxState().reversalInProgress).toBe(false)
  })

  it('cancels an in-flight classifier before running the body', async () => {
    const order: string[] = []
    let resolveTerminal!: () => void
    const terminal = new Promise<void>((r) => {
      resolveTerminal = r
    })
    const abortController = new AbortController()
    abortController.signal.addEventListener('abort', () => order.push('aborted'))
    generationStore.startRun({
      runId: 'run_c',
      kind: 'periodic-classifier',
      gateBehavior: 'no-gate',
      actionId: 'act_c',
      storyId: 'story_1',
      branchId: 'branch_1',
      abortController,
      currentPhase: '',
      intermediates: {},
      terminal,
      resolveTerminal,
    })
    const done = bracketProseReversal(async () => {
      order.push('swept')
    })
    expect(order).toEqual(['aborted'])
    resolveTerminal()
    await done
    expect(order).toEqual(['aborted', 'swept'])
  })

  it('rejects a nested bracket rather than silently dropping the barrier', async () => {
    await expect(
      bracketProseReversal(async () => {
        await bracketProseReversal(async () => {})
      }),
    ).rejects.toThrow('not re-entrant')
    expect(generationStore.getTxState().reversalInProgress).toBe(false)
  })
})

describe('classifierWatermarkClampOps', () => {
  async function seedBranch(status: ClassifierStatus | null) {
    const { db, runInTransaction } = await createTestDb()
    await db.insert(stories).values({ id: 's1', title: 'T', createdAt: 1, updatedAt: 1 })
    await db
      .insert(branches)
      .values({ id: 'b1', storyId: 's1', name: 'm', createdAt: 1, classifierStatus: status })
    const read = async () =>
      (await db.select().from(branches).where(eq(branches.id, 'b1')))[0].classifierStatus
    return { runInTransaction, read }
  }

  const status = (processedThrough: number | null): ClassifierStatus => ({
    state: 'failed-persistent',
    lastSuccessAt: 111,
    lastError: 'boom',
    retryCount: 3,
    processedThrough,
  })

  it('clamps to position(B) - 1, leaving the other keys of the blob intact', async () => {
    const { runInTransaction, read } = await seedBranch(status(9))
    await runInTransaction(classifierWatermarkClampOps('b1', 5))
    expect(await read()).toEqual({ ...status(9), processedThrough: 4 })
  })

  it('no-ops when the watermark is already at or below the clamp', async () => {
    const { runInTransaction, read } = await seedBranch(status(2))
    await runInTransaction(classifierWatermarkClampOps('b1', 5))
    expect(await read()).toEqual(status(2))
  })

  it('no-ops when the branch has no classifier status yet', async () => {
    const { runInTransaction, read } = await seedBranch(null)
    await runInTransaction(classifierWatermarkClampOps('b1', 5))
    expect(await read()).toBeNull()
  })
})
