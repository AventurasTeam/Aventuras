import { describe, expect, it } from 'vitest'

import { STORY_ENTRY_REJECTION, type RollbackCounts } from '@/lib/actions'

import {
  countsAfterRefusal,
  regenerateRefusalCopy,
  reopenAfterRefusal,
  rollbackRefusalCopy,
  type ConfirmState,
} from './confirm-refusal'

const OPENED: RollbackCounts = { entries: 3, chapters: 0, worldStateChanges: 2 }
const FRESH: RollbackCounts = { entries: 3, chapters: 0, worldStateChanges: 5 }

function refused<C extends string>(code: C) {
  return { status: 'rejected', code, reason: `refused: ${code}` } as const
}

const COUNTS_CHANGED = {
  status: 'rejected',
  code: STORY_ENTRY_REJECTION.countsChanged,
  reason: 'counts changed',
  counts: FRESH,
} as const

const CONFIRMED: ConfirmState = {
  mode: 'rollback',
  targetId: 'e3',
  targetNumber: 3,
  counts: OPENED,
}

describe('rollbackRefusalCopy', () => {
  it('names the moved counts on a counts-changed refusal', () => {
    expect(rollbackRefusalCopy(COUNTS_CHANGED)).toBe('reader:rollbackCountsChanged')
  })

  it('reports any other refusal as a failed rollback', () => {
    expect(rollbackRefusalCopy(refused(STORY_ENTRY_REJECTION.inFlight))).toBe(
      'reader:rollbackFailed',
    )
    expect(rollbackRefusalCopy(refused(STORY_ENTRY_REJECTION.deltaFailed))).toBe(
      'reader:rollbackFailed',
    )
  })
})

describe('regenerateRefusalCopy', () => {
  it('names the moved counts on a counts-changed refusal', () => {
    expect(regenerateRefusalCopy(COUNTS_CHANGED)).toBe('reader:rollbackCountsChanged')
  })

  it('tells the user to wait out a run or a swap', () => {
    expect(regenerateRefusalCopy(refused('generation-in-flight'))).toBe(
      'reader:actions.blockedWhileGenerating',
    )
    expect(regenerateRefusalCopy(refused('embedder-swap'))).toBe(
      'reader:actions.blockedWhileSwapping',
    )
  })

  it('offers no retry for a regenerate that cannot succeed', () => {
    expect(regenerateRefusalCopy(refused('sweep-refused'))).toBe('reader:regenerateUnavailable')
  })
})

describe('countsAfterRefusal', () => {
  it('re-opens a counts-changed refusal on the counts the action returned', () => {
    expect(countsAfterRefusal(OPENED, COUNTS_CHANGED)).toEqual(FRESH)
  })

  it('re-opens any other refusal on the counts the user confirmed', () => {
    expect(countsAfterRefusal(OPENED, refused('in-flight-gated'))).toBe(OPENED)
    expect(countsAfterRefusal(OPENED, refused('generation-in-flight'))).toBe(OPENED)
    expect(countsAfterRefusal(OPENED, refused('sweep-refused'))).toBe(OPENED)
  })

  it('takes no counts-changed refusal without its counts', () => {
    // @ts-expect-error a counts-changed refusal always carries the counts it found
    countsAfterRefusal(OPENED, refused(STORY_ENTRY_REJECTION.countsChanged))
  })
})

describe('reopenAfterRefusal', () => {
  it('re-opens the closed confirm on its target with the fresh counts', () => {
    expect(
      reopenAfterRefusal({
        current: null,
        confirmed: CONFIRMED,
        refusal: COUNTS_CHANGED,
        stillOnBranch: true,
      }),
    ).toEqual({ ...CONFIRMED, counts: FRESH })
  })

  it('re-opens a regenerate confirm as a regenerate confirm', () => {
    const regenerate: ConfirmState = { ...CONFIRMED, mode: 'regenerate' }
    expect(
      reopenAfterRefusal({
        current: null,
        confirmed: regenerate,
        refusal: refused('generation-in-flight'),
        stillOnBranch: true,
      }),
    ).toEqual(regenerate)
  })

  it('re-opens on the confirmed counts after any other refusal', () => {
    expect(
      reopenAfterRefusal({
        current: null,
        confirmed: CONFIRMED,
        refusal: refused(STORY_ENTRY_REJECTION.inFlight),
        stillOnBranch: true,
      }),
    ).toEqual(CONFIRMED)
  })

  it('keeps a confirm the user opened since', () => {
    const other: ConfirmState = { ...CONFIRMED, targetId: 'e5', targetNumber: 5 }
    expect(
      reopenAfterRefusal({
        current: other,
        confirmed: CONFIRMED,
        refusal: COUNTS_CHANGED,
        stillOnBranch: true,
      }),
    ).toBe(other)
  })

  it('stays shut once the user left the branch', () => {
    expect(
      reopenAfterRefusal({
        current: null,
        confirmed: CONFIRMED,
        refusal: COUNTS_CHANGED,
        stillOnBranch: false,
      }),
    ).toBeNull()
  })
})
