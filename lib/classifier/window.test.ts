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

  // The template labels each turn as the prose that produced a fact, so a
  // persisted <suggestions> block would offer actions the story never took as
  // narration, and <state> would hand back opaque ids beside the handle
  // convention the model is asked to follow.
  it('carries prose only, not the persisted trailing blocks', () => {
    const withBlocks = {
      id: 'e1',
      position: 1,
      kind: 'ai_reply',
      content:
        'The hall is cold.\n<state><summary>Kara waits</summary></state>\n<suggestions><item category="cat1">Ask Kara Vex</item></suggestions>',
    } as never
    const typed = {
      id: 'e2',
      position: 2,
      kind: 'user_action',
      content: 'I check the <state> of the door.',
    } as never

    const w = buildClassifierWindow({
      entries: [withBlocks, typed],
      processedThrough: null,
      maxEntries: 20,
    })

    expect(w.turns[0]?.content).toBe('The hall is cold.')
    // A user typing the tag is writing prose, not markup — their tail stays.
    expect(w.turns[1]?.content).toBe('I check the <state> of the door.')
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

// classifier.md → What the classifier reads: each turn carries the scene saved on it.
describe('saved scene per turn', () => {
  const scened = (
    position: number,
    id: string,
    kind: string,
    metadata: { sceneEntities: string[]; currentLocationId: string | null } | null,
  ) => ({ id, position, kind, content: `prose ${position}`, metadata }) as never

  const w = buildClassifierWindow({
    entries: [
      scened(1, 'e1', 'ai_reply', {
        sceneEntities: ['char_a', 'item_b'],
        currentLocationId: 'loc_c',
      }),
      // A user action carries the scene submitTurn inherited onto it.
      scened(2, 'e2', 'user_action', { sceneEntities: ['char_d'], currentLocationId: null }),
      scened(3, 'e3', 'ai_reply', null),
    ],
    processedThrough: 0,
    maxEntries: 20,
  })

  it("copies each entry's sceneEntities and currentLocationId onto its turn", () => {
    expect(w.turns.map((t) => [t.sceneEntities, t.currentLocationId])).toEqual([
      [['char_a', 'item_b'], 'loc_c'],
      [['char_d'], null],
      [[], null],
    ])
  })

  it('returns the saved scene of the turn a handle names, the head included', () => {
    expect(w.sceneOf('t1')).toEqual(new Set(['char_a', 'item_b']))
    expect(w.sceneOf('t2')).toEqual(new Set(['char_d']))
    // Naming the head directly is not a fallback: its own (empty) scene comes back.
    expect(w.sceneOf('t3')).toEqual(new Set())
  })

  it('returns null for a handle that falls back to the window head', () => {
    const headed = buildClassifierWindow({
      entries: [
        scened(1, 'e1', 'ai_reply', { sceneEntities: ['char_a'], currentLocationId: null }),
      ],
      processedThrough: 0,
      maxEntries: 20,
    })
    expect(headed.sceneOf('t9')).toBeNull()
    expect(headed.sceneOf(undefined)).toBeNull()
  })
})
