import { describe, it, expect } from 'vitest'
import { mergeGenerators, pLimit } from './async'

describe('pLimit', () => {
  it('throws on invalid concurrency inputs', () => {
    expect(() => pLimit(0)).toThrow(TypeError)
    expect(() => pLimit(-1)).toThrow(TypeError)
    expect(() => pLimit(NaN)).toThrow(TypeError)
    expect(() => pLimit(1.5)).toThrow(TypeError)
  })

  it('limits concurrency to the specified number', async () => {
    const limit = pLimit(2)
    let active = 0
    let maxActive = 0

    const task = async () => {
      active++
      maxActive = Math.max(maxActive, active)
      await new Promise((resolve) => setTimeout(resolve, 10))
      active--
    }

    await Promise.all([limit(task), limit(task), limit(task), limit(task)])

    expect(maxActive).toBeLessThanOrEqual(2)
  })

  it('does not leak slots when tasks throw synchronously', async () => {
    const limit = pLimit(1)
    let ranNext = false

    const failingTask = () => {
      throw new Error('Sync fail')
    }

    const nextTask = async () => {
      ranNext = true
    }

    await expect(limit(failingTask)).rejects.toThrow('Sync fail')
    await limit(nextTask)

    expect(ranNext).toBe(true)
  })
})

describe('mergeGenerators cleanup', () => {
  /** Cleanup is started but not awaited, so let the queued `return()` calls land. */
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

  /** A generator that records whether its own cleanup ran. */
  function tracked(values: string[], cleanup: { closed: boolean }) {
    return (async function* () {
      try {
        for (const v of values) yield v
        return 'done'
      } finally {
        cleanup.closed = true
      }
    })()
  }

  it('closes its siblings when one of them throws', async () => {
    const survivor = { closed: false }
    const merged = mergeGenerators({
      thrower: (async function* () {
        yield 'a'
        throw new Error('boom')
      })(),
      other: tracked(['b', 'c', 'd', 'e'], survivor),
    })

    await expect(
      (async () => {
        for await (const _ of merged) void _
      })(),
    ).rejects.toThrow('boom')

    await settle()
    // Without this the sibling's `finally` never runs, so anything it owns stays open.
    expect(survivor.closed).toBe(true)
  })

  it('closes its generators when the consumer walks away', async () => {
    const first = { closed: false }
    const second = { closed: false }
    const merged = mergeGenerators({
      a: tracked(['1', '2', '3'], first),
      b: tracked(['4', '5', '6'], second),
    })

    await merged.next()
    await merged.return({} as never)

    await settle()
    expect(first.closed).toBe(true)
    expect(second.closed).toBe(true)
  })

  it('still returns every result on the ordinary path', async () => {
    const merged = mergeGenerators({
      a: (async function* () {
        yield 'x'
        return 'ra'
      })(),
      b: (async function* () {
        yield 'y'
        return 'rb'
      })(),
    })

    const seen: unknown[] = []
    for (;;) {
      const next = await merged.next()
      if (next.done) {
        expect(next.value).toEqual({ a: 'ra', b: 'rb' })
        break
      }
      seen.push(next.value)
    }
    expect([...seen].sort()).toEqual(['x', 'y'])
  })
})

describe('mergeGenerators cleanup is not blocking', () => {
  it('propagates the failure without waiting on a sibling read that has not answered', async () => {
    let releaseSibling: (() => void) | undefined
    const merged = mergeGenerators({
      thrower: (async function* () {
        yield 'a'
        throw new Error('boom')
      })(),
      // Stands in for a phase whose model call has not come back. `return()` on this
      // generator queues behind the pending `next()`, so awaiting cleanup would hang here.
      stuck: (async function* () {
        yield 'b'
        await new Promise<void>((resolve) => {
          releaseSibling = resolve
        })
        yield 'c'
      })(),
    })

    await expect(
      (async () => {
        for await (const _ of merged) void _
      })(),
    ).rejects.toThrow('boom')

    releaseSibling?.()
  })
})
