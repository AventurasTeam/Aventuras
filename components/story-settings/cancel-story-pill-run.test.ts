// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PERIODIC_CLASSIFIER_KIND } from '@/lib/classifier'
import { definePipeline, startPipeline, type PhaseContext, type PhaseResult } from '@/lib/pipeline'
import { makeHarness, resetSingletons } from '@/lib/pipeline/__tests__/harness'
import { generationStore, selectMemoryRun } from '@/lib/stores'

import { useStoryGenerationGate } from './generation-run'

async function* holdUntilAborted({
  abortSignal,
}: PhaseContext): AsyncGenerator<never, PhaseResult> {
  if (!abortSignal.aborted)
    await new Promise<void>((resolve) =>
      abortSignal.addEventListener('abort', () => resolve(), { once: true }),
    )
  return { status: 'aborted' }
}

describe("the pill's Cancel on a pass", () => {
  beforeEach(() => {
    resetSingletons()
  })
  afterEach(() => {
    cleanup()
    resetSingletons()
  })

  it('ends the pass and leaves it deferred to the next Send', async () => {
    const { ctx } = await makeHarness()
    definePipeline({
      kind: PERIODIC_CLASSIFIER_KIND,
      phases: [{ name: 'held', run: holdUntilAborted }],
      affordance: 'pill-and-banner',
      gateBehavior: 'hard-gate',
      interruptible: 'pass',
      concurrencyPolicy: {},
    })
    const started = startPipeline(PERIODIC_CLASSIFIER_KIND, ctx)
    await vi.waitFor(() =>
      expect(selectMemoryRun(generationStore.getTxState(), { branchId: 'b1' })?.currentPhase).toBe(
        'held',
      ),
    )
    const { result } = renderHook(() => useStoryGenerationGate('s1'))
    expect(result.current.activeRunKind).toBe(PERIODIC_CLASSIFIER_KIND)

    await act(async () => {
      result.current.cancelPillRun()
      expect(await started.origin).toMatchObject({ outcome: 'aborted' })
      await started.chain
    })

    expect(generationStore.getTxState().runs.size).toBe(0)
    expect(generationStore.getTxState().deferred.get('b1')).toEqual({ pass: true })
    expect(result.current.activeRunKind).toBeNull()
  })
})
