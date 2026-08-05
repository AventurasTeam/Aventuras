import { describe, expect, it } from 'vitest'

import { buildClassifierWindow } from './window'

const entry = (position: number, id: string, kind = 'ai_reply') =>
  ({ id, position, kind, content: `prose ${position}` }) as never

describe('buildClassifierWindow', () => {
  it('spans (processedThrough, head] and handles turns t1..tN in position order', () => {
    const w = buildClassifierWindow({
      entries: [entry(1, 'e1'), entry(2, 'e2'), entry(3, 'e3')],
      processedThrough: 1,
      maxEntries: 20,
    })
    expect(w.turns.map((t) => t.handle)).toEqual(['t1', 't2'])
    expect(w.turns.map((t) => t.entryId)).toEqual(['e2', 'e3'])
    expect(w.coversThrough).toBe(3)
    expect(w.headHandle).toBe('t2')
  })

  it('treats a null watermark as "nothing processed yet"', () => {
    const w = buildClassifierWindow({
      entries: [entry(1, 'e1'), entry(2, 'e2')],
      processedThrough: null,
      maxEntries: 20,
    })
    expect(w.turns).toHaveLength(2)
    expect(w.coversThrough).toBe(2)
  })

  it('caps the window and advances the watermark only to the cut', () => {
    // 40 entries, watermark 12 -> 28 candidates, so the cap of 20 actually bites.
    const entries = Array.from({ length: 40 }, (_, i) => entry(i + 1, `e${i + 1}`))
    const w = buildClassifierWindow({ entries, processedThrough: 12, maxEntries: 20 })
    expect(w.turns).toHaveLength(20)
    expect(w.turns[0].entryId).toBe('e13')
    // Only to the cut (position 32), not to head (40): the rest drains next pass.
    expect(w.coversThrough).toBe(32)
    expect(w.truncated).toBe(true)
  })

  it('does not report truncation when the window fits under the cap', () => {
    const entries = Array.from({ length: 28 }, (_, i) => entry(i + 1, `e${i + 1}`))
    const w = buildClassifierWindow({ entries, processedThrough: 12, maxEntries: 20 })
    expect(w.turns).toHaveLength(16)
    expect(w.coversThrough).toBe(28)
    expect(w.truncated).toBe(false)
  })

  it('excludes system entries from the prose but not from the position math', () => {
    const w = buildClassifierWindow({
      entries: [entry(1, 'e1'), entry(2, 'e2', 'system'), entry(3, 'e3')],
      processedThrough: 0,
      maxEntries: 20,
    })
    expect(w.turns.map((t) => t.entryId)).toEqual(['e1', 'e3'])
    expect(w.coversThrough).toBe(3)
  })

  it('is empty when the watermark is already at head', () => {
    const w = buildClassifierWindow({
      entries: [entry(1, 'e1')],
      processedThrough: 1,
      maxEntries: 20,
    })
    expect(w.turns).toEqual([])
    expect(w.isEmpty).toBe(true)
  })

  it('resolves a known handle and falls back to the window head for an unknown one', () => {
    const w = buildClassifierWindow({
      entries: [entry(1, 'e1'), entry(2, 'e2')],
      processedThrough: 0,
      maxEntries: 20,
    })
    expect(w.resolveHandle('t1')).toEqual({ entryId: 'e1', fellBack: false })
    expect(w.resolveHandle('t99')).toEqual({ entryId: 'e2', fellBack: true })
    expect(w.resolveHandle(undefined)).toEqual({ entryId: 'e2', fellBack: true })
  })
})
