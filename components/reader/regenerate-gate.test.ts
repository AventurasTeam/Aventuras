import { describe, expect, it } from 'vitest'

import {
  canContinueRegeneratePreflight,
  classifyRegenerateGate,
  loadRegenerateCountsIfCurrent,
} from './regenerate-gate'

describe('classifyRegenerateGate', () => {
  it('terminal reply (only itself removed) fires without confirm', () => {
    expect(classifyRegenerateGate({ entries: 1, chapters: 0, worldStateChanges: 4 })).toBe(
      'immediate',
    )
  })
  it('older reply (cascade removes later entries) requires the cascade confirm', () => {
    expect(classifyRegenerateGate({ entries: 3, chapters: 0, worldStateChanges: 7 })).toBe(
      'cascade-confirm',
    )
  })
  it('a chapter-close in the window routes to the M5.2 cost-confirm arm', () => {
    expect(classifyRegenerateGate({ entries: 1, chapters: 1, worldStateChanges: 9 })).toBe(
      'chapter-close-confirm',
    )
  })
})

describe('regenerate dispatch preflight', () => {
  it('requires the captured branch and both dispatch gates to remain current', () => {
    const current = {
      startedBranchId: 'br_1',
      currentBranchId: 'br_1',
      loadedBranchId: 'br_1',
      dispatchInFlight: false,
      userEditBlocked: false,
    }

    expect(canContinueRegeneratePreflight(current)).toBe(true)
    expect(canContinueRegeneratePreflight({ ...current, dispatchInFlight: true })).toBe(false)
    expect(canContinueRegeneratePreflight({ ...current, userEditBlocked: true })).toBe(false)
    expect(canContinueRegeneratePreflight({ ...current, currentBranchId: 'br_2' })).toBe(false)
    expect(canContinueRegeneratePreflight({ ...current, loadedBranchId: 'br_2' })).toBe(false)
  })

  it('discards counts when another dispatch starts while the query is awaiting', async () => {
    let resolveCounts!: (counts: {
      entries: number
      chapters: number
      worldStateChanges: number
    }) => void
    const pendingCounts = new Promise<{
      entries: number
      chapters: number
      worldStateChanges: number
    }>((resolve) => {
      resolveCounts = resolve
    })
    let dispatchInFlight = false

    const result = loadRegenerateCountsIfCurrent(
      () => pendingCounts,
      () => ({
        startedBranchId: 'br_1',
        currentBranchId: 'br_1',
        loadedBranchId: 'br_1',
        dispatchInFlight,
        userEditBlocked: false,
      }),
    )
    dispatchInFlight = true
    resolveCounts({ entries: 3, chapters: 0, worldStateChanges: 1 })

    expect(await result).toBeNull()
  })

  it('returns counts when the post-await preflight remains current', async () => {
    const counts = { entries: 1, chapters: 0, worldStateChanges: 2 }

    await expect(
      loadRegenerateCountsIfCurrent(
        async () => counts,
        () => ({
          startedBranchId: 'br_1',
          currentBranchId: 'br_1',
          loadedBranchId: 'br_1',
          dispatchInFlight: false,
          userEditBlocked: false,
        }),
      ),
    ).resolves.toBe(counts)
  })
})
