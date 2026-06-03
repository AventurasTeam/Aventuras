import { afterEach, describe, expect, it } from 'vitest'

import type { RunState, TxState } from '@/lib/stores'

import { isUserEditBlocked } from './gate'
import { definePipeline } from '../authoring/define'
import { __resetRegistry } from '../authoring/registry'
import type { PhaseResult } from '../types'

afterEach(() => __resetRegistry())

async function* ok(): AsyncGenerator<never, PhaseResult> {
  return { status: 'completed' }
}

const base = { affordance: 'invisible', concurrencyPolicy: {} } as const

function run(kind: string): RunState {
  return {
    runId: `r_${kind}`,
    kind,
    actionId: 'a',
    storyId: null,
    branchId: 'b',
    abortController: new AbortController(),
    currentPhase: '',
    intermediates: {},
  }
}

const tx = (kinds: string[]): TxState => ({
  runs: new Map(kinds.map((k) => [run(k).runId, run(k)])),
})

describe('isUserEditBlocked', () => {
  it('blocks only when a hard-gate run is in flight', () => {
    definePipeline({
      kind: 'fg',
      phases: [{ name: 'p', run: ok }],
      gateBehavior: 'hard-gate',
      ...base,
    })
    definePipeline({
      kind: 'bg',
      phases: [{ name: 'p', run: ok }],
      gateBehavior: 'no-gate',
      ...base,
    })
    expect(isUserEditBlocked(tx([]))).toBe(false)
    expect(isUserEditBlocked(tx(['bg']))).toBe(false)
    expect(isUserEditBlocked(tx(['bg', 'fg']))).toBe(true)
  })
})
