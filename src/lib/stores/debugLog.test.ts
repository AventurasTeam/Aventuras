import { describe, it, expect, beforeEach } from 'vitest'

import { DebugLog, type DebugLogChange, type DebugLogEntry } from './debugLog'

let log: DebugLog
let changes: DebugLogChange[]

const entry = (id: string): DebugLogEntry => ({
  id,
  timestamp: 1,
  type: 'request',
  serviceName: 's',
  data: {},
})

beforeEach(() => {
  log = new DebugLog()
  log.active = true
  changes = []
  log.onChange((change) => changes.push(change))
})

describe('DebugLog while inactive', () => {
  it('drops requests and responses', () => {
    log.active = false

    expect(log.addRequest('svc', {})).toBe('')
    log.addResponse('x', 'svc', {}, 0)

    expect(log.snapshot()).toEqual([])
    expect(changes).toEqual([])
  })

  it('still takes mirrored entries, which the pop-out relies on', () => {
    log.active = false

    log.upsert(entry('a'))

    expect(log.count).toBe(1)
  })
})

describe('DebugLog requests', () => {
  it('returns an id that pairs with the response', () => {
    const id = log.addRequest('svc', { url: 'u' })
    log.addResponse(id, 'svc', { status: 200 }, Date.now())

    expect(log.snapshot().map((e) => e.id)).toEqual([id, `${id}-response`])
    expect(log.requestCount).toBe(1)
  })

  it('gives a reused debug id a fresh suffix instead of colliding', () => {
    expect(log.addRequest('svc', {}, 'turn')).toBe('turn')
    const second = log.addRequest('svc', {}, 'turn')

    expect(second).not.toBe('turn')
    expect(second.startsWith('turn-')).toBe(true)
  })

  it('also avoids an id whose response is already logged', () => {
    log.addResponse('turn', 'svc', {}, 0)

    expect(log.addRequest('svc', {}, 'turn')).not.toBe('turn')
  })
})

describe('DebugLog responses', () => {
  it('merges a later response into the entry, as a new object', () => {
    log.addResponse('r', 'svc', { status: 200 }, Date.now())
    const first = log.snapshot()[0]

    log.addResponse('r', 'svc', { body: 'b' }, Date.now(), 'oops')
    const [merged] = log.snapshot()

    expect(log.count).toBe(1)
    expect(merged).not.toBe(first)
    expect(first.data).toEqual({ status: 200 })
    expect(merged.data).toEqual({ status: 200, body: 'b' })
    expect(merged.error).toBe('oops')
  })

  it('keeps an earlier error when a later write has none', () => {
    log.addResponse('r', 'svc', {}, 0, 'first')
    log.addResponse('r', 'svc', { more: true }, 0)

    expect(log.snapshot()[0].error).toBe('first')
  })
})

describe('DebugLog capacity and changes', () => {
  it('keeps the newest 100 entries', () => {
    for (let i = 0; i < 105; i++) log.upsert(entry(`e${i}`))

    expect(log.count).toBe(100)
    expect(log.snapshot()[0].id).toBe('e5')
  })

  it('reports each write, and a reset, to the listener', () => {
    const first = entry('a')
    const replaced = { ...first, serviceName: 'changed' }
    log.upsert(first)
    log.upsert(replaced)
    log.reset()

    expect(changes).toEqual([
      { kind: 'entry', entry: first },
      { kind: 'entry', entry: replaced },
      { kind: 'reset' },
    ])
    expect(log.count).toBe(0)
  })

  it('hands out a copy, so callers cannot reorder the log', () => {
    log.upsert(entry('a'))
    log.snapshot().pop()

    expect(log.count).toBe(1)
  })
})
