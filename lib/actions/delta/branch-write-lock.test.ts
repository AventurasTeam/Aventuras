import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  __resetBranchWriteLocks,
  holdBranchWriteExclusive,
  releaseBranchWriteExclusive,
  withBranchWriteShared,
} from './branch-write-lock'

function deferred<T = void>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

// The lock advances over microtasks; a macrotask hop runs every queued continuation.
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

// Races a settled flag against timer turns, so a grant that never comes fails fast, not by timeout.
async function isSettled(promise: Promise<unknown>, turns = 1): Promise<boolean> {
  let settled = false
  promise.then(
    () => {
      settled = true
    },
    () => {
      settled = true
    },
  )
  for (let turn = 0; turn < turns; turn++) await flush()
  return settled
}

afterEach(() => {
  __resetBranchWriteLocks()
})

describe('withBranchWriteShared', () => {
  it('runs shared holders concurrently', async () => {
    const gate = deferred()
    const started: string[] = []

    const a = withBranchWriteShared('b1', 'act_a', async () => {
      started.push('a')
      await gate.promise
    })
    const b = withBranchWriteShared('b1', 'act_b', async () => {
      started.push('b')
      await gate.promise
    })
    await flush()

    expect(started).toEqual(['a', 'b'])
    gate.resolve()
    await Promise.all([a, b])
  })

  it('holds a write while another action holds the branch exclusive, and runs it on release', async () => {
    await holdBranchWriteExclusive('b1', 'act_pass')
    const run = vi.fn(async () => 'done')

    const write = withBranchWriteShared('b1', 'act_user', run)
    await flush()

    expect(run).not.toHaveBeenCalled()
    releaseBranchWriteExclusive('b1', 'act_pass')
    expect(await write).toBe('done')
  })

  it("passes the exclusive holder's own writes straight through", async () => {
    await holdBranchWriteExclusive('b1', 'act_pass')

    const own = withBranchWriteShared('b1', 'act_pass', async () => 'own')

    expect(await isSettled(own)).toBe(true)
    expect(await own).toBe('own')
    releaseBranchWriteExclusive('b1', 'act_pass')
  })

  it('does not count a pass-through write as a shared holder', async () => {
    await holdBranchWriteExclusive('b1', 'act_pass')
    const gate = deferred()
    const own = withBranchWriteShared('b1', 'act_pass', () => gate.promise)
    releaseBranchWriteExclusive('b1', 'act_pass')

    // The pass-through write is still running, yet the next exclusive is granted at once.
    expect(await isSettled(holdBranchWriteExclusive('b1', 'act_next'))).toBe(true)
    releaseBranchWriteExclusive('b1', 'act_next')
    gate.resolve()
    await own
  })

  it('releases a shared hold whose run throws, async or not', async () => {
    await expect(
      withBranchWriteShared('b1', 'act_a', async () => {
        throw new Error('async boom')
      }),
    ).rejects.toThrow('async boom')
    await expect(
      withBranchWriteShared('b1', 'act_b', () => {
        throw new Error('sync boom')
      }),
    ).rejects.toThrow('sync boom')

    expect(await isSettled(holdBranchWriteExclusive('b1', 'act_pass'))).toBe(true)
    releaseBranchWriteExclusive('b1', 'act_pass')
  })

  it('locks each branch on its own', async () => {
    await holdBranchWriteExclusive('b1', 'act_pass')

    expect(await withBranchWriteShared('b2', 'act_user', async () => 'other branch')).toBe(
      'other branch',
    )
    releaseBranchWriteExclusive('b1', 'act_pass')
  })
})

describe('holdBranchWriteExclusive', () => {
  it('waits for every shared holder to settle', async () => {
    const first = deferred()
    const second = deferred()
    const a = withBranchWriteShared('b1', 'act_a', () => first.promise)
    const b = withBranchWriteShared('b1', 'act_b', () => second.promise)

    const hold = holdBranchWriteExclusive('b1', 'act_pass')
    expect(await isSettled(hold)).toBe(false)
    first.resolve()
    await a

    // One holder settled; the other still writes, so the pass keeps waiting.
    expect(await isSettled(hold)).toBe(false)
    second.resolve()
    await b
    expect(await isSettled(hold)).toBe(true)
    releaseBranchWriteExclusive('b1', 'act_pass')
  })

  it('queues a later shared request behind a waiting exclusive, so edits cannot starve a pass', async () => {
    const first = deferred()
    const order: string[] = []
    const s1 = withBranchWriteShared('b1', 'act_s1', async () => {
      order.push('s1 start')
      await first.promise
      order.push('s1 end')
    })
    const hold = holdBranchWriteExclusive('b1', 'act_pass').then(() => {
      order.push('pass')
    })
    const s2 = withBranchWriteShared('b1', 'act_s2', async () => {
      order.push('s2')
    })
    await flush()

    // Only a shared holder is active, yet s2 waits behind the queued exclusive.
    expect(order).toEqual(['s1 start'])
    first.resolve()
    await hold
    await flush()
    expect(order).toEqual(['s1 start', 's1 end', 'pass'])
    releaseBranchWriteExclusive('b1', 'act_pass')
    await Promise.all([s1, s2])
    expect(order).toEqual(['s1 start', 's1 end', 'pass', 's2'])
  })

  it('grants queued requests in arrival order', async () => {
    await holdBranchWriteExclusive('b1', 'act_a')
    const gate = deferred()
    const order: string[] = []
    const shared = withBranchWriteShared('b1', 'act_user', async () => {
      order.push('user')
      await gate.promise
    })
    const holdB = holdBranchWriteExclusive('b1', 'act_b').then(() => {
      order.push('b')
    })

    releaseBranchWriteExclusive('b1', 'act_a')
    await flush()
    // The shared request arrived first, so it runs; b waits for it to settle.
    expect(order).toEqual(['user'])
    gate.resolve()
    await shared
    await holdB
    expect(order).toEqual(['user', 'b'])
    releaseBranchWriteExclusive('b1', 'act_b')
  })

  it('returns the pending acquisition to a repeat hold, which one release ends', async () => {
    const gate = deferred()
    const shared = withBranchWriteShared('b1', 'act_user', () => gate.promise)

    const first = holdBranchWriteExclusive('b1', 'act_pass')
    const second = holdBranchWriteExclusive('b1', 'act_pass')

    expect(second).toBe(first)
    gate.resolve()
    await shared
    await first
    // A settled acquisition is returned too.
    expect(holdBranchWriteExclusive('b1', 'act_pass')).toBe(first)
    releaseBranchWriteExclusive('b1', 'act_pass')

    // Had the repeat queued a second request, it would hold the branch again now.
    const write = withBranchWriteShared('b1', 'act_other', async () => 'free')
    expect(await isSettled(write)).toBe(true)
  })

  it('takes a fresh acquisition after a release', async () => {
    const before = holdBranchWriteExclusive('b1', 'act_pass')
    await before
    releaseBranchWriteExclusive('b1', 'act_pass')
    const gate = deferred()
    const shared = withBranchWriteShared('b1', 'act_user', () => gate.promise)

    const after = holdBranchWriteExclusive('b1', 'act_pass')

    expect(after).not.toBe(before)
    expect(await isSettled(after)).toBe(false)
    gate.resolve()
    await shared
    await after
    releaseBranchWriteExclusive('b1', 'act_pass')
  })
})

describe('releaseBranchWriteExclusive', () => {
  it('does nothing for an action that neither holds nor waits', async () => {
    await holdBranchWriteExclusive('b1', 'act_pass')

    releaseBranchWriteExclusive('b1', 'act_other')
    releaseBranchWriteExclusive('b2', 'act_pass')
    const run = vi.fn(async () => undefined)
    const write = withBranchWriteShared('b1', 'act_user', run)
    await flush()

    expect(run).not.toHaveBeenCalled()
    releaseBranchWriteExclusive('b1', 'act_pass')
    await write
    expect(run).toHaveBeenCalledOnce()
  })

  it("does nothing on a former holder's second call, while another action holds", async () => {
    await holdBranchWriteExclusive('b1', 'act_a')
    const holdB = holdBranchWriteExclusive('b1', 'act_b')
    releaseBranchWriteExclusive('b1', 'act_a')
    await holdB

    releaseBranchWriteExclusive('b1', 'act_a')
    const run = vi.fn(async () => undefined)
    const write = withBranchWriteShared('b1', 'act_user', run)
    await flush()

    expect(run).not.toHaveBeenCalled()
    releaseBranchWriteExclusive('b1', 'act_b')
    await write
    expect(run).toHaveBeenCalledOnce()
  })

  // A parallel branch of an aborted run may still await this request; it must never write.
  it('drops a queued request, leaving its promise pending forever', async () => {
    const gate = deferred()
    const shared = withBranchWriteShared('b1', 'act_user', () => gate.promise)
    const hold = holdBranchWriteExclusive('b1', 'act_a')

    releaseBranchWriteExclusive('b1', 'act_a')
    gate.resolve()
    await shared

    expect(await isSettled(hold, 3)).toBe(false)
    // The dropped request left the queue, so it wedges nothing.
    expect(await isSettled(holdBranchWriteExclusive('b1', 'act_b'))).toBe(true)
    releaseBranchWriteExclusive('b1', 'act_b')
  })

  it('lets a later shared write past a dropped request at once', async () => {
    const gate = deferred()
    const shared = withBranchWriteShared('b1', 'act_user', () => gate.promise)
    holdBranchWriteExclusive('b1', 'act_a')

    releaseBranchWriteExclusive('b1', 'act_a')

    // No exclusive waits any more, so writer preference no longer queues it.
    const write = withBranchWriteShared('b1', 'act_other', async () => 'joined')
    expect(await isSettled(write)).toBe(true)
    gate.resolve()
    await shared
  })
})
