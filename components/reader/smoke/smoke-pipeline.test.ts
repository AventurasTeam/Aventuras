import { afterEach, describe, expect, it } from 'vitest'

import { __resetRegistry, getPipeline } from '@/lib/pipeline'

import { SMOKE_KIND, ensureSmokePipelineRegistered } from './smoke-pipeline'

describe('smoke pipeline registration', () => {
  afterEach(() => __resetRegistry())

  it('registers a single-phase invisible no-gate pipeline', () => {
    ensureSmokePipelineRegistered()
    const pipeline = getPipeline(SMOKE_KIND)
    expect(pipeline.kind).toBe('smoke')
    expect(pipeline.phases).toHaveLength(1)
    expect(pipeline.affordance).toBe('invisible')
    expect(pipeline.gateBehavior).toBe('no-gate')
  })

  it('is idempotent across repeated calls (fast-refresh guard)', () => {
    ensureSmokePipelineRegistered()
    expect(() => ensureSmokePipelineRegistered()).not.toThrow()
    expect(getPipeline(SMOKE_KIND).phases).toHaveLength(1)
  })
})
