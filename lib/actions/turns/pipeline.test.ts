import { describe, expect, it } from 'vitest'

import { makeLogger } from '@/lib/diagnostics'
import { getPipeline } from '@/lib/pipeline'

import { ensurePerTurnPipelineRegistered, PER_TURN_KIND } from './pipeline'

describe('per-turn pipeline declaration', () => {
  it('registers phase 0 user-action-translation then narrative, aligned to canonical V1', () => {
    ensurePerTurnPipelineRegistered()
    const p = getPipeline(PER_TURN_KIND)
    expect(p.phases.map((n) => n.name)).toEqual(['user-action-translation', 'narrative'])
    expect(p.affordance).toBe('pill-and-banner')
    expect(p.concurrencyPolicy.blockedBy).toEqual(['per-turn', 'chapter-close'])
    // phase 0 declares no resolver: the en short-circuit makes no LLM call
    expect(p.phases[0]).not.toHaveProperty('resolves')
  })

  it('user-action-translation short-circuits: yields no events, completes', async () => {
    ensurePerTurnPipelineRegistered()
    const phase0 = getPipeline(PER_TURN_KIND).phases[0]
    if (!phase0 || !('run' in phase0)) throw new Error('expected a single-run phase node')
    const ctx = {
      actionId: 'act_1',
      abortSignal: new AbortController().signal,
      intermediates: {},
      log: makeLogger('act_1'),
      db: {} as never,
      storyId: 's1',
      branchId: 'b1',
    }
    const gen = phase0.run(ctx)
    const result = await gen.next()
    // done:true on the FIRST next() proves it yielded no events (no delta / no
    // translation row) and returned completed — the same-language short-circuit.
    expect(result).toEqual({ done: true, value: { status: 'completed' } })
  })
})
