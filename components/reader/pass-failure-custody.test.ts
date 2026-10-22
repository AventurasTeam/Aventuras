import { describe, expect, it, vi } from 'vitest'

import {
  planPassFailureCustody,
  readPassFailureCustody,
  settlePassFailureCustody,
} from './pass-failure-custody'

describe('planPassFailureCustody', () => {
  it('hands a failed pass back to an empty composer on the same branch', () => {
    expect(planPassFailureCustody({ held: false, stillOnBranch: true, draftEmpty: true })).toBe(
      'composer',
    )
  })

  it('keeps a failed pass on the entry when the draft is occupied', () => {
    expect(planPassFailureCustody({ held: false, stillOnBranch: true, draftEmpty: false })).toBe(
      'entry',
    )
  })

  it('keeps a failed pass on the entry when the user left the branch', () => {
    expect(planPassFailureCustody({ held: false, stillOnBranch: false, draftEmpty: true })).toBe(
      'entry',
    )
  })

  // The held entry advises a restart, which composer input does not survive.
  it('keeps a held refusal on the entry even with an empty composer', () => {
    expect(planPassFailureCustody({ held: true, stillOnBranch: true, draftEmpty: true })).toBe(
      'entry',
    )
  })
})

describe('readPassFailureCustody', () => {
  const composerHolding = (text: string) => ({ getDraft: () => ({ text }) })

  it('reads an empty draft as free', () => {
    expect(readPassFailureCustody({ stillOnBranch: true, composer: composerHolding('') })).toEqual({
      stillOnBranch: true,
      draftEmpty: true,
    })
  })

  it('reads a draft holding text as occupied', () => {
    expect(
      readPassFailureCustody({ stillOnBranch: true, composer: composerHolding('I wait.') }),
    ).toEqual({ stillOnBranch: true, draftEmpty: false })
  })

  // An unmounted composer can't take the text back, so the entry must keep it.
  it('reads a missing composer as occupied', () => {
    expect(readPassFailureCustody({ stillOnBranch: true, composer: null })).toEqual({
      stillOnBranch: true,
      draftEmpty: false,
    })
  })

  it('carries a branch switch through', () => {
    expect(readPassFailureCustody({ stillOnBranch: false, composer: composerHolding('') })).toEqual(
      { stillOnBranch: false, draftEmpty: true },
    )
  })
})

describe('settlePassFailureCustody', () => {
  function harness(held: boolean, states: { stillOnBranch: boolean; draftEmpty: boolean }[]) {
    const calls: string[] = []
    let read = 0
    const deps = {
      held,
      custodyNow: () => states[Math.min(read++, states.length - 1)]!,
      write: vi.fn(async (withSubmission: boolean) => {
        calls.push(withSubmission ? 'write+submission' : 'write')
      }),
      restoreDraft: vi.fn(() => {
        calls.push('restore')
      }),
    }
    return { deps, calls }
  }

  const FREE = { stillOnBranch: true, draftEmpty: true }

  it('writes the entry without the text, then hands it back', async () => {
    const h = harness(false, [FREE, FREE])
    await settlePassFailureCustody(h.deps)
    expect(h.calls).toEqual(['write', 'restore'])
  })

  it('writes the text onto the entry when the composer cannot take it', async () => {
    const h = harness(false, [{ stillOnBranch: true, draftEmpty: false }])
    await settlePassFailureCustody(h.deps)
    expect(h.calls).toEqual(['write+submission'])
  })

  it('writes the text onto a held entry', async () => {
    const h = harness(true, [FREE])
    await settlePassFailureCustody(h.deps)
    expect(h.calls).toEqual(['write+submission'])
  })

  // The draft filled during the write: the entry is the only place left for the text.
  it('rewrites the entry with the text when the draft filled meanwhile', async () => {
    const h = harness(false, [FREE, { stillOnBranch: true, draftEmpty: false }])
    await settlePassFailureCustody(h.deps)
    expect(h.calls).toEqual(['write', 'write+submission'])
  })

  it('rewrites the entry with the text when the user left the branch meanwhile', async () => {
    const h = harness(false, [FREE, { stillOnBranch: false, draftEmpty: true }])
    await settlePassFailureCustody(h.deps)
    expect(h.calls).toEqual(['write', 'write+submission'])
  })

  // A failed write leaves the text in neither place, so the caller's catch must still hold it.
  it('lets a failed write through before handing anything back', async () => {
    const h = harness(false, [FREE, FREE])
    h.deps.write.mockRejectedValueOnce(new Error('insert failed'))
    await expect(settlePassFailureCustody(h.deps)).rejects.toThrow('insert failed')
    expect(h.deps.restoreDraft).not.toHaveBeenCalled()
  })
})
