import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { deltas, pipelineRuns } from '@/lib/db'
import {
  definePipeline,
  runPipeline,
  type PhaseEmittedEvent,
  type PhaseResult,
} from '@/lib/pipeline'
import { generationStore } from '@/lib/stores'

import { expectRan, makeHarness, resetSingletons } from './harness'

const base = {
  affordance: 'pill-and-banner',
  gateBehavior: 'hard-gate',
  interruptible: 'pass',
  concurrencyPolicy: {},
} as const

describe('reversalInProgress guard scope at the delta choke point', () => {
  beforeEach(() => resetSingletons())
  afterEach(() => resetSingletons())

  // Mirrors bracketProseReversal: the flag rises before the interrupt aborts the pass, so a
  // write past the abort check must land to be reversed; refused, it'd fail the run, not defer it.
  it('lets an interruptible run already in flight land its periodic_classifier delta', async () => {
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
    definePipeline({ kind: 'memory-run', phases: [{ name: 'p', run: phase }], ...base })

    // The run starts before the flag rises, so the start check never applies to it: this pins
    // the choke point's scope, which refuses only user-originated sources.
    const inflight = runPipeline('memory-run', ctx)
    generationStore.setReversalInProgress(true)
    release()

    const result = expectRan(await inflight)
    expect(result.outcome).toBe('completed')
    expect(tailRan).toBe(true)
    // A 'noop'-coded rejection also completes the run and runs the tail, so the outcome
    // alone can't tell that apart from the burst actually landing.
    expect(await db.select().from(deltas)).toHaveLength(1)
  })

  it('refuses a fresh start of that kind while the flag is up', async () => {
    const { db, ctx } = await makeHarness()
    async function* phase(): AsyncGenerator<never, PhaseResult> {
      return { status: 'completed' }
    }
    definePipeline({ kind: 'memory-run', phases: [{ name: 'p', run: phase }], ...base })

    generationStore.setReversalInProgress(true)

    expect(await runPipeline('memory-run', ctx)).toEqual({
      outcome: 'rejected',
      blockedBy: 'reversal',
    })
    expect(await db.select().from(pipelineRuns)).toHaveLength(0)
  })
})
