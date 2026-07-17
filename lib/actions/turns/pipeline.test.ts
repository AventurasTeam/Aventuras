import { describe, expect, it } from 'vitest'

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
})
