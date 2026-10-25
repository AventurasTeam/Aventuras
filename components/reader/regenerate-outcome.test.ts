import { describe, expect, it } from 'vitest'

import {
  offersUserAction,
  planRegenerateOutcome,
  runBehindTailDrop,
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
    expect(shouldRestoreUserActionAfterHandlingFailure('refuse-unconverged', true)).toBe(false)
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

  // A completed regenerate owes the composer the cleared failure entry's text.
  it("hands the dropped entry's text back once an arm that settled nothing returns", async () => {
    const h = harness(async () => null)
    await settleWithDroppedHandback(h.deps)
    expect(h.calls).toEqual(['settle', ['handBack', DROPPED]])
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

  it('hands nothing back once the user left the branch', async () => {
    const h = harness(async () => null, false)
    await settleWithDroppedHandback(h.deps)
    expect(h.calls).toEqual(['settle'])
  })

  it('hands nothing back when the drop removed no text', async () => {
    const h = harness(async () => null)
    await settleWithDroppedHandback({ ...h.deps, dropped: undefined })
    expect(h.calls).toEqual(['settle'])
  })
})
