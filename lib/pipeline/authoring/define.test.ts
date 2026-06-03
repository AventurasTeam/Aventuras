import { describe, expect, it } from 'vitest'

import { definePhase } from './define'
import type { PhaseResult } from '../types'

async function* run(): AsyncGenerator<never, PhaseResult> {
  return { status: 'completed' }
}

describe('definePhase', () => {
  it('pairs a name with its phase fn (no reference copy)', () => {
    const node = definePhase('synthesis', run)
    expect(node).toEqual({ name: 'synthesis', run })
    expect(node.run).toBe(run)
  })
})
