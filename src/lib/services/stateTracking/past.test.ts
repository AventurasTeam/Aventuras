import { describe, expect, it } from 'vitest'
import type { StoryEntry, WorldStateMark } from '#lib/types/index.ts'
import { anchorCandidates, pastQuery, rowToRecord, skippedSnapshots, type PastSources } from '.'

/** Headers as the database returns them. */
const rowsOf = (rows: Record<string, unknown>[]) =>
  rows.map((row, i) =>
    rowToRecord({ story_id: 's', branch_id: null, seq: i + 1, created_at: 1, ...row }),
  )

// Entry n sits at position n and is created at time 10n.
const entries = [1, 2, 3, 4].map(
  (n) =>
    ({
      id: `e${n}`,
      storyId: 's',
      branchId: null,
      position: n,
      type: 'narration',
      content: '',
      createdAt: 10 * n,
    }) as StoryEntry,
)

const mark = (entityType: 'snapshot' | 'checkpoint', entityId: string, seq: number) =>
  ({ entityType, entityId, seq }) as WorldStateMark

/** Every snapshot and checkpoint marked at its creation time, unless `marks` is given. */
function sources(overrides: Partial<PastSources> = {}): PastSources {
  const marks = [
    ...(overrides.snapshots ?? []).map((s) => mark('snapshot', s.id, s.createdAt)),
    ...(overrides.checkpoints ?? []).map((cp) => mark('checkpoint', cp.id, cp.createdAt)),
  ]
  return {
    entries,
    records: [],
    marks,
    snapshots: [],
    checkpoints: [],
    lineBranchIds: [null],
    tracking: { on: true, enabledSince: 0 },
    now: 1000,
    ...overrides,
  }
}

const checkpoint = (
  id: string,
  entryId: string,
  createdAt: number,
  branchId: string | null = null,
) => ({
  id,
  lastEntryId: entryId,
  createdAt,
  anchored: true,
  branchId,
  complete: true,
})

describe('anchorCandidates', () => {
  it('ends with the live state at the last entry', () => {
    expect(anchorCandidates(sources()).at(-1)).toEqual({
      kind: 'live',
      id: null,
      position: 4,
      seq: Infinity,
      takenAt: 1000,
    })
  })

  it('places a snapshot or checkpoint by its mark, and takes none without one', () => {
    const candidates = anchorCandidates(
      sources({
        snapshots: [
          {
            id: 'snap',
            entryId: 'e3',
            entryPosition: 3,
            createdAt: 31,
            complete: true,
            closing: false,
          },
        ],
        checkpoints: [checkpoint('marked', 'e2', 15), checkpoint('rebuilt', 'e2', 16)],
        marks: [mark('snapshot', 'snap', 7), mark('checkpoint', 'marked', 4)],
      }),
    )
    expect(candidates.map((c) => [c.id, c.seq])).toEqual([
      ['snap', 7],
      ['marked', 4],
      [null, Infinity],
    ])
  })

  it('takes a checkpoint made before its entry had a successor, not one made after', () => {
    const ids = anchorCandidates(
      sources({ checkpoints: [checkpoint('early', 'e2', 25), checkpoint('late', 'e2', 35)] }),
    ).map((c) => c.id)
    expect(ids).toContain('early')
    expect(ids).not.toContain('late')
  })

  it('takes checkpoints anywhere on the branch line, and none off it', () => {
    const ids = anchorCandidates(
      sources({
        lineBranchIds: [null, 'b'],
        checkpoints: [checkpoint('mine', 'e1', 15, 'b'), checkpoint('sibling', 'e1', 15, 'c')],
      }),
    ).map((c) => c.id)
    expect(ids).toContain('mine')
    expect(ids).not.toContain('sibling')
  })

  it('leaves out states saved without the lorebook', () => {
    const ids = anchorCandidates(
      sources({
        snapshots: [
          {
            id: 'old',
            entryId: 'e3',
            entryPosition: 3,
            createdAt: 31,
            complete: false,
            closing: false,
          },
        ],
        checkpoints: [{ ...checkpoint('bare', 'e2', 25), complete: false }],
      }),
    ).map((c) => c.id)
    expect(ids).toEqual([null])
  })
})

describe('pastQuery', () => {
  it('reads converted history from the stored records alone', () => {
    const records = rowsOf([
      { id: 'e2:header', entry_id: 'e2', kind: 'header', origin: 'legacy', continuous: 0 },
      { id: 'e3:header', entry_id: 'e3', kind: 'header', origin: null, continuous: 1 },
    ])
    const query = pastQuery(sources({ records }), 1)
    expect(query.records.map((r) => r.kind === 'header' && [r.entryId, r.coverage])).toEqual([
      ['e2', 'classifier'],
      ['e3', 'full'],
    ])
  })
})

describe('skippedSnapshots', () => {
  it('lists the incomplete snapshots between the entry and the state used', () => {
    const snap = (id: string, position: number, complete: boolean) => ({
      id,
      entryId: `e${position}`,
      entryPosition: position,
      createdAt: 10 * position + 1,
      complete,
      closing: false,
    })
    const src = sources({
      snapshots: [
        snap('a', 1, false),
        snap('b', 3, false),
        snap('c', 2, true),
        snap('d', 4, false),
      ],
    })
    expect(skippedSnapshots(src, 2, 3)).toEqual([3])
  })
})
