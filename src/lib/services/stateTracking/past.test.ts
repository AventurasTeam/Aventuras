import { describe, expect, it } from 'vitest'
import type { StoryEntry } from '#lib/types/index.ts'
import { anchorCandidates, pastQuery, skippedSnapshots, type PastSources } from '.'

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

function sources(overrides: Partial<PastSources> = {}): PastSources {
  return {
    entries,
    records: [],
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
      takenAt: 1000,
    })
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
  it('adds an old delta only where the entry has no header of its own', () => {
    const old = {
      ...entries[1],
      worldStateDelta: {
        previousState: {
          characters: [],
          locations: [],
          items: [],
          storyBeats: [],
          currentLocationId: null,
        },
        createdEntities: { characterIds: ['x'], locationIds: [], itemIds: [], storyBeatIds: [] },
      },
    } as unknown as StoryEntry
    const query = pastQuery(sources({ entries: [entries[0], old, entries[2], entries[3]] }), 1)
    expect(query.records.filter((r) => r.entryId === 'e2').map((r) => r.kind)).toEqual([
      'header',
      'change',
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
