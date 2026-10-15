import { describe, expect, it } from 'vitest'
import type {
  WorldStateBreakRecord,
  WorldStateChangeRecord,
  WorldStateHeaderRecord,
} from '#lib/types/index.ts'
import {
  isContinuous,
  lastCompletedEntry,
  lastHeaderOnLine,
  recordsForExport,
  resolveOverride,
  resolveRun,
  type AnchorCandidate,
  type LineEntry,
  type RunQuery,
} from '.'

// Entry n is created at time 10n; its narration is classified at 10n + 1.
const line: LineEntry[] = Array.from({ length: 6 }, (_, i) => ({
  id: `e${i + 1}`,
  position: i + 1,
  type: 'narration' as const,
  createdAt: 10 * (i + 1),
}))

function header(
  n: number,
  continuous = true,
  coverage: 'full' | 'classifier' = 'full',
): WorldStateHeaderRecord {
  return {
    id: `h${n}`,
    storyId: 's',
    branchId: null,
    entryId: `e${n}`,
    seq: 10 * n + 1,
    createdAt: 10 * n + 1,
    kind: 'header',
    continuous,
    coverage,
  }
}

function edit(n: number, at: number): WorldStateChangeRecord {
  return {
    id: `c${n}-${at}`,
    storyId: 's',
    branchId: null,
    entryId: `e${n}`,
    seq: at,
    createdAt: at,
    kind: 'change',
    origin: 'manual',
    entityType: 'character',
    entityId: 'c',
    op: 'update',
    before: {},
    after: {},
  }
}

function brk(n: number, at: number): WorldStateBreakRecord {
  return {
    id: `b${at}`,
    storyId: 's',
    branchId: null,
    entryId: `e${n}`,
    seq: at,
    createdAt: at,
    kind: 'break',
  }
}

const live: AnchorCandidate = { kind: 'live', id: null, position: 6, takenAt: 1000 }

function query(overrides: Partial<RunQuery>): RunQuery {
  return {
    line,
    records: [1, 2, 3, 4, 5, 6].map((n) => header(n, n > 1)),
    snapshots: [],
    target: 3,
    candidates: [live],
    tracking: { on: true, enabledSince: 0 },
    ...overrides,
  }
}

describe('isContinuous', () => {
  it('needs a previous header written after tracking was last turned on', () => {
    expect(isContinuous(header(1), 5, false, 0)).toBe(true)
    expect(isContinuous(header(1), 50, false, 0)).toBe(false)
    expect(isContinuous(header(1), 0, true, 0)).toBe(false)
    expect(isContinuous(header(1, true, 'classifier'), 0, false, 0)).toBe(false)
  })

  it('lets the first header vouch for a story created while tracking was on', () => {
    expect(isContinuous(null, 5, false, 8)).toBe(true)
    expect(isContinuous(null, 5, false, 3)).toBe(false)
    expect(isContinuous(null, 5, true, 8)).toBe(false)
    expect(isContinuous(null, null, false, 8)).toBe(false)
  })
})

/** The refusal reason and the gap it names, for the live anchor at entry 6. */
function refusal(q: RunQuery) {
  const result = resolveRun(q)
  return result.ok ? null : { reason: result.reason, gaps: result.diagnosis?.gaps ?? [] }
}

describe('resolveRun', () => {
  it('rebuilds from the live state across one continuous run', () => {
    const result = resolveRun(query({}))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.anchor).toBe(live)
      expect(result.records.map((r) => r.entryId)).toEqual(['e4', 'e5', 'e6'])
    }
  })

  it('refuses a narration that was never recorded', () => {
    const records = [1, 2, 3, 5, 6].map((n) => header(n, n > 1))
    expect(refusal(query({ records }))).toEqual({
      reason: 'untracked',
      gaps: [{ cause: 'untracked', entryId: 'e4', throughEntryId: null }],
    })
  })

  it('names the whole stretch when no entry after the target was recorded', () => {
    const records = [1, 2, 3].map((n) => header(n, n > 1))
    expect(refusal(query({ records }))).toEqual({
      reason: 'untracked',
      gaps: [{ cause: 'untracked', entryId: 'e4', throughEntryId: 'e6' }],
    })
  })

  it('reports every problem in the span, not only the first', () => {
    // e4 unrecorded, e5 old-format, e6 recorded after a pause that began after e5.
    const records = [
      ...[1, 2, 3].map((n) => header(n, n > 1)),
      header(5, false, 'classifier'),
      header(6, false),
    ]
    expect(refusal(query({ records }))?.gaps).toEqual([
      { cause: 'untracked', entryId: 'e4', throughEntryId: null },
      { cause: 'classifierOnly', entryId: 'e5', throughEntryId: null },
      { cause: 'header', entryId: 'e6', sinceEntryId: 'e3' },
    ])
  })

  it('refuses classifier-only history', () => {
    const records = [1, 2, 3, 4, 5, 6].map((n) => header(n, n > 1, n === 5 ? 'classifier' : 'full'))
    expect(refusal(query({ records }))).toEqual({
      reason: 'classifierOnly',
      gaps: [{ cause: 'classifierOnly', entryId: 'e5', throughEntryId: null }],
    })
  })

  it('refuses when tracking was off in between', () => {
    const records = [1, 2, 3, 4, 5, 6].map((n) => header(n, n > 1 && n !== 5))
    expect(refusal(query({ records }))).toEqual({
      reason: 'interrupted',
      gaps: [{ cause: 'header', entryId: 'e5', sinceEntryId: 'e4' }],
    })
  })

  it('refuses an entry played untracked, and still names the full state after it', () => {
    const records = [1, 2, 4, 5, 6].map((n) => header(n, n > 1))
    const result = resolveRun(query({ records }))
    expect(result).toEqual({
      ok: false,
      reason: 'targetUntracked',
      diagnosis: { target: 'untracked', anchor: live, gaps: [] },
    })
  })

  it('diagnoses the nearest full state when none passes', () => {
    const snap: AnchorCandidate = { kind: 'snapshot', id: 'snap', position: 5, takenAt: 52 }
    const records = [1, 2, 3, 4, 5, 6].map((n) => header(n, n > 1 && n !== 4))
    const result = resolveRun(
      query({
        records,
        snapshots: [{ entryId: 'e5', takenAt: 52, closing: false }],
        candidates: [live, snap],
      }),
    )
    expect(!result.ok && result.diagnosis).toEqual({
      target: 'recorded',
      anchor: snap,
      gaps: [{ cause: 'header', entryId: 'e4', sinceEntryId: 'e3' }],
    })
  })

  it('names old records, not a pause, on a story played before full recording began', () => {
    // Tracked in the old form up to entry 6; the new build turned full recording on at 500.
    const records = [...[1, 2, 3, 4, 5, 6].map((n) => header(n, false, 'classifier')), edit(4, 41)]
    const result = resolveRun(query({ records, tracking: { on: true, enabledSince: 500 } }))
    expect(result).toEqual({
      ok: false,
      reason: 'targetClassifierOnly',
      diagnosis: {
        target: 'classifierOnly',
        anchor: live,
        gaps: [{ cause: 'classifierOnly', entryId: 'e4', throughEntryId: 'e6' }],
      },
    })
  })

  it('takes no pause from a snapshot saved before full recording began', () => {
    const records = [1, 2, 3, 4, 5, 6].map((n) => header(n, false, 'classifier'))
    const result = resolveRun(
      query({
        records,
        snapshots: [{ entryId: 'e2', takenAt: 25, closing: false }],
        tracking: { on: true, enabledSince: 500 },
      }),
    )
    expect(!result.ok && result.diagnosis?.gaps).toEqual([
      { cause: 'classifierOnly', entryId: 'e4', throughEntryId: 'e6' },
    ])
  })

  it('accepts an interruption before the entry after the target was created', () => {
    const records = [1, 2, 3, 4, 5, 6].map((n) => header(n, n > 1 && n !== 3))
    expect(resolveRun(query({ records })).ok).toBe(true)
  })

  it('refuses across batch chapterization', () => {
    const records = [...[1, 2, 3, 4, 5, 6].map((n) => header(n, n > 1)), brk(4, 45)]
    expect(refusal(query({ records }))).toEqual({
      reason: 'interrupted',
      gaps: [{ cause: 'break', entryId: 'e4' }],
    })
  })

  it('refuses from the live state while tracking is off', () => {
    expect(refusal(query({ tracking: { on: false, enabledSince: 0 } }))).toEqual({
      reason: 'interrupted',
      gaps: [{ cause: 'trackingOff' }],
    })
  })

  it('names a re-enable after the last record', () => {
    expect(refusal(query({ tracking: { on: true, enabledSince: 500 } }))).toEqual({
      reason: 'interrupted',
      gaps: [{ cause: 'enabledAfter', sinceEntryId: 'e6', enabledSince: 500 }],
    })
  })

  it('uses the closing snapshot of an interrupted run', () => {
    // Tracking went off at 55 (closing snapshot), back on at 58; entry 6 opened the next run.
    const records = [1, 2, 3, 4, 5, 6].map((n) => header(n, n > 1 && n !== 6))
    const closing: AnchorCandidate = { kind: 'snapshot', id: 'snap', position: 5, takenAt: 55 }
    const result = resolveRun(
      query({
        records,
        snapshots: [{ entryId: 'e5', takenAt: 55, closing: true }],
        candidates: [live, closing],
        tracking: { on: true, enabledSince: 58 },
      }),
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.anchor).toBe(closing)
      expect(result.records.map((r) => r.entryId)).toEqual(['e4', 'e5'])
    }
  })

  it('takes a closing snapshot on an unrecorded last entry as proof', () => {
    // A stopped turn left entry 6, a player action, last; tracking went off at 70.
    const stopped = line.map((e) => (e.id === 'e6' ? { ...e, type: 'user_action' as const } : e))
    const closing: AnchorCandidate = { kind: 'snapshot', id: 'snap', position: 6, takenAt: 70 }
    const asked = (isClosing: boolean) =>
      resolveRun(
        query({
          line: stopped,
          records: [1, 2, 3, 4, 5].map((n) => header(n, n > 1)),
          snapshots: [{ entryId: 'e6', takenAt: 70, closing: isClosing }],
          candidates: [closing],
          tracking: { on: false, enabledSince: 0 },
        }),
      )
    expect(asked(true).ok).toBe(true)
    expect(asked(false).ok).toBe(false)
  })

  it('applies a change that belongs to the target but was written after the anchor', () => {
    const early: AnchorCandidate = { kind: 'snapshot', id: 'snap', position: 4, takenAt: 41 }
    const late = edit(3, 42)
    const records = [...[1, 2, 3, 4, 5, 6].map((n) => header(n, n > 1)), late]
    const result = resolveRun(
      query({
        records,
        snapshots: [{ entryId: 'e4', takenAt: 41, closing: false }],
        candidates: [early, live],
      }),
    )
    expect(result.ok && result.anchor).toBe(early)
    expect(result.ok && result.late).toEqual([late])
    expect(result.ok && result.records.map((r) => r.entryId)).toEqual(['e4'])
  })

  it('does not undo changes written after the anchor was taken', () => {
    const snap: AnchorCandidate = { kind: 'snapshot', id: 'snap', position: 5, takenAt: 52 }
    const records = [...[1, 2, 3, 4, 5, 6].map((n) => header(n, n > 1)), edit(5, 53)]
    const result = resolveRun(
      query({
        records,
        snapshots: [{ entryId: 'e5', takenAt: 52, closing: false }],
        candidates: [snap],
      }),
    )
    expect(result.ok && result.records.some((r) => r.createdAt === 53)).toBe(false)
  })
})

describe('resolveOverride', () => {
  // Tracking was off between entries 4 and 5, so resolveRun refuses entry 3.
  const records = [1, 2, 3, 4, 5, 6].map((n) => header(n, n > 1 && n !== 5))
  const before: AnchorCandidate = { kind: 'checkpoint', id: 'cp', position: 2, takenAt: 25 }
  const after: AnchorCandidate = { kind: 'snapshot', id: 'snap', position: 5, takenAt: 52 }
  const gapped = query({
    records,
    snapshots: [{ entryId: 'e5', takenAt: 52, closing: false }],
    candidates: [before, after, live],
  })

  it('undoes what was recorded from the nearest full state after the entry', () => {
    expect(resolveRun(gapped).ok).toBe(false)
    const result = resolveOverride(gapped, 'undoRecorded')
    expect(result.ok && result.anchor).toBe(after)
    expect(result.ok && result.records.map((r) => r.entryId)).toEqual(['e4', 'e5'])
  })

  it('takes the nearest full state after the entry unchanged', () => {
    expect(resolveOverride(gapped, 'nextAsIs')).toEqual({
      ok: true,
      anchor: after,
      records: [],
      late: [],
    })
  })

  it('takes the nearest full state before the entry unchanged', () => {
    expect(resolveOverride(gapped, 'previousAsIs')).toEqual({
      ok: true,
      anchor: before,
      records: [],
      late: [],
    })
  })

  it('has nothing to take when no full state precedes the entry', () => {
    expect(resolveOverride(query({ records }), 'previousAsIs')).toEqual({
      ok: false,
      reason: 'noAnchor',
    })
  })
})

describe('lastHeaderOnLine', () => {
  const positions = new Map(line.map((e) => [e.id, e.position]))

  it('finds the newest header before the entry and any break after it', () => {
    const records = [header(1), header(2), brk(2, 25)]
    expect(lastHeaderOnLine(records, positions, 3)).toEqual({ header: header(2), breakSince: true })
    expect(lastHeaderOnLine([header(1), header(2)], positions, 3).breakSince).toBe(false)
  })

  it('ignores headers on entries that are not on the line', () => {
    // A header written on another branch after tracking was turned on.
    const elsewhere = { ...header(9), entryId: 'other-branch-entry', seq: 500, createdAt: 500 }
    const result = lastHeaderOnLine([header(1), elsewhere], positions, 3)
    expect(result.header).toEqual(header(1))
  })

  it('makes the first entry after re-enabling tracking start a new run', () => {
    // Header 1 written at 11; tracking turned off, an edit, then on again at 15.
    const { header: previous, breakSince } = lastHeaderOnLine([header(1)], positions, 2)
    expect(isContinuous(previous, 15, breakSince, 0)).toBe(false)
    expect(isContinuous(previous, 5, breakSince, 0)).toBe(true)
  })
})

describe('lastCompletedEntry', () => {
  const turn = [
    { id: 'n60', type: 'narration' as const },
    { id: 'a61', type: 'user_action' as const },
    { id: 'n62', type: 'narration' as const },
  ]

  it('is the latest entry when nothing is generating', () => {
    expect(lastCompletedEntry(turn, false)?.id).toBe('n62')
  })

  it('skips the turn in flight', () => {
    expect(lastCompletedEntry(turn, true)?.id).toBe('n60')
    expect(lastCompletedEntry(turn.slice(0, 2), true)?.id).toBe('n60')
  })
})

describe('recordsForExport', () => {
  const records = [header(1), header(2)]

  it('adds nothing while this device has tracked since the last record', () => {
    expect(recordsForExport(records, { on: true, enabledSince: 5 }, 100)).toEqual(records)
  })

  it('ends the branch with a break when tracking is off', () => {
    const out = recordsForExport(records, { on: false, enabledSince: 5 }, 100)
    expect(out.at(-1)).toMatchObject({ kind: 'break', entryId: 'e2', seq: 22 })
  })

  it('ends the branch with a break when tracking was turned on again since', () => {
    const out = recordsForExport(records, { on: true, enabledSince: 50 }, 100)
    expect(out.at(-1)?.kind).toBe('break')
  })

  it('exports nothing for a story that was never tracked', () => {
    expect(recordsForExport([], { on: false, enabledSince: null }, 100)).toEqual([])
  })
})
