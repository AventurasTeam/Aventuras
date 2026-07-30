import { beforeEach, describe, expect, it } from 'vitest'

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
})

describe('classifierWatermarkClampOps', () => {
  it('clamps to position(B) - 1 when the watermark is above it', async () => {
    const ctx = {
      db: {
        select: () => ({
          from: () => ({
            where: () =>
              Promise.resolve([
                { classifierStatus: { state: 'idle', processedThrough: 9, retryCount: 0 } },
              ]),
          }),
        }),
        update: () => ({
          set: (values: unknown) => ({
            where: () => ({ toSQL: () => ({ sql: 'UPDATE branches', params: [values] }) }),
          }),
        }),
      },
    } as never
    const ops = await classifierWatermarkClampOps('branch_1', 5, ctx)
    expect(ops).toHaveLength(1)
    expect(JSON.stringify(ops[0])).toContain('"processedThrough":4')
  })

  it('emits no op when the watermark is already at or below the clamp', async () => {
    const ctx = {
      db: {
        select: () => ({
          from: () => ({
            where: () =>
              Promise.resolve([
                { classifierStatus: { state: 'idle', processedThrough: 2, retryCount: 0 } },
              ]),
          }),
        }),
      },
    } as never
    expect(await classifierWatermarkClampOps('branch_1', 5, ctx)).toEqual([])
  })

  it('emits no op when the branch has no classifier status yet', async () => {
    const ctx = {
      db: {
        select: () => ({
          from: () => ({ where: () => Promise.resolve([{ classifierStatus: null }]) }),
        }),
      },
    } as never
    expect(await classifierWatermarkClampOps('branch_1', 5, ctx)).toEqual([])
  })
})
