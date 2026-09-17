import { describe, it, expect } from 'vitest'
import type { Branch, Checkpoint, StoryEntry } from '$lib/types'
import {
  branchesUsingCheckpoint,
  buildLandmarks,
  checkpointsOnBranch,
  checkpointDeletionBlocker,
  entryNumber,
  entryNumberRange,
  jumpToEntry,
  resolveEntryByNumber,
  type EntryJumpUi,
} from './storyNavigation'

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

function checkpoint(
  id: string,
  lastEntryId: string,
  name = id,
  { branchId = null, anchored = true, createdAt = 0 }: Partial<Checkpoint> = {},
): Checkpoint {
  return {
    id,
    storyId: 's1',
    name,
    lastEntryId,
    lastEntryPreview: `${name} preview`,
    entryCount: 0,
    branchId,
    anchored,
    charactersSnapshot: [],
    locationsSnapshot: [],
    itemsSnapshot: [],
    storyBeatsSnapshot: [],
    chaptersSnapshot: [],
    createdAt,
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
    const { landmarks } = buildLandmarks(
      branchView,
      [checkpoint('cp-late', 'b4'), checkpoint('cp-early', 'b2')],
      [br1],
      br1,
    )
    expect(landmarks.map((l) => [l.kind, l.number])).toEqual([
      ['origin', 2],
      ['checkpoint', 3],
      ['checkpoint', 5],
    ])
  })

  it('names the origin after the checkpoint the branch was forked from, not the branch', () => {
    const { landmarks } = buildLandmarks(
      branchView,
      [checkpoint('cp-origin', 'm1', 'Council of five')],
      [br1],
      br1,
    )
    expect(landmarks.map((l) => [l.kind, l.label])).toEqual([['origin', 'Council of five']])
    expect(landmarks[0].checkpointId).toBe('cp-origin')
    expect(landmarks[0].branchId).toBeNull()
    expect(landmarks[0].branchName).toBe('Main')
  })

  it('falls back to a generic origin label when that checkpoint is gone', () => {
    // `checkpointId` is nullable for imported and legacy branches, and a checkpoint can be
    // deleted after the branch that came from it.
    const { landmarks } = buildLandmarks(
      branchView,
      [],
      [br1],
      branch('br1', 'm1', 'Betrayal', 'deleted-cp'),
    )
    expect(landmarks.map((l) => [l.kind, l.label])).toEqual([['origin', 'Branch origin']])
    expect(landmarks[0].checkpointId).toBeNull()
  })

  it('omits the origin row on the main branch', () => {
    const mainView = [entry('m0', 0), entry('m1', 1)]
    const { landmarks } = buildLandmarks(mainView, [checkpoint('cp', 'm1')], [], null)
    expect(landmarks.map((l) => l.kind)).toEqual(['checkpoint'])
  })

  it('omits an origin whose entry is not loaded', () => {
    const { landmarks } = buildLandmarks(
      branchView,
      [],
      [br1],
      branch('br1', 'not-loaded', 'Betrayal'),
    )
    expect(landmarks).toEqual([])
  })

  it('includes checkpoints inherited from every branch in the visible lineage', () => {
    const ancestor = branch('ancestor', 'm0', 'First path')
    const lineageView = [
      entry('m0', 0),
      entry('a1', 1, 'ancestor'),
      entry('a2', 2, 'ancestor'),
      entry('b3', 3, 'br1'),
    ]
    const current = { ...br1, forkEntryId: 'a2', checkpointId: 'cp-origin' }
    const { landmarks } = buildLandmarks(
      lineageView,
      [
        checkpoint('cp-main', 'm0', 'Departure'),
        checkpoint('cp-ancestor', 'a1', 'Crossroads'),
        checkpoint('cp-origin', 'a2', 'Final choice'),
        checkpoint('cp-current', 'b3', 'Arrival'),
      ],
      [ancestor, current],
      current,
    )

    expect(landmarks.map((l) => [l.label, l.branchName])).toEqual([
      ['Departure', 'Main'],
      ['Crossroads', 'First path'],
      ['Final choice', 'First path'],
      ['Arrival', 'Betrayal'],
    ])
  })

  it('returns nothing for a main branch with no checkpoints', () => {
    expect(buildLandmarks([entry('m0', 0)], [], [], null)).toEqual({
      landmarks: [],
      orphaned: [],
    })
  })

  it('reports a checkpoint whose entry a rollback deleted as orphaned', () => {
    const { landmarks, orphaned } = buildLandmarks(
      branchView,
      [checkpoint('cp', 'gone', 'Lost ground', { anchored: false })],
      [br1],
      br1,
    )
    expect(landmarks.map((l) => l.kind)).toEqual(['origin'])
    expect(orphaned).toEqual([{ checkpointId: 'cp', label: 'Lost ground' }])
  })

  it('leaves a checkpoint from another branch out entirely rather than calling it orphaned', () => {
    // Its entry exists, it is simply not in this lineage — the distinction the anchored flag
    // exists to make, since both miss the loaded entries.
    const { landmarks, orphaned } = buildLandmarks(
      branchView,
      [checkpoint('cp-elsewhere', 'z9', 'Elsewhere', { branchId: 'other', anchored: true })],
      [br1],
      br1,
    )
    expect(landmarks.map((l) => l.kind)).toEqual(['origin'])
    expect(orphaned).toEqual([])
  })

  it('orders orphans oldest first, independently of the numbered rows', () => {
    const { orphaned } = buildLandmarks(
      branchView,
      [
        checkpoint('cp-new', 'gone-2', 'Newer', { anchored: false, createdAt: 200 }),
        checkpoint('cp-old', 'gone-1', 'Older', { anchored: false, createdAt: 100 }),
        checkpoint('cp-live', 'b4', 'Still here'),
      ],
      [br1],
      br1,
    )
    expect(orphaned.map((o) => o.label)).toEqual(['Older', 'Newer'])
  })

  it('lists the origin checkpoint once when it is itself unanchored', () => {
    // Import can pair a branch's forkEntryId with a checkpoint anchored somewhere else, so the
    // origin row can be named after a checkpoint whose own entry is gone. It belongs to the
    // origin row, not to both that and the orphan list.
    const forked = branch('br1', 'm1', 'Betrayal', 'cp-origin')
    const { landmarks, orphaned } = buildLandmarks(
      branchView,
      [checkpoint('cp-origin', 'elsewhere', 'Council of five', { anchored: false })],
      [forked],
      forked,
    )
    expect(landmarks.map((l) => [l.kind, l.label])).toEqual([['origin', 'Council of five']])
    expect(orphaned).toEqual([])
  })

  it('still lists an unanchored checkpoint that no origin row was rendered for', () => {
    // Same disagreement, but the fork entry is not loaded, so there is no origin row to hold it —
    // dropping it here would hide the orphan the section exists to surface.
    const forked = branch('br1', 'not-loaded', 'Betrayal', 'cp-origin')
    const { landmarks, orphaned } = buildLandmarks(
      branchView,
      [checkpoint('cp-origin', 'elsewhere', 'Council of five', { anchored: false })],
      [forked],
      forked,
    )
    expect(landmarks).toEqual([])
    expect(orphaned.map((o) => o.label)).toEqual(['Council of five'])
  })

  it('reports orphans on a branch with nothing to navigate to', () => {
    const { landmarks, orphaned } = buildLandmarks(
      [entry('m0', 0)],
      [checkpoint('cp', 'gone', 'Lost ground', { anchored: false })],
      [],
      null,
    )
    expect(landmarks).toEqual([])
    expect(orphaned).toHaveLength(1)
  })

  it('carries the checkpoint and branch names onto the row', () => {
    const {
      landmarks: [, row],
    } = buildLandmarks(branchView, [checkpoint('cp', 'b2', 'Before the duel')], [br1], br1)
    expect(row.label).toBe('Before the duel')
    expect(row.checkpointId).toBe('cp')
    expect(row.branchId).toBe('br1')
    expect(row.branchName).toBe('Betrayal')
  })
})

describe('checkpointsOnBranch', () => {
  it('finds the checkpoints anchored on that branch', () => {
    const own = checkpoint('cp-own', 'b2', 'Own', { branchId: 'br1' })
    const other = checkpoint('cp-other', 'm1', 'Other', { branchId: null })
    expect(checkpointsOnBranch([own, other], 'br1').map((c) => c.id)).toEqual(['cp-own'])
    expect(checkpointsOnBranch([own, other], null).map((c) => c.id)).toEqual(['cp-other'])
  })

  it('does not count an orphan as one of Main’s', () => {
    // An orphan's branchId is null whatever branch it was created on, so a bare branchId
    // comparison would hand every orphan in the story to Main.
    const orphan = checkpoint('cp-orphan', 'gone', 'Lost', { branchId: null, anchored: false })
    expect(checkpointsOnBranch([orphan], null)).toEqual([])
    expect(checkpointsOnBranch([orphan], 'br1')).toEqual([])
  })
})

describe('branchesUsingCheckpoint', () => {
  it('finds every branch created from the checkpoint', () => {
    const first = branch('first', 'e1', 'First', 'shared-cp')
    const second = branch('second', 'e1', 'Second', 'shared-cp')
    const unrelated = branch('third', 'e2', 'Third', 'other-cp')

    expect(branchesUsingCheckpoint('shared-cp', [first, unrelated, second])).toEqual([
      first,
      second,
    ])
  })

  it('does not treat inherited visibility as use by a branch', () => {
    const descendant = branch('descendant', 'later-entry', 'Descendant', 'fork-cp')

    expect(branchesUsingCheckpoint('earlier-inherited-cp', [descendant])).toEqual([])
  })

  it('describes every branch that blocks deletion', () => {
    expect(
      checkpointDeletionBlocker('shared-cp', [
        branch('first', 'e1', 'First', 'shared-cp'),
        branch('second', 'e1', 'Second', 'shared-cp'),
      ]),
    ).toBe(
      'Cannot delete this checkpoint because it was used to create branches "First", "Second". Delete those branches first.',
    )
  })

  it('returns no blocker for a checkpoint unused in branch creation', () => {
    expect(
      checkpointDeletionBlocker('unused-cp', [branch('first', 'e1', 'First', 'other-cp')]),
    ).toBe(null)
  })
})

describe('jumpToEntry', () => {
  function stubUi() {
    const calls = {
      scrolled: [] as string[],
      panels: [] as string[],
      toasts: [] as { message: string; type?: string }[],
    }
    const ui: EntryJumpUi = {
      requestEntryScroll: (entryId) => calls.scrolled.push(entryId),
      setActivePanel: (panel) => calls.panels.push(panel),
      showToast: (message, type) => calls.toasts.push({ message, type }),
    }
    return { ui, calls }
  }

  const entries = [entry('e1', 0), entry('e2', 1), entry('e3', 2)]

  it('files the request and shows the story', () => {
    const { ui, calls } = stubUi()

    expect(
      jumpToEntry({ entries, entryId: 'e2', ui, confirmation: 'Jumped', canHover: true }),
    ).toBe(true)

    expect(calls.scrolled).toEqual(['e2'])
    expect(calls.panels).toEqual(['story'])
  })

  it('stays silent where the reader can hover', () => {
    const { ui, calls } = stubUi()

    jumpToEntry({ entries, entryId: 'e2', ui, confirmation: 'Jumped', canHover: true })

    expect(calls.toasts).toEqual([])
  })

  it('confirms the jump where the reader cannot hover', () => {
    const { ui, calls } = stubUi()

    jumpToEntry({ entries, entryId: 'e2', ui, confirmation: 'Jumped to entry 2', canHover: false })

    expect(calls.toasts).toEqual([{ message: 'Jumped to entry 2', type: 'info' }])
  })

  it('reports an entry absent from the branch instead of confirming', () => {
    const { ui, calls } = stubUi()

    expect(
      jumpToEntry({ entries, entryId: 'gone', ui, confirmation: 'Jumped', canHover: false }),
    ).toBe(false)

    expect(calls.toasts).toEqual([{ message: 'That entry is not in this branch', type: 'error' }])
  })

  it('reports a miss as not landing even where the reader can hover', () => {
    const { ui, calls } = stubUi()

    expect(
      jumpToEntry({ entries, entryId: 'gone', ui, confirmation: 'Jumped', canHover: true }),
    ).toBe(false)

    expect(calls.toasts).toEqual([])
  })

  it('runs the dismissal the caller supplied', () => {
    const { ui } = stubUi()
    let closed = 0

    jumpToEntry({
      entries,
      entryId: 'e2',
      ui,
      confirmation: 'Jumped',
      canHover: true,
      closeOnMobile: () => (closed += 1),
    })

    expect(closed).toBe(1)
  })

  it('needs no dismissal from a caller that has none', () => {
    const { ui, calls } = stubUi()

    expect(() =>
      jumpToEntry({ entries, entryId: 'e2', ui, confirmation: 'Jumped', canHover: true }),
    ).not.toThrow()
    expect(calls.scrolled).toEqual(['e2'])
  })
})

describe('entryNumberRange', () => {
  it('reports the endpoints of a contiguous run', () => {
    const entries = [entry('e3', 2), entry('e4', 3), entry('e5', 4)]

    expect(entryNumberRange(entries)).toEqual({ first: 3, last: 5 })
  })

  it('reports endpoints that disagree with the count where numbering has a gap', () => {
    // Positions 2..4 and 6..28: 26 entries spanning numbers 3 through 29. An imported or
    // repaired story looks like this, and the two figures are both correct.
    const positions = [2, 3, 4, ...Array.from({ length: 23 }, (_, i) => 6 + i)]
    const entries = positions.map((position) => entry(`e${position}`, position))

    expect(entries.length).toBe(26)
    expect(entryNumberRange(entries)).toEqual({ first: 3, last: 29 })
  })

  it('reports a single entry as a range of itself', () => {
    expect(entryNumberRange([entry('e1', 0)])).toEqual({ first: 1, last: 1 })
  })

  it('has no range to report for no entries', () => {
    expect(entryNumberRange([])).toBe(null)
  })
})
