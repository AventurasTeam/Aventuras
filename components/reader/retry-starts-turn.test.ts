import { describe, expect, it } from 'vitest'

import { retryStartsTurn } from './retry-starts-turn'

describe('retryStartsTurn', () => {
  it("starts a turn from a turn's failure entry", () => {
    expect(retryStartsTurn({ kind: 'provider' })).toBe(true)
  })

  it("reruns a failed pass or close's work, not a turn", () => {
    expect(retryStartsTurn({ kind: 'provider', pass: 'failed' })).toBe(false)
    expect(retryStartsTurn({ kind: 'provider', close: 'failed' })).toBe(false)
  })

  it('starts a turn from a held or resolved entry, whose Retry resends the text', () => {
    expect(retryStartsTurn({ kind: 'provider', pass: 'held' })).toBe(true)
    expect(retryStartsTurn({ kind: 'provider', pass: 'resolved' })).toBe(true)
    expect(retryStartsTurn({ kind: 'provider', close: 'resolved' })).toBe(true)
  })

  it('starts a turn with no failure entry on the branch', () => {
    expect(retryStartsTurn(undefined)).toBe(true)
  })
})
