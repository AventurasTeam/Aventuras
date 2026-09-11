import { describe, it, expect, vi } from 'vitest'
import { GenerationLease } from './generationLease'

function deferred<T = void>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('GenerationLease', () => {
  it('releases through its holder when nothing was deferred', async () => {
    const onRelease = vi.fn()
    const lease = new GenerationLease('story-1', 'branch-a', onRelease)

    expect(lease.branchId).toBe('branch-a')
    expect(onRelease).not.toHaveBeenCalled()

    await lease.finish()

    expect(onRelease).toHaveBeenCalledTimes(1)
    expect(lease.isFinished).toBe(true)
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

  it('runs a deferred restore before releasing, never after', async () => {
    const order: string[] = []
    const lease = new GenerationLease('story-1', null, () => order.push('release'))

    lease.deferRestore(async () => {
      order.push('restore')
    })
    await lease.finish()

    expect(order).toEqual(['restore', 'release'])
  })

  it('does not release while a deferred restore is still running', async () => {
    const onRelease = vi.fn()
    const lease = new GenerationLease('story-1', null, onRelease)
    const restoring = deferred()

    lease.deferRestore(() => restoring.promise)
    const finishing = lease.finish()

    await Promise.resolve()
    expect(onRelease).not.toHaveBeenCalled()

    restoring.resolve()
    await finishing
    expect(onRelease).toHaveBeenCalledTimes(1)
  })

  it('settles the waiter once the deferred restore has run', async () => {
    const lease = new GenerationLease('story-1', null, vi.fn())
    const settled = lease.deferRestore(async () => {})
    expect(settled).not.toBeNull()

    await lease.finish()
    await expect(settled).resolves.toBeUndefined()
  })

  it('releases even when the deferred restore throws, and reports it to the waiter', async () => {
    const onRelease = vi.fn()
    const lease = new GenerationLease('story-1', null, onRelease)
    const boom = new Error('restore refused')

    const settled = lease.deferRestore(async () => {
      throw boom
    })
    const waiting = expect(settled).rejects.toThrow('restore refused')

    await lease.finish()
    await waiting

    // A leaked lease would leave branch switching dead with no generation to explain it.
    expect(onRelease).toHaveBeenCalledTimes(1)
  })

  it('is idempotent: a second finish neither re-releases nor re-runs the restore', async () => {
    const onRelease = vi.fn()
    const restore = vi.fn(async () => {})
    const lease = new GenerationLease('story-1', null, onRelease)

    lease.deferRestore(restore)
    await lease.finish()
    await lease.finish()

    expect(restore).toHaveBeenCalledTimes(1)
    expect(onRelease).toHaveBeenCalledTimes(1)
  })

  it('keeps the first deferred restore, so its waiter cannot be stranded', async () => {
    const onRelease = vi.fn()
    const lease = new GenerationLease('story-1', null, onRelease)
    const first = vi.fn(async () => {})
    const second = vi.fn(async () => {})

    const firstWaiter = lease.deferRestore(first)
    const secondWaiter = lease.deferRestore(second)

    // Replacing it would leave firstWaiter pending forever.
    expect(secondWaiter).toBe(firstWaiter)

    await lease.finish()
    await expect(firstWaiter).resolves.toBeUndefined()
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).not.toHaveBeenCalled()
  })

  it('refuses to defer onto a finished lease, so the caller acts directly instead', async () => {
    const lease = new GenerationLease('story-1', null, vi.fn())
    await lease.finish()

    const restore = vi.fn(async () => {})
    expect(lease.deferRestore(restore)).toBeNull()
    expect(restore).not.toHaveBeenCalled()
  })
})
