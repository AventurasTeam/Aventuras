import { afterEach, describe, expect, it } from 'vitest'

import { definePipeline } from './define'
import { __resetRegistry, getPipeline } from './registry'
import type { PhaseResult } from '../types'

afterEach(() => __resetRegistry())

async function* ok(): AsyncGenerator<never, PhaseResult> {
  return { status: 'completed' }
}

const base = { affordance: 'invisible', gateBehavior: 'hard-gate', concurrencyPolicy: {} } as const

describe('pipeline registry', () => {
  it('registers and resolves a pipeline', () => {
    definePipeline({ kind: 'synthetic', phases: [{ name: 'p', run: ok }], ...base })
    expect(getPipeline('synthetic').kind).toBe('synthetic')
  })

  it('rejects empty phases and duplicate kinds and duplicate phase names', () => {
    expect(() => definePipeline({ kind: 'empty', phases: [], ...base })).toThrow()
    definePipeline({ kind: 'dup', phases: [{ name: 'p', run: ok }], ...base })
    expect(() =>
      definePipeline({ kind: 'dup', phases: [{ name: 'p', run: ok }], ...base }),
    ).toThrow()
    expect(() =>
      definePipeline({
        kind: 'dupname',
        phases: [
          { name: 'p', run: ok },
          { name: 'p', run: ok },
        ],
        ...base,
      }),
    ).toThrow()
  })

  it('rejects duplicate names across parallel branches', () => {
    expect(() =>
      definePipeline({
        kind: 'pdup',
        phases: [
          {
            name: 'group',
            parallel: [
              { name: 'x', run: ok },
              { name: 'x', run: ok },
            ],
          },
        ],
        ...base,
      }),
    ).toThrow()
  })
})
