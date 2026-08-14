import { describe, it, expect } from 'vitest'
import type { Branch, Checkpoint, StoryEntry } from '$lib/types'
import { buildLandmarks, entryNumber, resolveEntryByNumber } from './storyNavigation'

function entry(id: string, position: number, branchId: string | null = null): StoryEntry {
  return {
    id,
    storyId: 's1',
    type: 'narration',
    content: id,
    parentId: null,
    position,
    createdAt: position,
    metadata: null,
    branchId,
  }
}

function checkpoint(id: string, lastEntryId: string, name = id): Checkpoint {
  return {
    id,
    storyId: 's1',
    name,
    lastEntryId,
    lastEntryPreview: `${name} preview`,
    entryCount: 0,
    entriesSnapshot: [],
    charactersSnapshot: [],
    locationsSnapshot: [],
    itemsSnapshot: [],
    storyBeatsSnapshot: [],
    chaptersSnapshot: [],
    createdAt: 0,
  }
}

function branch(
  id: string,
  forkEntryId: string,
  name = id,
  checkpointId: string | null = null,
): Branch {
  return {
    id,
    storyId: 's1',
    name,
    parentBranchId: null,
    forkEntryId,
    checkpointId,
    createdAt: 0,
  }
}

const contiguous = [entry('e0', 0), entry('e1', 1), entry('e2', 2), entry('e3', 3)]

describe('entryNumber', () => {
  it('is one-based, so the last number equals the entry count', () => {
    expect(entryNumber(contiguous[0])).toBe(1)
    expect(entryNumber(contiguous[contiguous.length - 1])).toBe(contiguous.length)
  })
})

describe('resolveEntryByNumber', () => {
  it('lands on the entry with that number', () => {
    expect(resolveEntryByNumber(contiguous, 3)?.id).toBe('e2')
  })

  it('lands on the nearest lower entry when the number falls in a gap', () => {
    const gapped = [entry('a', 0), entry('b', 1), entry('e', 40)]
    expect(resolveEntryByNumber(gapped, 20)?.id).toBe('b')
  })

  it('clamps a number below the first entry to the first entry', () => {
    expect(resolveEntryByNumber(contiguous, 0)?.id).toBe('e0')
    expect(resolveEntryByNumber(contiguous, -5)?.id).toBe('e0')
  })

  it('clamps a number past the last entry to the last entry', () => {
    expect(resolveEntryByNumber(contiguous, 9999)?.id).toBe('e3')
  })

  it('clamps below the first entry when the branch does not start at position 0', () => {
    // A branch view always starts at 0, but a caller holding a slice should still land
    // somewhere rather than on nothing.
    const slice = [entry('x', 10), entry('y', 11)]
    expect(resolveEntryByNumber(slice, 2)?.id).toBe('x')
  })

  it('handles a single-entry branch at either end', () => {
    const single = [entry('only', 0)]
    expect(resolveEntryByNumber(single, 1)?.id).toBe('only')
    expect(resolveEntryByNumber(single, 0)?.id).toBe('only')
    expect(resolveEntryByNumber(single, 50)?.id).toBe('only')
  })

  it('returns null for an empty branch', () => {
    expect(resolveEntryByNumber([], 1)).toBeNull()
  })

  it('accepts a numeric string', () => {
    expect(resolveEntryByNumber(contiguous, ' 2 ')?.id).toBe('e1')
  })

  it('returns null for empty or non-numeric input', () => {
    expect(resolveEntryByNumber(contiguous, '')).toBeNull()
    expect(resolveEntryByNumber(contiguous, '   ')).toBeNull()
    expect(resolveEntryByNumber(contiguous, 'twelve')).toBeNull()
    expect(resolveEntryByNumber(contiguous, '1.5')).toBeNull()
  })
})

describe('buildLandmarks', () => {
  // Main up to the fork at position 1, then the branch's own entries.
  const branchView = [
    entry('m0', 0),
    entry('m1', 1),
    entry('b2', 2, 'br1'),
    entry('b3', 3, 'br1'),
    entry('b4', 4, 'br1'),
  ]
  const br1 = branch('br1', 'm1', 'Betrayal', 'cp-origin')

  it('puts the origin first, followed by the branch checkpoints in number order', () => {
    const landmarks = buildLandmarks(
      branchView,
      [checkpoint('cp-late', 'b4'), checkpoint('cp-early', 'b2')],
      br1,
    )
    expect(landmarks.map((l) => [l.kind, l.number])).toEqual([
      ['origin', 2],
      ['checkpoint', 3],
      ['checkpoint', 5],
    ])
  })

  it('names the origin after the checkpoint the branch was forked from, not the branch', () => {
    const landmarks = buildLandmarks(
      branchView,
      [checkpoint('cp-origin', 'm1', 'Council of five')],
      br1,
    )
    expect(landmarks.map((l) => [l.kind, l.label])).toEqual([['origin', 'Council of five']])
    expect(landmarks[0].preview).toBe('Council of five preview')
  })

  it('falls back to a generic origin label when that checkpoint is gone', () => {
    // `checkpointId` is nullable for imported and legacy branches, and a checkpoint can be
    // deleted after the branch that came from it.
    const orphaned = buildLandmarks(branchView, [], branch('br1', 'm1', 'Betrayal', 'deleted-cp'))
    expect(orphaned.map((l) => [l.kind, l.label])).toEqual([['origin', 'Branch origin']])
  })

  it('omits the origin row on the main branch', () => {
    const mainView = [entry('m0', 0), entry('m1', 1)]
    const landmarks = buildLandmarks(mainView, [checkpoint('cp', 'm1')], null)
    expect(landmarks.map((l) => l.kind)).toEqual(['checkpoint'])
  })

  it('omits an origin whose entry is not loaded', () => {
    const landmarks = buildLandmarks(branchView, [], branch('br1', 'not-loaded', 'Betrayal'))
    expect(landmarks).toEqual([])
  })

  it('excludes checkpoints inherited from an ancestor branch', () => {
    // m1 is in view, but it belongs to main -- a new branch cannot be forked from it
    // while reading br1.
    const landmarks = buildLandmarks(branchView, [checkpoint('cp-main', 'm1')], br1)
    expect(landmarks.map((l) => l.kind)).toEqual(['origin'])
  })

  it('excludes a checkpoint whose entry a rollback has deleted', () => {
    const landmarks = buildLandmarks(branchView, [checkpoint('cp', 'gone')], br1)
    expect(landmarks.map((l) => l.kind)).toEqual(['origin'])
  })

  it('returns nothing for a main branch with no checkpoints', () => {
    expect(buildLandmarks([entry('m0', 0)], [], null)).toEqual([])
  })

  it('carries the checkpoint name and preview onto the row', () => {
    const [, row] = buildLandmarks(branchView, [checkpoint('cp', 'b2', 'Before the duel')], br1)
    expect(row.label).toBe('Before the duel')
    expect(row.preview).toBe('Before the duel preview')
  })
})
