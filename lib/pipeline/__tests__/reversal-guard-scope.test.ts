import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { deltas } from '@/lib/db'
import {
  definePipeline,
  runPipeline,
  type PhaseEmittedEvent,
  type PhaseResult,
} from '@/lib/pipeline'
import { generationStore } from '@/lib/stores'

import { expectRan, makeHarness, resetSingletons } from './harness'

const base = { affordance: 'invisible', gateBehavior: 'no-gate', concurrencyPolicy: {} } as const

describe('reversalInProgress guard scope at the delta choke point', () => {
  beforeEach(() => resetSingletons())
  afterEach(() => resetSingletons())

  it('lets a no-gate run already in flight land its periodic_classifier delta and complete', async () => {
    const { db, ctx } = await makeHarness()
    let release!: () => void
    const gate = new Promise<void>((r) => {
      release = r
    })
    let tailRan = false

    async function* phase(): AsyncGenerator<PhaseEmittedEvent, PhaseResult> {
      await gate
      yield {
        type: 'delta_emitted',
        entryId: 'entry_1',
        action: {
          kind: 'createStoryEntry',
          source: 'periodic_classifier',
          payload: {
            entry: {
              id: 'entry_1',
              branchId: ctx.branchId,
              position: 1,
              kind: 'ai_reply',
              content: 'hi',
              createdAt: 1,
            },
          },
        },
      }
      tailRan = true
      return { status: 'completed' }
    }
    definePipeline({ kind: 'bg-classifier', phases: [{ name: 'p', run: phase }], ...base })

    // Mirrors bracketProseReversal: the run is parked past its own gate (the classifier's
    // LLM call) when the reversal flag flips, and its burst must still reach the delta log.
    const inflight = runPipeline('bg-classifier', ctx)
    generationStore.setReversalInProgress(true)
    release()

    const result = expectRan(await inflight)
    expect(result.outcome).toBe('completed')
    expect(tailRan).toBe(true)
    // A 'noop'-coded rejection also completes the run and runs the tail, so the outcome
    // alone can't tell that apart from the burst actually landing.
    expect(await db.select().from(deltas)).toHaveLength(1)
  })
})
