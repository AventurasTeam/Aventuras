import { describe, expect, it } from 'vitest'
import type {
  WorldStateBreakRecord,
  WorldStateChangeRecord,
  WorldStateHeaderRecord,
} from '$lib/types'
import { isContinuous, resolveRun, type AnchorCandidate, type LineEntry, type RunQuery } from '.'

// Entry n is created at time 10n; its narration is classified at 10n + 1.
const line: LineEntry[] = Array.from({ length: 6 }, (_, i) => ({
  id: `e${i + 1}`,
  position: i + 1,
  type: 'narration' as const,
  createdAt: 10 * (i + 1),
}))

function header(n: number, continuous = true, coverage: 'full' | 'classifier' = 'full'): WorldStateHeaderRecord {
  return {
    id: `h${n}`,
    storyId: 's',
    branchId: null,
    entryId: `e${n}`,
    seq: 10 * n + 1,
    createdAt: 10 * n + 1,
    kind: 'header',
    continuous,
    clockBefore: null,
    locationBefore: null,
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
  return { id: `b${at}`, storyId: 's', branchId: null, entryId: `e${n}`, seq: at, createdAt: at, kind: 'break' }
}

const live: AnchorCandidate = { kind: 'live', id: null, position: 6, takenAt: 1000 }

function query(overrides: Partial<RunQuery>): RunQuery {
  return {
    line,
    records: [1, 2, 3, 4, 5, 6].map((n) => header(n, n > 1)),
    snapshotTimes: [],
    target: 3,
    candidates: [live],
    tracking: { on: true, enabledSince: 0 },
    ...overrides,
  }
}

describe('isContinuous', () => {
  it('needs a previous header written after tracking was last turned on', () => {
    expect(isContinuous(header(1), 5, false)).toBe(true)
    expect(isContinuous(header(1), 50, false)).toBe(false)
    expect(isContinuous(null, 0, false)).toBe(false)
    expect(isContinuous(header(1), 0, true)).toBe(false)
    expect(isContinuous(header(1, true, 'classifier'), 0, false)).toBe(false)
  })
})

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
    expect(resolveRun(query({ records }))).toEqual({ ok: false, reason: 'untracked' })
  })

  it('refuses classifier-only history', () => {
    const records = [1, 2, 3, 4, 5, 6].map((n) => header(n, n > 1, n === 5 ? 'classifier' : 'full'))
    expect(resolveRun(query({ records }))).toEqual({ ok: false, reason: 'classifierOnly' })
  })

  it('refuses when tracking was off in between', () => {
    const records = [1, 2, 3, 4, 5, 6].map((n) => header(n, n > 1 && n !== 5))
    expect(resolveRun(query({ records }))).toEqual({ ok: false, reason: 'interrupted' })
  })

  it('accepts an interruption before the entry after the target was created', () => {
    const records = [1, 2, 3, 4, 5, 6].map((n) => header(n, n > 1 && n !== 3))
    expect(resolveRun(query({ records })).ok).toBe(true)
  })

  it('refuses across batch chapterization', () => {
    const records = [...[1, 2, 3, 4, 5, 6].map((n) => header(n, n > 1)), brk(4, 45)]
    expect(resolveRun(query({ records }))).toEqual({ ok: false, reason: 'interrupted' })
  })

  it('refuses from the live state while tracking is off', () => {
    expect(resolveRun(query({ tracking: { on: false, enabledSince: 0 } }))).toEqual({
      ok: false,
      reason: 'interrupted',
    })
  })

  it('uses the closing snapshot of an interrupted run', () => {
    // Tracking went off at 55 (closing snapshot), back on at 58; entry 6 opened the next run.
    const records = [1, 2, 3, 4, 5, 6].map((n) => header(n, n > 1 && n !== 6))
    const closing: AnchorCandidate = { kind: 'snapshot', id: 'snap', position: 5, takenAt: 55 }
    const result = resolveRun(
      query({ records, snapshotTimes: [55], candidates: [live, closing], tracking: { on: true, enabledSince: 58 } }),
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.anchor).toBe(closing)
      expect(result.records.map((r) => r.entryId)).toEqual(['e4', 'e5'])
    }
  })

  it('skips an anchor taken before a change that belongs to the target', () => {
    const early: AnchorCandidate = { kind: 'snapshot', id: 'snap', position: 4, takenAt: 41 }
    const records = [...[1, 2, 3, 4, 5, 6].map((n) => header(n, n > 1)), edit(3, 42)]
    const result = resolveRun(query({ records, snapshotTimes: [41], candidates: [early, live] }))
    expect(result.ok && result.anchor).toBe(live)
  })

  it('does not undo changes written after the anchor was taken', () => {
    const snap: AnchorCandidate = { kind: 'snapshot', id: 'snap', position: 5, takenAt: 52 }
    const records = [...[1, 2, 3, 4, 5, 6].map((n) => header(n, n > 1)), edit(5, 53)]
    const result = resolveRun(query({ records, snapshotTimes: [52], candidates: [snap] }))
    expect(result.ok && result.records.some((r) => r.createdAt === 53)).toBe(false)
  })
})
