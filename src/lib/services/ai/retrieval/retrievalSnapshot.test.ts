import { describe, it, expect } from 'vitest'
import {
  toRetrievalSnapshot,
  snapshotSize,
  positionsToTurns,
  splitTier1,
  splitTier2,
  splitTier3,
} from './retrievalSnapshot'

const lorebook = {
  all: [
    {
      tier: 1,
      matchReason: 'always inject',
      entry: { id: 'l1', type: 'concept', name: 'Thal’kinesh', injection: { mode: 'always' } },
    },
    {
      tier: 1,
      matchReason: 'sticky (character, 2 turns left)',
      stickyPositionsLeft: 2,
      stickyPositionsTotal: 6,
      entry: { id: 'l2', type: 'character', name: 'Rhiza', injection: { mode: 'keyword' } },
    },
    {
      tier: 2,
      matchReason: 'matched: Borin',
      entry: { id: 'l3', type: 'character', name: 'Borin', injection: { mode: 'keyword' } },
    },
    {
      tier: 2,
      matchReason: 'matched: Borin',
      viaScene: true,
      entry: {
        id: 'l4',
        type: 'faction',
        name: 'House of Stone',
        injection: { mode: 'keyword' },
      },
    },
  ],
  contextBlock: 'lorebook block',
}

const worldState = {
  all: [
    { id: 'w1', tier: 1, type: 'character', name: 'Morvana' },
    { id: 'w2', tier: 3, type: 'item', name: 'Silent Bell' },
  ],
  contextBlock: 'world state block',
}

describe('toRetrievalSnapshot', () => {
  it('keeps tier, type, name and the match reason', () => {
    const snapshot = toRetrievalSnapshot(lorebook, worldState)!

    expect(snapshot.lorebook[0]).toEqual({
      id: 'l1',
      tier: 1,
      type: 'concept',
      name: 'Thal’kinesh',
      reason: 'always inject',
      alwaysInject: true,
      stickyPositionsLeft: undefined,
    })
    expect(snapshot.worldState[1]).toEqual({
      id: 'w2',
      tier: 3,
      type: 'item',
      name: 'Silent Bell',
      stickyPositionsLeft: undefined,
    })
  })

  it('takes either half on its own', () => {
    expect(toRetrievalSnapshot(lorebook, null)?.worldState).toEqual([])
    expect(toRetrievalSnapshot(null, worldState)?.lorebook).toEqual([])
  })

  it('returns null when nothing was retrieved, rather than an empty snapshot', () => {
    // An empty one would overwrite the previous turn's on the way to disk.
    expect(toRetrievalSnapshot(null, null)).toBeNull()
    expect(toRetrievalSnapshot({ all: [] }, { all: [] })).toBeNull()
  })
})

describe('snapshotSize', () => {
  it('counts both sections', () => {
    expect(snapshotSize(toRetrievalSnapshot(lorebook, worldState))).toBe(6)
    expect(snapshotSize(null)).toBe(0)
  })
})

describe('splitTier1', () => {
  it('separates what the author pinned from what a turn carried over', () => {
    const snapshot = toRetrievalSnapshot(lorebook, null)!
    const { always, carried, pinnedByState } = splitTier1(snapshot.lorebook)

    expect(always.map((e) => e.name)).toEqual(['Thal’kinesh'])
    expect(carried.map((e) => e.name)).toEqual(['Rhiza'])
    expect(carried[0].stickyPositionsLeft).toBe(2)
    expect(carried[0].stickyPositionsTotal).toBe(6)
    expect(pinnedByState).toEqual([])
  })

  it('puts state-pinned world state in its own group: it is neither', () => {
    // "You are here", "she is present", "you are carrying it" — no author, no countdown.
    const snapshot = toRetrievalSnapshot(null, worldState)!
    const { always, carried, pinnedByState } = splitTier1(snapshot.worldState)

    expect(always).toEqual([])
    expect(carried).toEqual([])
    expect(pinnedByState.map((e) => e.name)).toEqual(['Morvana'])
  })

  it('ignores everything outside Tier 1', () => {
    const snapshot = toRetrievalSnapshot(lorebook, null)!
    const groups = splitTier1(snapshot.lorebook)

    expect([...groups.always, ...groups.carried, ...groups.pinnedByState]).toHaveLength(2)
  })
})

describe('splitTier3', () => {
  it('separates what fitted the budget from what the model picked', () => {
    const { selected, wholesale } = splitTier3([
      { id: 'a', tier: 3, type: 'concept', name: 'Sent whole', llmSelected: false },
      { id: 'b', tier: 3, type: 'concept', name: 'Chosen', llmSelected: true },
    ])

    expect(wholesale.map((e) => e.name)).toEqual(['Sent whole'])
    expect(selected.map((e) => e.name)).toEqual(['Chosen'])
  })

  it('reads a row with no flag as wholesale, not as a call nobody made', () => {
    // Unreachable from the four producers, which all set the flag. It decides how a row
    // from some later source reads, and the errors are not symmetric: "LLM Selected"
    // asserts a call was paid for, "Included Whole" only that the leftover fitted.
    const { selected, wholesale } = splitTier3([
      { id: 'a', tier: 3, type: 'concept', name: 'Unflagged' },
    ])

    expect(wholesale.map((e) => e.name)).toEqual(['Unflagged'])
    expect(selected).toEqual([])
  })
})

describe('splitTier2', () => {
  it('separates a direct match from one found through the scene', () => {
    const { direct, viaScene } = splitTier2(toRetrievalSnapshot(lorebook, null)!.lorebook)

    expect(direct.map((e) => e.name)).toEqual(['Borin'])
    expect(viaScene.map((e) => e.name)).toEqual(['House of Stone'])
  })
})

describe('token counts', () => {
  it('prices each block with the counter it is given', () => {
    const snapshot = toRetrievalSnapshot(lorebook, worldState, (t) => t.length)!

    expect(snapshot.tokens).toEqual({
      lorebook: 'lorebook block'.length,
      worldState: 'world state block'.length,
    })
  })

  it('is zero when a side produced no block', () => {
    expect(toRetrievalSnapshot(lorebook, null, (t) => t.length)!.tokens?.worldState).toBe(0)
  })

  it('counts nothing when no counter is given, so callers can opt out', () => {
    expect(toRetrievalSnapshot(lorebook, worldState)!.tokens).toEqual({
      lorebook: 0,
      worldState: 0,
    })
  })
})

describe('positionsToTurns', () => {
  it('halves and rounds up: a turn is a user action plus a narration', () => {
    expect(positionsToTurns(6)).toBe(3)
    expect(positionsToTurns(3)).toBe(2)
    expect(positionsToTurns(1)).toBe(1)
    expect(positionsToTurns(0)).toBe(0)
  })
})
