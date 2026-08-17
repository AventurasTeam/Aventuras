import { describe, expect, it } from 'vitest'

import {
  offersUserAction,
  planRegenerateOutcome,
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
