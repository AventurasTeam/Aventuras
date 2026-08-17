import { describe, expect, it } from 'vitest'

import { withKeyLock } from './key-lock'

function deferred<T = void>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

// The lock chains on promises, so pending work advances over microtasks; a
// macrotask hop is what guarantees every queued continuation has run.
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

describe('withKeyLock', () => {
  it('holds a second caller until the first settles', async () => {
    const started: string[] = []
    const first = deferred()
    const second = deferred()

    const a = withKeyLock('k', () => {
      started.push('a')
      return first.promise
    })
    const b = withKeyLock('k', () => {
      started.push('b')
      return second.promise
    })

    await flush()
    expect(started).toEqual(['a'])

    first.resolve()
    await a
    await flush()
    expect(started).toEqual(['a', 'b'])

    second.resolve()
    await b
  })

  // Two callers cannot distinguish a guarded cleanup from an unguarded one: the
  // first's delete only removes an entry the second has already replaced. It
  // takes a third caller arriving after the first settled — an unguarded
  // `inFlightByKey.delete(key)` leaves the map empty, so this caller finds no
  // predecessor and runs alongside the second, reopening the TOCTOU.
  it('serializes a third caller that arrives after the first has settled', async () => {
    const started: string[] = []
    const first = deferred()
    const second = deferred()
    const third = deferred()

    const a = withKeyLock('k3', () => {
      started.push('a')
      return first.promise
    })
    const b = withKeyLock('k3', () => {
      started.push('b')
      return second.promise
    })

    first.resolve()
    await a
    await flush()
    expect(started).toEqual(['a', 'b'])

    const c = withKeyLock('k3', () => {
      started.push('c')
      return third.promise
    })
    await flush()
    expect(started).toEqual(['a', 'b'])

    second.resolve()
    await b
    await flush()
    expect(started).toEqual(['a', 'b', 'c'])

    third.resolve()
    await c
  })

  it('does not serialize across distinct keys', async () => {
    const started: string[] = []
    const x = deferred()
    const y = deferred()

    const px = withKeyLock('kx', () => {
      started.push('x')
      return x.promise
    })
    const py = withKeyLock('ky', () => {
      started.push('y')
      return y.promise
    })

    await flush()
    expect(started).toEqual(['x', 'y'])

    x.resolve()
    y.resolve()
    await Promise.all([px, py])
  })

  it('surfaces a rejection to its own caller and still releases the key', async () => {
    const boom = new Error('boom')
    await expect(
      withKeyLock('kz', async () => {
        throw boom
      }),
    ).rejects.toBe(boom)
    // A swallowed rejection here would deadlock the key for every later caller.
    await expect(withKeyLock('kz', async () => 'after')).resolves.toBe('after')
  })

  it('releases the key once the queue drains, so a later caller starts at once', async () => {
    await withKeyLock('kd', async () => 'first')
    await flush()

    const started: string[] = []
    const pending = deferred()
    const later = withKeyLock('kd', () => {
      started.push('later')
      return pending.promise
    })
    await flush()
    expect(started).toEqual(['later'])

    pending.resolve()
    await later
  })
})
