import { describe, it, expect, vi } from 'vitest'
import { GenerationLease } from './generationLease'

describe('GenerationLease', () => {
  it('releases through its holder', () => {
    const onRelease = vi.fn()
    const lease = new GenerationLease('story-1', 'branch-a', onRelease)

    expect(lease.branchId).toBe('branch-a')
    expect(onRelease).not.toHaveBeenCalled()

    lease.finish()

    expect(onRelease).toHaveBeenCalledTimes(1)
  })

  it('carries a null branch for the main branch without conflating it', () => {
    expect(new GenerationLease('story-1', null, vi.fn()).branchId).toBeNull()
  })

  it('carries the story too, so two stories on main are distinguishable', () => {
    const a = new GenerationLease('story-1', null, vi.fn())
    const b = new GenerationLease('story-2', null, vi.fn())

    // Both are on main, so the branch alone says nothing about which story a write belongs to.
    expect(a.branchId).toBe(b.branchId)
    expect(a.storyId).not.toBe(b.storyId)
  })

  it('is idempotent: a second finish does not release again', () => {
    const onRelease = vi.fn()
    const lease = new GenerationLease('story-1', null, onRelease)

    lease.finish()
    lease.finish()

    expect(onRelease).toHaveBeenCalledTimes(1)
  })
})
