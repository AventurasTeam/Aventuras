import { describe, expect, it } from 'vitest'

import type { RollbackCounts } from '@/lib/actions'

import {
  canContinueRegeneratePreflight,
  classifyRegenerateGate,
  loadRegenerateCountsIfCurrent,
} from './regenerate-gate'

describe('classifyRegenerateGate', () => {
  it('fires a terminal reply with no close in range without a confirm', () => {
    expect(classifyRegenerateGate({ entries: 1, chapters: 0, closeWrites: 0 })).toBe('immediate')
  })

  it('confirms a reply a committed close ends on', () => {
    expect(classifyRegenerateGate({ entries: 1, chapters: 1, closeWrites: 0 })).toBe(
      'chapter-close-confirm',
    )
  })

  // A divider removed with its close's work kept: no chapter goes, but that work does.
  it("confirms a reply holding a removed chapter's kept work", () => {
    expect(classifyRegenerateGate({ entries: 1, chapters: 0, closeWrites: 4 })).toBe(
      'chapter-close-confirm',
    )
  })

  it('takes the cascade confirm for an older reply, a close in its cascade or not', () => {
    expect(classifyRegenerateGate({ entries: 3, chapters: 1, closeWrites: 0 })).toBe(
      'cascade-confirm',
    )
    expect(classifyRegenerateGate({ entries: 3, chapters: 0, closeWrites: 0 })).toBe(
      'cascade-confirm',
    )
  })
})

describe('regenerate dispatch preflight', () => {
  const current = {
    startedBranchId: 'br_1',
    currentBranchId: 'br_1',
    loadedBranchId: 'br_1',
    dispatchInFlight: false,
    headReversalBlocked: false,
  }

  it('requires the captured branch and both dispatch gates to remain current', () => {
    expect(canContinueRegeneratePreflight(current)).toBe(true)
    expect(canContinueRegeneratePreflight({ ...current, dispatchInFlight: true })).toBe(false)
    expect(canContinueRegeneratePreflight({ ...current, headReversalBlocked: true })).toBe(false)
    expect(canContinueRegeneratePreflight({ ...current, currentBranchId: 'br_2' })).toBe(false)
    expect(canContinueRegeneratePreflight({ ...current, loadedBranchId: 'br_2' })).toBe(false)
  })

  it('discards counts when another dispatch starts while the query is awaiting', async () => {
    let resolveCounts!: (counts: RollbackCounts) => void
    const pendingCounts = new Promise<RollbackCounts>((resolve) => {
      resolveCounts = resolve
    })
    let dispatchInFlight = false

    const result = loadRegenerateCountsIfCurrent(
      () => pendingCounts,
      () => ({ ...current, dispatchInFlight }),
    )
    dispatchInFlight = true
    resolveCounts({
      entries: 3,
      chapters: 0,
      worldStateChanges: 1,
      closeWrites: 0,
      reopenedChapter: null,
      removedChapters: [],
    })

    expect(await result).toBeNull()
  })

  // A refresh started beside the pass while the counts loaded: the regenerate would refuse.
  it('discards counts when the head-reversal gate rises while the query is awaiting', async () => {
    let headReversalBlocked = false
    const result = loadRegenerateCountsIfCurrent(
      async () => ({
        entries: 1,
        chapters: 0,
        worldStateChanges: 0,
        closeWrites: 0,
        reopenedChapter: null,
        removedChapters: [],
      }),
      () => ({ ...current, headReversalBlocked }),
    )
    headReversalBlocked = true
    expect(await result).toBeNull()
  })

  it('returns counts when the post-await preflight remains current', async () => {
    const counts: RollbackCounts = {
      entries: 1,
      chapters: 0,
      worldStateChanges: 2,
      closeWrites: 0,
      reopenedChapter: null,
      removedChapters: [],
    }

    await expect(
      loadRegenerateCountsIfCurrent(
        async () => counts,
        () => current,
      ),
    ).resolves.toBe(counts)
  })
})
