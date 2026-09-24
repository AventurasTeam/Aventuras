import { describe, it, expect, vi } from 'vitest'
import type { Chapter, StoryEntry, TimeTracker, WorldStateDelta } from '$lib/types'
import type { Checkpoint } from '$lib/types'
import {
  planReconciliation,
  fingerprintPreview,
  applyReconciliation,
  reconciliationStatements,
} from './reconciliation'
import type { ReconciledTime } from './reconcile'
import type { Boundary } from './boundaries'

function t(hours: number, minutes = 0): TimeTracker {
  return { years: 0, days: 0, hours, minutes }
}

function entry(
  id: string,
  start: TimeTracker,
  end: TimeTracker,
  delta?: WorldStateDelta,
): StoryEntry {
  return {
    id,
    storyId: 's1',
    type: 'narration',
    content: 'text',
    parentId: null,
    position: 0,
    createdAt: 0,
    metadata: { timeStart: start, timeEnd: end, tokenCount: 7 },
    branchId: null,
    worldStateDelta: delta ?? null,
  } as StoryEntry
}

function checkpoint(id: string, lastEntryId: string, snapshot: TimeTracker | null): Checkpoint {
  return { id, storyId: 's1', name: id, lastEntryId, timeTrackerSnapshot: snapshot } as Checkpoint
}

function delta(before: TimeTracker | null): WorldStateDelta {
  return {
    classificationResult: { scene: { timeProgression: 'hours' } },
    previousState: {
      characters: [{ id: 'c1', name: 'Mira' }],
      locations: [],
      items: [],
      storyBeats: [],
      currentLocationId: 'loc-1',
      timeTracker: before,
    },
    createdEntities: { characterIds: ['c9'], locationIds: [], itemIds: [], storyBeatIds: [] },
  } as unknown as WorldStateDelta
}

function reconciled(id: string, start: TimeTracker, end: TimeTracker): ReconciledTime {
  return { entryId: id, start, end }
}

describe('planReconciliation', () => {
  const entries = [
    entry('A', t(0), t(1)),
    entry('B', t(1), t(2)),
    entry('C', t(2), t(3)),
    entry('D', t(3), t(4)),
  ]

  it('moves the clock when the range reaches the last entry', () => {
    const plan = planReconciliation({
      entries,
      chapters: [],
      times: [reconciled('C', t(1), t(5)), reconciled('D', t(5), t(9))],
    })
    expect(plan.clock).toEqual(t(9))
  })

  it('leaves the clock alone for an interior range', () => {
    const plan = planReconciliation({
      entries,
      chapters: [],
      times: [reconciled('B', t(1), t(2)), reconciled('C', t(2), t(6))],
    })
    expect(plan.clock).toBeNull()
  })

  it('recomputes the span of a chapter covering rewritten entries', () => {
    const chapter = {
      id: 'ch1',
      number: 1,
      startEntryId: 'B',
      endEntryId: 'C',
      startTime: t(1),
      endTime: t(3),
    } as Chapter
    const plan = planReconciliation({
      entries,
      chapters: [chapter],
      times: [reconciled('B', t(1), t(4)), reconciled('C', t(4), t(6))],
    })
    expect(plan.chapterSpans).toEqual([{ chapterId: 'ch1', startTime: t(1), endTime: t(6) }])
  })

  it('leaves a chapter outside the reconciled range alone', () => {
    const chapter = { id: 'ch0', number: 1, startEntryId: 'A', endEntryId: 'A' } as Chapter
    const plan = planReconciliation({
      entries,
      chapters: [chapter],
      times: [reconciled('C', t(2), t(6)), reconciled('D', t(6), t(9))],
    })
    expect(plan.chapterSpans).toEqual([])
  })

  it('rewrites the clock inside a delta to the reconciled beginning of its entry', () => {
    const withDelta = [entries[0], entry('B', t(1), t(2), delta(t(1))), entries[2], entries[3]]
    const plan = planReconciliation({
      entries: withDelta,
      chapters: [],
      times: [reconciled('B', t(4), t(5))],
    })
    expect(plan.deltas).toHaveLength(1)
    expect(plan.deltas[0].delta.previousState.timeTracker).toEqual(t(4))
  })

  it('preserves everything in a delta except its in-story time', () => {
    const original = delta(t(1))
    const withDelta = [entries[0], entry('B', t(1), t(2), original), entries[2], entries[3]]
    const plan = planReconciliation({
      entries: withDelta,
      chapters: [],
      times: [reconciled('B', t(4), t(5))],
    })

    const before = JSON.parse(JSON.stringify(original))
    const after = JSON.parse(JSON.stringify(plan.deltas[0].delta))
    before.previousState.timeTracker = null
    after.previousState.timeTracker = null
    expect(JSON.stringify(after)).toBe(JSON.stringify(before))
  })

  // The rollback guarantee is scoped to the range. An entry after it keeps the clock recorded
  // in its own delta, so a rollback starting there restores the old value -- the outer join
  // a reconciliation deliberately leaves open, not a defect.
  it('leaves the delta of the entry after the range untouched', () => {
    const withDeltas = [
      entry('A', t(0), t(1)),
      entry('B', t(1), t(2), delta(t(1))),
      entry('C', t(2), t(3), delta(t(2))),
      entry('D', t(3), t(4)),
    ]
    const plan = planReconciliation({
      entries: withDeltas,
      chapters: [],
      times: [reconciled('B', t(1), t(6))],
    })
    expect(plan.deltas.map((d) => d.entryId)).toEqual(['B'])
    expect(withDeltas[2].worldStateDelta!.previousState.timeTracker).toEqual(t(2))
  })

  it('does not mutate the entry it read the delta from', () => {
    const original = delta(t(1))
    const withDelta = [entry('B', t(1), t(2), original)]
    planReconciliation({ entries: withDelta, chapters: [], times: [reconciled('B', t(4), t(5))] })
    expect(original.previousState.timeTracker).toEqual(t(1))
  })
})

describe('applyReconciliation', () => {
  const entries = [entry('A', t(0), t(1)), entry('B', t(1), t(2))]

  it('publishes only after the transaction commits', async () => {
    const order: string[] = []
    const plan = planReconciliation({ entries, chapters: [], times: [reconciled('B', t(1), t(5))] })
    await applyReconciliation(plan, entries, {
      transaction: async () => void order.push('commit'),
      publish: () => void order.push('publish'),
    })
    expect(order).toEqual(['commit', 'publish'])
  })

  it('publishes nothing when a write fails part-way', async () => {
    const publish = vi.fn()
    const plan = planReconciliation({ entries, chapters: [], times: [reconciled('B', t(1), t(5))] })
    await expect(
      applyReconciliation(plan, entries, {
        transaction: async () => {
          throw new Error('constraint failed on statement 2')
        },
        publish,
      }),
    ).rejects.toThrow(/constraint failed/)
    expect(publish).not.toHaveBeenCalled()
  })

  it('writes entry times, spans, deltas and the clock as one batch', () => {
    const withDelta = [entries[0], entry('B', t(1), t(2), delta(t(1)))]
    const chapter = {
      id: 'ch1',
      number: 1,
      startEntryId: 'B',
      endEntryId: 'B',
      startTime: t(1),
      endTime: t(2),
    } as Chapter
    const plan = planReconciliation({
      entries: withDelta,
      chapters: [chapter],
      times: [reconciled('B', t(1), t(5))],
    })
    const statements = reconciliationStatements(plan, withDelta)
    expect(statements.map((s) => s.sql.split(' ').slice(0, 2).join(' '))).toEqual([
      'UPDATE story_entries',
      'UPDATE chapters',
      'UPDATE story_entries',
      'DELETE FROM',
      'UPDATE stories',
    ])
  })

  it('keeps the rest of an entry metadata when it rewrites the times', () => {
    const plan = planReconciliation({ entries, chapters: [], times: [reconciled('B', t(1), t(5))] })
    const written = JSON.parse(String(reconciliationStatements(plan, entries)[0].params![0]))
    expect(written.tokenCount).toBe(7)
    expect(written.timeEnd).toEqual(t(5))
  })
})

describe('fingerprintPreview', () => {
  const from: Boundary = { entryId: 'A', index: 0, kind: 'story-start', time: t(0) }
  const to: Boundary = { entryId: 'C', index: 2, kind: 'anchor', time: t(9) }
  const rangeEntries = [entry('B', t(1), t(2)), entry('C', t(2), t(3))]
  const base = { storyId: 's1', branchId: null, from, to, rangeEntries, boundaryEntryIds: ['C'] }

  it('is stable for unchanged inputs', () => {
    expect(fingerprintPreview(base)).toBe(fingerprintPreview({ ...base }))
  })

  it('changes when an entry time moves under it', () => {
    const moved = [entry('B', t(1), t(4)), entry('C', t(4), t(3))]
    expect(fingerprintPreview({ ...base, rangeEntries: moved })).not.toBe(fingerprintPreview(base))
  })

  it('changes when the branch changes', () => {
    expect(fingerprintPreview({ ...base, branchId: 'br1' })).not.toBe(fingerprintPreview(base))
  })

  it('changes when a boundary resolves to a different time', () => {
    const edited: Boundary = { ...to, time: t(11) }
    expect(fingerprintPreview({ ...base, to: edited })).not.toBe(fingerprintPreview(base))
  })

  it('changes when an entry is deleted from the range', () => {
    expect(fingerprintPreview({ ...base, rangeEntries: [rangeEntries[1]] })).not.toBe(
      fingerprintPreview(base),
    )
  })

  it('changes when an anchor appears inside the range, though both endpoints still resolve', () => {
    const withInner = fingerprintPreview({ ...base, boundaryEntryIds: ['B', 'C'] })
    expect(withInner).not.toBe(fingerprintPreview(base))
  })

  it('does not change because the later boundary is itself anchored', () => {
    expect(fingerprintPreview({ ...base, boundaryEntryIds: ['C'] })).toBe(
      fingerprintPreview({ ...base, boundaryEntryIds: ['C'] }),
    )
  })
})

describe('planReconciliation: the checkpoints on rewritten entries', () => {
  const entries = [entry('A', t(0), t(1)), entry('B', t(1), t(2)), entry('C', t(2), t(3))]

  it('reseeds a checkpoint taken at a rewritten entry', () => {
    const plan = planReconciliation({
      entries,
      chapters: [],
      times: [reconciled('B', t(1), t(9))],
      checkpoints: [checkpoint('cp1', 'B', t(2))],
    })
    expect(plan.checkpointClocks).toEqual([{ checkpointId: 'cp1', timeTracker: t(9) }])
  })

  it('reseeds one sitting inside the range, not only at its ending', () => {
    const plan = planReconciliation({
      entries,
      chapters: [],
      times: [reconciled('B', t(1), t(4)), reconciled('C', t(4), t(9))],
      checkpoints: [checkpoint('cp1', 'B', t(2))],
    })
    expect(plan.checkpointClocks).toEqual([{ checkpointId: 'cp1', timeTracker: t(4) }])
  })

  it('does not touch a checkpoint on an entry the range leaves alone', () => {
    const plan = planReconciliation({
      entries,
      chapters: [],
      times: [reconciled('B', t(1), t(9))],
      checkpoints: [checkpoint('cp-elsewhere', 'A', t(1))],
    })
    expect(plan.checkpointClocks).toEqual([])
  })

  it('writes the new ending to the checkpoint row', () => {
    const plan = planReconciliation({
      entries,
      chapters: [],
      times: [reconciled('B', t(1), t(9))],
      checkpoints: [checkpoint('cp1', 'B', t(2))],
    })
    const written = reconciliationStatements(plan, entries).find((s) =>
      s.sql.startsWith('UPDATE checkpoints'),
    )
    expect(written).toBeDefined()
    expect(JSON.parse(String(written!.params![0]))).toEqual(t(9))
    expect(written!.params![1]).toBe('cp1')
  })
})

describe('planReconciliation: keyframes', () => {
  const entries = [entry('A', t(0), t(1)), entry('B', t(1), t(2)), entry('C', t(2), t(3))]

  it('invalidates the keyframes of every reconciled entry', () => {
    const plan = planReconciliation({
      entries,
      chapters: [],
      times: [reconciled('B', t(1), t(4)), reconciled('C', t(4), t(6))],
    })
    expect(plan.keyframeEntryIds).toEqual(['B', 'C'])
    const del = reconciliationStatements(plan, entries).find((s) => s.sql.startsWith('DELETE FROM'))
    expect(del!.sql).toContain('world_state_snapshots')
    expect(del!.params).toEqual(['B', 'C'])
  })

  it('writes no delete when nothing was reconciled', () => {
    const plan = planReconciliation({ entries, chapters: [], times: [] })
    expect(
      reconciliationStatements(plan, entries).some((s) => s.sql.startsWith('DELETE FROM')),
    ).toBe(false)
  })
})
