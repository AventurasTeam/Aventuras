import { describe, it, expect } from 'vitest'
import type { StoryEntry, TimeAnchor, TimeTracker } from '$lib/types'
import { listBoundaries, selectableRanges, refuseRange } from './boundaries'

function t(hours: number, minutes = 0): TimeTracker {
  return { years: 0, days: 0, hours, minutes }
}

function entry(id: string, end: TimeTracker | null, branchId: string | null = null): StoryEntry {
  return {
    id,
    storyId: 's1',
    type: 'narration',
    content: 'text',
    parentId: null,
    position: 0,
    createdAt: 0,
    metadata: end ? { timeStart: end, timeEnd: end } : null,
    branchId,
  } as StoryEntry
}

function anchor(entryId: string, assertedTime: TimeTracker): TimeAnchor {
  return { id: `a-${entryId}`, storyId: 's1', entryId, assertedTime, note: null, createdAt: 0 }
}

describe('listBoundaries', () => {
  it('opens on the first entry, closes on the last, and includes anchors between', () => {
    const entries = [entry('A', t(1)), entry('B', t(2)), entry('C', t(3)), entry('D', t(4))]
    const boundaries = listBoundaries({ entries, anchors: [anchor('C', t(3))] })
    expect(boundaries.map((b) => [b.entryId, b.kind])).toEqual([
      ['A', 'story-start'],
      ['C', 'anchor'],
      ['D', 'story-end'],
    ])
  })

  it('does not make an unanchored entry a boundary', () => {
    const entries = [entry('A', t(1)), entry('B', t(2)), entry('C', t(3))]
    const boundaries = listBoundaries({ entries, anchors: [] })
    expect(boundaries.map((b) => b.entryId)).toEqual(['A', 'C'])
  })

  it('resolves an anchored boundary to the assertion over a differing stored ending', () => {
    const entries = [entry('A', t(1)), entry('B', t(2)), entry('C', t(3))]
    const boundaries = listBoundaries({ entries, anchors: [anchor('B', t(9))] })
    expect(boundaries.find((b) => b.entryId === 'B')!.time).toEqual(t(9))
  })

  it('leaves a boundary without a time unusable', () => {
    const entries = [entry('A', null), entry('B', t(2))]
    const boundaries = listBoundaries({ entries, anchors: [] })
    expect(boundaries.find((b) => b.entryId === 'A')!.time).toBeNull()
    expect(refuseRange(boundaries[0], boundaries[1])!.reason).toBe('unusable-boundary')
  })

  it('makes a fork point a boundary without displacing the story beginning', () => {
    const entries = [
      entry('A', t(1)),
      entry('B', t(2)),
      entry('C', t(3), 'br1'),
      entry('D', t(4), 'br1'),
    ]
    const boundaries = listBoundaries({ entries, anchors: [], forkEntryIds: ['B'] })
    expect(boundaries.map((b) => [b.entryId, b.kind])).toEqual([
      ['A', 'story-start'],
      ['B', 'fork'],
      ['D', 'story-end'],
    ])
  })

  it('walls the timeline at a fork belonging to another branch', () => {
    const entries = [entry('A', t(1)), entry('B', t(2)), entry('C', t(3)), entry('D', t(4))]
    const boundaries = listBoundaries({ entries, anchors: [], forkEntryIds: ['C'] })
    expect(boundaries.map((b) => b.entryId)).toEqual(['A', 'C', 'D'])
  })

  it('ignores a boundary whose entry is not visible here', () => {
    const entries = [entry('A', t(1)), entry('B', t(2))]
    const boundaries = listBoundaries({
      entries,
      anchors: [],
      forkEntryIds: ['elsewhere'],
      checkpointEntryIds: ['also-elsewhere'],
    })
    expect(boundaries.map((b) => b.entryId)).toEqual(['A', 'B'])
  })

  it('makes a checkpoint a boundary', () => {
    const entries = [entry('A', t(1)), entry('B', t(2)), entry('C', t(3))]
    const boundaries = listBoundaries({ entries, anchors: [], checkpointEntryIds: ['B'] })
    expect(boundaries.map((b) => [b.entryId, b.kind])).toEqual([
      ['A', 'story-start'],
      ['B', 'checkpoint'],
      ['C', 'story-end'],
    ])
  })

  it('gives an entry that is both anchored and natural a single boundary', () => {
    const entries = [entry('A', t(1)), entry('B', t(2)), entry('C', t(3))]
    const boundaries = listBoundaries({
      entries,
      anchors: [anchor('B', t(9))],
      checkpointEntryIds: ['B'],
      forkEntryIds: ['B'],
    })
    expect(boundaries).toHaveLength(3)
    expect(boundaries[1].kind).toBe('anchor')
    expect(boundaries[1].time).toEqual(t(9))
  })

  it('keeps the story beginning its own kind when a branch forked there', () => {
    const entries = [entry('A', t(1)), entry('B', t(2), 'br1'), entry('C', t(3), 'br1')]
    const boundaries = listBoundaries({ entries, anchors: [], forkEntryIds: ['A'] })
    expect(boundaries.map((b) => [b.entryId, b.kind])).toEqual([
      ['A', 'story-start'],
      ['C', 'story-end'],
    ])
  })

  it('yields no selectable range for a one-entry story', () => {
    const entries = [entry('A', t(1))]
    const boundaries = listBoundaries({ entries, anchors: [] })
    expect(boundaries).toHaveLength(1)
    expect(selectableRanges(entries, boundaries)).toEqual([])
  })

  it('does not modify the entries or anchors it reads', () => {
    const entries = [entry('A', t(1)), entry('B', t(2))]
    const anchors = [anchor('A', t(9))]
    const before = JSON.stringify({ entries, anchors })
    listBoundaries({ entries, anchors })
    expect(JSON.stringify({ entries, anchors })).toBe(before)
  })
})

describe('selectableRanges', () => {
  it('offers only the ranges on either side of an anchor, never across it', () => {
    const entries = [entry('A', t(1)), entry('B', t(2)), entry('C', t(3)), entry('D', t(4))]
    const boundaries = listBoundaries({ entries, anchors: [anchor('C', t(3))] })
    const ranges = selectableRanges(entries, boundaries)
    expect(ranges.map((r) => [r.from.entryId, r.to.entryId])).toEqual([
      ['A', 'C'],
      ['C', 'D'],
    ])
    expect(ranges.every((r) => !r.entryIds.includes('C') || r.to.entryId === 'C')).toBe(true)
  })

  it('covers the entries after the earlier boundary up to and including the later', () => {
    const entries = [entry('A', t(1)), entry('B', t(2)), entry('C', t(3))]
    const boundaries = listBoundaries({ entries, anchors: [] })
    expect(selectableRanges(entries, boundaries)[0].entryIds).toEqual(['B', 'C'])
  })

  it('offers a range on each side of a fork point, and none across it', () => {
    const entries = [
      entry('A', t(1)),
      entry('B', t(2)),
      entry('C', t(3), 'br1'),
      entry('D', t(4), 'br1'),
    ]
    const boundaries = listBoundaries({ entries, anchors: [], forkEntryIds: ['B'] })
    const ranges = selectableRanges(entries, boundaries)
    expect(ranges.map((r) => r.entryIds)).toEqual([['B'], ['C', 'D']])
    expect(ranges.every((r) => !r.entryIds.includes('B') || r.to.entryId === 'B')).toBe(true)
  })
})

describe('refuseRange', () => {
  it('permits equal boundary times', () => {
    const entries = [entry('A', t(9)), entry('B', t(9))]
    const boundaries = listBoundaries({ entries, anchors: [] })
    expect(refuseRange(boundaries[0], boundaries[1])).toBeNull()
  })

  it('refuses a backwards span and names both boundaries', () => {
    const entries = [entry('A', t(9)), entry('B', t(3))]
    const boundaries = listBoundaries({ entries, anchors: [] })
    const refusal = refuseRange(boundaries[0], boundaries[1])!
    expect(refusal.reason).toBe('backwards-span')
    expect(refusal.boundaries.map((b) => b.entryId)).toEqual(['A', 'B'])
  })
})
