import { describe, expect, it } from 'vitest'

import { STORY_ENTRY_REJECTION, type RollbackCounts } from '@/lib/actions'

import {
  confirmAfterImmediateRefusal,
  countsAfterRefusal,
  regenerateRefusalCopy,
  reopenAfterRefusal,
  rollbackRefusalCopy,
  type ConfirmState,
} from './confirm-refusal'

const OPENED: RollbackCounts = {
  entries: 3,
  chapters: 0,
  worldStateChanges: 2,
  closeWrites: 0,
  reopenedChapter: null,
  removedChapters: [],
}
const FRESH: RollbackCounts = {
  entries: 3,
  chapters: 0,
  worldStateChanges: 5,
  closeWrites: 0,
  reopenedChapter: null,
  removedChapters: [],
}

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
  countedAtSettle: 4,
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

  it('names a held branch, which takes no turns until its memory update is undone', () => {
    expect(regenerateRefusalCopy(refused('classifier-held'))).toBe('reader:regenerateHeld')
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

describe('confirmAfterImmediateRefusal', () => {
  // A ↻ tap read its counts beside a running close; the close committed as the interrupt landed.
  const CLOSE_LANDED = {
    status: 'rejected',
    code: STORY_ENTRY_REJECTION.countsChanged,
    reason: 'counts changed',
    counts: {
      entries: 1,
      chapters: 1,
      worldStateChanges: 1,
      closeWrites: 6,
      reopenedChapter: 1,
      removedChapters: [],
    },
  } as const
  const TAPPED = { targetId: 'e5', targetNumber: 5, countedAtSettle: 7 }

  it('opens a regenerate confirm on the fresh counts a counts-changed refusal carries', () => {
    expect(
      confirmAfterImmediateRefusal({
        current: null,
        refusal: CLOSE_LANDED,
        opened: TAPPED,
        stillOnBranch: true,
      }),
    ).toEqual({
      mode: 'regenerate',
      targetId: 'e5',
      targetNumber: 5,
      countedAtSettle: 7,
      counts: {
        entries: 1,
        chapters: 1,
        worldStateChanges: 1,
        closeWrites: 6,
        reopenedChapter: 1,
        removedChapters: [],
      },
    })
  })

  it('opens nothing for any other refusal', () => {
    for (const code of ['generation-in-flight', 'sweep-refused', 'classifier-held'] as const)
      expect(
        confirmAfterImmediateRefusal({
          current: null,
          refusal: refused(code),
          opened: TAPPED,
          stillOnBranch: true,
        }),
      ).toBeNull()
  })

  it('keeps a confirm the user opened since', () => {
    expect(
      confirmAfterImmediateRefusal({
        current: CONFIRMED,
        refusal: CLOSE_LANDED,
        opened: TAPPED,
        stillOnBranch: true,
      }),
    ).toBe(CONFIRMED)
  })

  it('opens nothing once the user left the branch', () => {
    expect(
      confirmAfterImmediateRefusal({
        current: null,
        refusal: CLOSE_LANDED,
        opened: TAPPED,
        stillOnBranch: false,
      }),
    ).toBeNull()
  })
})
