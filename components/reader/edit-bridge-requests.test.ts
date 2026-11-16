import { describe, expect, it, vi } from 'vitest'

import { createEditRequests, type EditBridgeAnswer } from './edit-bridge-requests'

function manualClock() {
  const timers: { run: () => void; ms: number; cancelled: boolean }[] = []
  return {
    schedule: (run: () => void, ms: number) => {
      const timer = { run, ms, cancelled: false }
      timers.push(timer)
      return () => {
        timer.cancelled = true
      }
    },
    fire: (ms: number) => {
      for (const timer of timers) if (timer.ms === ms && !timer.cancelled) timer.run()
    },
    live: () => timers.filter((timer) => !timer.cancelled).length,
  }
}

function requests(clock = manualClock()) {
  return {
    clock,
    map: createEditRequests({ queryTimeoutMs: 2, commitTimeoutMs: 10, schedule: clock.schedule }),
  }
}

const DIRTY: EditBridgeAnswer = { kind: 'query', session: { entryId: 'e2', dirty: true } }

describe('createEditRequests', () => {
  it('resolves a request with the answer its id gets', async () => {
    const { map } = requests()
    let sent = ''
    const asked = map.ask('query', (id) => {
      sent = id
    })
    map.answer(sent, DIRTY)
    await expect(asked).resolves.toEqual({ entryId: 'e2', dirty: true })
  })

  it("resolves a commit with the document's result", async () => {
    const { map } = requests()
    let sent = ''
    const asked = map.ask('commit', (id) => {
      sent = id
    })
    map.answer(sent, { kind: 'commit', result: { ok: false, code: 'in-flight-gated' } })
    await expect(asked).resolves.toEqual({ ok: false, code: 'in-flight-gated' })
  })

  it('gives each request its own id', () => {
    const { map } = requests()
    const ids: string[] = []
    void map.ask('query', (id) => ids.push(id))
    void map.ask('query', (id) => ids.push(id))
    expect(new Set(ids).size).toBe(2)
  })

  it('reads unresponsive once a query outlives its timeout, and drops the late answer', async () => {
    const { map, clock } = requests()
    let sent = ''
    const asked = map.ask('query', (id) => {
      sent = id
    })
    clock.fire(10)
    clock.fire(2)
    await expect(asked).resolves.toBe('unresponsive')
    expect(() => map.answer(sent, DIRTY)).not.toThrow()
  })

  it('gives a commit the longer timeout', async () => {
    const { map, clock } = requests()
    const settled = vi.fn()
    void map.ask('commit', () => {}).then(settled)
    clock.fire(2)
    await Promise.resolve()
    expect(settled).not.toHaveBeenCalled()
    clock.fire(10)
    await vi.waitFor(() => expect(settled).toHaveBeenCalledWith('unresponsive'))
  })

  it('cancels the timeout once answered', async () => {
    const { map, clock } = requests()
    let sent = ''
    const asked = map.ask('query', (id) => {
      sent = id
    })
    expect(clock.live()).toBe(1)
    map.answer(sent, DIRTY)
    expect(clock.live()).toBe(0)
    await expect(asked).resolves.toEqual({ entryId: 'e2', dirty: true })
  })

  it('ignores an answer of the wrong kind', async () => {
    const { map, clock } = requests()
    let sent = ''
    const asked = map.ask('query', (id) => {
      sent = id
    })
    map.answer(sent, { kind: 'commit', result: { ok: true } })
    clock.fire(2)
    await expect(asked).resolves.toBe('unresponsive')
  })

  it('resolves everything waiting as no editor on a document boot', async () => {
    const { map } = requests()
    const query = map.ask('query', () => {})
    const commit = map.ask('commit', () => {})
    map.resetAll()
    await expect(query).resolves.toBeNull()
    await expect(commit).resolves.toEqual({ ok: true })
  })

  it('survives a send that throws, leaving the timeout to answer', async () => {
    const { map, clock } = requests()
    const asked = map.ask('query', () => {
      throw new TypeError('not a function')
    })
    clock.fire(2)
    await expect(asked).resolves.toBe('unresponsive')
  })
})
