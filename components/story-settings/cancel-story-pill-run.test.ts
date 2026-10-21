import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PERIODIC_CLASSIFIER_KIND } from '@/lib/classifier'
import { definePipeline, startPipeline, type PhaseContext, type PhaseResult } from '@/lib/pipeline'
import { makeHarness, resetSingletons } from '@/lib/pipeline/__tests__/harness'
import { generationStore, selectMemoryRun } from '@/lib/stores'

import { cancelStoryPillRun } from './generation-run'

async function* holdUntilAborted({
  abortSignal,
}: PhaseContext): AsyncGenerator<never, PhaseResult> {
  if (!abortSignal.aborted)
    await new Promise<void>((resolve) =>
      abortSignal.addEventListener('abort', () => resolve(), { once: true }),
    )
  return { status: 'aborted' }
}

describe('cancelStoryPillRun on a pass', () => {
  beforeEach(() => {
    resetSingletons()
  })
  afterEach(() => {
    resetSingletons()
  })

  it('ends the pass and leaves it deferred to the next Send', async () => {
    const { ctx } = await makeHarness()
    definePipeline({
      kind: PERIODIC_CLASSIFIER_KIND,
      phases: [{ name: 'held', run: holdUntilAborted }],
      affordance: 'pill-and-banner',
      gateBehavior: 'hard-gate',
      interruptible: true,
      concurrencyPolicy: {},
    })
    const started = startPipeline(PERIODIC_CLASSIFIER_KIND, ctx)
    await vi.waitFor(() =>
      expect(selectMemoryRun(generationStore.getTxState(), { branchId: 'b1' })?.currentPhase).toBe(
        'held',
      ),
    )

    cancelStoryPillRun('s1')

    expect(await started.origin).toMatchObject({ outcome: 'aborted' })
    await started.chain
    expect(generationStore.getTxState().runs.size).toBe(0)
    expect(generationStore.getTxState().deferred.get('b1')).toEqual({ pass: true })
  })
})
