import { afterEach, describe, expect, it, vi } from 'vitest'

import { logger } from '@/lib/diagnostics'

import {
  armSettledText,
  latestReplyOf,
  offersUserAction,
  planRegenerateOutcome,
  runBehindTailDrop,
  settleRegenerateArm,
  settleWithDroppedHandback,
  shouldRestoreUserActionAfterHandlingFailure,
  type RegenerateOutcomeAction,
} from './regenerate-outcome'

const OUTCOMES = ['completed', 'failed', 'rejected', 'aborted'] as const

describe('planRegenerateOutcome', () => {
  it('completed leaves the new take standing and owes nothing', () => {
    expect(
      planRegenerateOutcome({ outcome: 'completed', converged: true, draftEmpty: true }),
    ).toEqual({ action: 'none', resync: false })
  })

  it('failed persists the failure entry so Retry re-enters through submit', () => {
    expect(planRegenerateOutcome({ outcome: 'failed', converged: true, draftEmpty: true })).toEqual(
      {
        action: 'write-failure-entry',
        resync: true,
      },
    )
  })

  it('rejected persists the blocked-by entry', () => {
    expect(
      planRegenerateOutcome({ outcome: 'rejected', converged: true, draftEmpty: true }),
    ).toEqual({ action: 'write-blocked-entry', resync: true })
  })

  it('cancelled into an empty composer hands the swept action back', () => {
    expect(
      planRegenerateOutcome({ outcome: 'aborted', converged: true, draftEmpty: true }),
    ).toEqual({
      action: 'restore-draft',
      resync: true,
    })
  })

  it('cancelled over typed text keeps the draft instead of the swept action', () => {
    expect(
      planRegenerateOutcome({ outcome: 'aborted', converged: true, draftEmpty: false }),
    ).toEqual({ action: 'keep-draft', resync: true })
  })

  // The invariant the whole convergence model exists to protect: with the
  // user_action still standing, re-offering its text duplicates the action.
  it.each(['failed', 'rejected', 'aborted'] as const)(
    'refuses to offer the action text when %s did not converge',
    (outcome) => {
      for (const draftEmpty of [true, false]) {
        const plan = planRegenerateOutcome({ outcome, converged: false, draftEmpty })
        expect(plan).toEqual({ action: 'refuse-unconverged', resync: true })
        expect(offersUserAction(plan.action)).toBe(false)
      }
    },
  )

  // `converged` is true both when the unwind cleanly landed and when it
  // committed but its store sync threw, so no non-completed arm may skip the
  // resync — the aborted arm shipped without one and rendered deleted rows.
  it.each(OUTCOMES.filter((o) => o !== 'completed'))('resyncs the store after %s', (outcome) => {
    for (const converged of [true, false]) {
      for (const draftEmpty of [true, false]) {
        expect(planRegenerateOutcome({ outcome, converged, draftEmpty }).resync).toBe(true)
      }
    }
  })

  it('never resyncs on the completed path', () => {
    for (const draftEmpty of [true, false]) {
      expect(
        planRegenerateOutcome({ outcome: 'completed', converged: true, draftEmpty }).resync,
      ).toBe(false)
    }
  })

  it('draftEmpty only changes the cancelled arm', () => {
    for (const outcome of OUTCOMES) {
      for (const converged of [true, false]) {
        const empty = planRegenerateOutcome({ outcome, converged, draftEmpty: true })
        const typed = planRegenerateOutcome({ outcome, converged, draftEmpty: false })
        if (outcome === 'aborted' && converged) expect(empty).not.toEqual(typed)
        else expect(empty).toEqual(typed)
      }
    }
  })
})

describe('offersUserAction', () => {
  it.each([
    ['write-failure-entry', true],
    ['write-blocked-entry', true],
    ['restore-draft', true],
    ['keep-draft', false],
    ['refuse-unconverged', false],
    ['none', false],
  ] as [RegenerateOutcomeAction, boolean][])('%s → %s', (action, expected) => {
    expect(offersUserAction(action)).toBe(expected)
  })
})

describe('outcome handling failure recovery', () => {
  it('does not restore text for an unconverged action that still stands', () => {
    expect(
      shouldRestoreUserActionAfterHandlingFailure({
        action: 'refuse-unconverged',
        draftEmpty: true,
        landed: false,
      }),
    ).toBe(false)
  })

  it.each(['write-failure-entry', 'write-blocked-entry', 'restore-draft'] as const)(
    '%s restores to an empty draft when its own text never landed',
    (action) => {
      expect(
        shouldRestoreUserActionAfterHandlingFailure({ action, draftEmpty: true, landed: false }),
      ).toBe(true)
    },
  )

  // Its entry and Retry stand, or the draft already holds it: a second copy runs the turn twice.
  it.each(['write-failure-entry', 'write-blocked-entry', 'restore-draft'] as const)(
    '%s restores nothing once its own text landed',
    (action) => {
      expect(
        shouldRestoreUserActionAfterHandlingFailure({ action, draftEmpty: true, landed: true }),
      ).toBe(false)
    },
  )

  it('leaves an occupied draft alone', () => {
    expect(
      shouldRestoreUserActionAfterHandlingFailure({
        action: 'write-failure-entry',
        draftEmpty: false,
        landed: false,
      }),
    ).toBe(false)
  })
})

describe('settleRegenerateArm', () => {
  const TEXT = 'I draw the blade.'
  const BOOM = new Error('boom')

  function harness(
    over: {
      action?: RegenerateOutcomeAction
      arm?: () => Promise<void>
      /** Rejects the first resync only, as a store read that fails once. */
      resyncFailsOnce?: boolean
      draftFree?: boolean
    } = {},
  ) {
    const calls: unknown[] = []
    let resyncs = 0
    return {
      calls,
      deps: {
        action: over.action ?? 'write-failure-entry',
        userActionContent: TEXT,
        arm: async () => {
          calls.push('arm')
          await over.arm?.()
        },
        resync: async () => {
          calls.push('resync')
          if (over.resyncFailsOnce && resyncs++ === 0) throw BOOM
        },
        onThrow: (error: unknown) => {
          calls.push(['onThrow', error])
        },
        draftFree: () => over.draftFree ?? true,
        restoreDraft: (text: string) => {
          calls.push(['restore', text])
        },
      },
    }
  }

  it("settles the arm's text once its write and the resync land", async () => {
    const h = harness()
    expect(await settleRegenerateArm(h.deps)).toBe(TEXT)
    expect(h.calls).toEqual(['arm', 'resync'])
  })

  // The entry never committed, so the draft is the only place the text can go.
  it('restores the text to a free draft when the arm throws before its text landed', async () => {
    const h = harness({ arm: () => Promise.reject(BOOM) })
    expect(await settleRegenerateArm(h.deps)).toBe(TEXT)
    expect(h.calls).toEqual(['arm', ['onThrow', BOOM], ['restore', TEXT], 'resync'])
  })

  it('leaves an occupied draft alone when the arm throws', async () => {
    const h = harness({ arm: () => Promise.reject(BOOM), draftFree: false })
    expect(await settleRegenerateArm(h.deps)).toBeNull()
    expect(h.calls).toEqual(['arm', ['onThrow', BOOM], 'resync'])
  })

  // The entry holding the text stands with its Retry, or the draft holds it already.
  it.each(['write-failure-entry', 'write-blocked-entry', 'restore-draft'] as const)(
    '%s puts no second copy in the draft when the resync after its text throws',
    async (action) => {
      const h = harness({ action, resyncFailsOnce: true })
      expect(await settleRegenerateArm(h.deps)).toBe(TEXT)
      expect(h.calls).toEqual(['arm', 'resync', ['onThrow', BOOM], 'resync'])
    },
  )

  it('lets a second failed resync through', async () => {
    const h = harness({ arm: () => Promise.reject(BOOM) })
    const deps = { ...h.deps, resync: () => Promise.reject(new Error('still failing')) }
    await expect(settleRegenerateArm(deps)).rejects.toThrow('still failing')
  })
})

describe('armSettledText', () => {
  const TEXT = 'I draw the blade.'
  const OFFERS = ['write-failure-entry', 'write-blocked-entry', 'restore-draft'] as const
  const HOLDS_NONE = ['none', 'refuse-unconverged', 'keep-draft'] as const

  // The dropped entry's text defers to it, so the same text never lands twice.
  it.each(OFFERS)('%s settles the action text once its write landed', (action) => {
    expect(armSettledText({ action, userActionContent: TEXT, landed: true, restored: false })).toBe(
      TEXT,
    )
  })

  // Neither its entry nor the draft took the text, so the dropped entry's text must still return.
  it.each(OFFERS)('%s settles nothing when its write threw', (action) => {
    expect(
      armSettledText({ action, userActionContent: TEXT, landed: false, restored: false }),
    ).toBeNull()
  })

  it.each(OFFERS)('%s settles the action text its failure handling restored', (action) => {
    expect(armSettledText({ action, userActionContent: TEXT, landed: false, restored: true })).toBe(
      TEXT,
    )
  })

  it.each(HOLDS_NONE)('%s settles nothing, whatever happened to it', (action) => {
    for (const landed of [true, false]) {
      for (const restored of [true, false]) {
        expect(armSettledText({ action, userActionContent: TEXT, landed, restored })).toBeNull()
      }
    }
  })
})

describe('latestReplyOf', () => {
  const row = (id: string, branchId: string, kind: string, position: number) => ({
    id,
    branchId,
    kind,
    position,
  })

  it("picks the branch's reply at the highest position, whatever the store's order", () => {
    const rows = [
      row('r2', 'b1', 'ai_reply', 4),
      row('r3', 'b1', 'ai_reply', 6),
      row('r1', 'b1', 'ai_reply', 2),
    ]
    expect(latestReplyOf(rows, 'b1')?.id).toBe('r3')
  })

  it("skips another branch's later reply", () => {
    const rows = [row('mine', 'b1', 'ai_reply', 4), row('theirs', 'b2', 'ai_reply', 9)]
    expect(latestReplyOf(rows, 'b1')?.id).toBe('mine')
  })

  it('skips later entries that are not replies', () => {
    const rows = [
      row('reply', 'b1', 'ai_reply', 4),
      row('action', 'b1', 'user_action', 5),
      row('failure', 'b1', 'system', 6),
    ]
    expect(latestReplyOf(rows, 'b1')?.id).toBe('reply')
  })

  it('finds nothing on a branch without a reply', () => {
    expect(latestReplyOf([row('opening', 'b1', 'opening', 1)], 'b1')).toBeUndefined()
  })
})

describe('runBehindTailDrop', () => {
  const BOOM = new Error('boom')

  function harness(
    over: {
      hasTail?: boolean
      clear?: () => Promise<void>
      reload?: () => Promise<void>
      run?: () => Promise<string>
    } = {},
  ) {
    const calls: string[] = []
    const step =
      <T>(name: string, then: () => Promise<T>) =>
      () => {
        calls.push(name)
        return then()
      }
    return {
      calls,
      deps: {
        hasTail: over.hasTail ?? true,
        clear: step('clear', over.clear ?? (() => Promise.resolve())),
        reload: step('reload', over.reload ?? (() => Promise.resolve())),
        run: step('run', over.run ?? (() => Promise.resolve('take'))),
      },
    }
  }

  it('runs once the tail is cleared and resynced', async () => {
    const h = harness()
    expect(await runBehindTailDrop(h.deps)).toEqual({ status: 'returned', value: 'take' })
    expect(h.calls).toEqual(['clear', 'reload', 'run'])
  })

  it('runs straight away when no entry stands at the tail', async () => {
    const h = harness({ hasTail: false })
    expect(await runBehindTailDrop(h.deps)).toEqual({ status: 'returned', value: 'take' })
    expect(h.calls).toEqual(['run'])
  })

  // The entry and its Retry still stand, so a composer copy of its text would run the turn twice.
  it('reports the entry standing when its clear throws', async () => {
    const h = harness({ clear: () => Promise.reject(BOOM) })
    expect(await runBehindTailDrop(h.deps)).toEqual({
      status: 'threw',
      error: BOOM,
      entryDestroyed: false,
    })
    expect(h.calls).toEqual(['clear'])
  })

  it('reports the entry destroyed when the resync after its clear throws', async () => {
    const h = harness({ reload: () => Promise.reject(BOOM) })
    expect(await runBehindTailDrop(h.deps)).toEqual({
      status: 'threw',
      error: BOOM,
      entryDestroyed: true,
    })
    expect(h.calls).toEqual(['clear', 'reload'])
  })

  it('reports the entry destroyed when the run behind its clear throws', async () => {
    const h = harness({ run: () => Promise.reject(BOOM) })
    expect(await runBehindTailDrop(h.deps)).toEqual({
      status: 'threw',
      error: BOOM,
      entryDestroyed: true,
    })
  })

  it('reports no entry destroyed when none stood and the run throws', async () => {
    const h = harness({ hasTail: false, run: () => Promise.reject(BOOM) })
    expect(await runBehindTailDrop(h.deps)).toEqual({
      status: 'threw',
      error: BOOM,
      entryDestroyed: false,
    })
  })
})

describe('settleWithDroppedHandback', () => {
  const DROPPED = { content: 'I climb the tower.', composerMode: 'free' }

  function harness(settle: () => Promise<string | null>, stillOnBranch = true) {
    const calls: unknown[] = []
    return {
      calls,
      deps: {
        branchId: 'branch_a',
        dropped: DROPPED,
        settle: async () => {
          calls.push('settle')
          return settle()
        },
        stillOnBranch: () => stillOnBranch,
        handBack: (submission: typeof DROPPED) => {
          calls.push(['handBack', submission])
        },
      },
    }
  }

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // A completed regenerate owes the composer the cleared failure entry's text.
  it("hands the dropped entry's text back once an arm that settled nothing returns", async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    const h = harness(async () => null)
    await settleWithDroppedHandback(h.deps)
    expect(h.calls).toEqual(['settle', ['handBack', DROPPED]])
    expect(warn).not.toHaveBeenCalled()
  })

  // The arm's own text goes first, so the dropped text meets the draft it left.
  it('hands it back after an arm that settled another text', async () => {
    const h = harness(async () => 'I step back from the edge.')
    await settleWithDroppedHandback(h.deps)
    expect(h.calls).toEqual(['settle', ['handBack', DROPPED]])
  })

  it('hands nothing back when the arm settled that same text', async () => {
    const h = harness(async () => 'I climb the tower.')
    await settleWithDroppedHandback(h.deps)
    expect(h.calls).toEqual(['settle'])
  })

  it('hands it back before a throwing arm propagates', async () => {
    const h = harness(() => Promise.reject(new Error('resync failed')))
    await expect(settleWithDroppedHandback(h.deps)).rejects.toThrow('resync failed')
    expect(h.calls).toEqual(['settle', ['handBack', DROPPED]])
  })

  // One composer serves every branch, so the text can't follow the user; the log records the loss.
  it('hands nothing back once the user left the branch, with a warning', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    const h = harness(async () => null, false)
    await settleWithDroppedHandback(h.deps)
    expect(h.calls).toEqual(['settle'])
    expect(warn).toHaveBeenCalledWith('reader.handback_skipped_left_branch', {
      branchId: 'branch_a',
      source: 'regenerate',
    })
  })

  it('warns of nothing off-branch when the arm settled that same text', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    const h = harness(async () => 'I climb the tower.', false)
    await settleWithDroppedHandback(h.deps)
    expect(warn).not.toHaveBeenCalled()
  })

  it('warns of nothing off-branch when the drop removed no text', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    const h = harness(async () => null, false)
    await settleWithDroppedHandback({ ...h.deps, dropped: undefined })
    expect(warn).not.toHaveBeenCalled()
  })

  it('hands nothing back when the drop removed no text', async () => {
    const h = harness(async () => null)
    await settleWithDroppedHandback({ ...h.deps, dropped: undefined })
    expect(h.calls).toEqual(['settle'])
  })
})
