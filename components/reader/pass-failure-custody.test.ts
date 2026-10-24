import { describe, expect, it, vi } from 'vitest'

import type { ComposerMode } from '@/lib/composer-wrap'

import {
  draftSubmission,
  planCommittedPassRetry,
  planPassFailureCustody,
  planPassRetryCustody,
  readPassFailureCustody,
  settleCommittedPassRetry,
  settlePassFailureCustody,
  settlePassRetryCustody,
} from './pass-failure-custody'

describe('planCommittedPassRetry', () => {
  it('dismisses an entry whose text an empty composer on its branch can take back', () => {
    expect(
      planCommittedPassRetry({ entryHasText: true, stillOnBranch: true, draftEmpty: true }),
    ).toBe('dismiss')
  })

  // reader-composer.md → Custody of the turn's text: the draft wins, and the entry keeps the text.
  it('keeps the entry as a notice when the draft is occupied', () => {
    expect(
      planCommittedPassRetry({ entryHasText: true, stillOnBranch: true, draftEmpty: false }),
    ).toBe('keep-notice')
  })

  it('keeps the entry as a notice when the user left its branch', () => {
    expect(
      planCommittedPassRetry({ entryHasText: true, stillOnBranch: false, draftEmpty: true }),
    ).toBe('keep-notice')
  })

  it('dismisses an entry with no text, whatever the composer holds', () => {
    expect(
      planCommittedPassRetry({ entryHasText: false, stillOnBranch: false, draftEmpty: false }),
    ).toBe('dismiss')
  })
})

describe('settleCommittedPassRetry', () => {
  const STORED = { content: 'I wade across.', composerMode: 'free' }

  function harness(custody: { stillOnBranch: boolean; draftEmpty: boolean }) {
    const calls: unknown[] = []
    return {
      calls,
      deps: {
        custodyNow: () => custody,
        dismiss: vi.fn(async () => {
          calls.push('dismiss')
        }),
        keepNotice: vi.fn(async (submission: typeof STORED) => {
          calls.push(['keep', submission])
        }),
      },
    }
  }

  it('keeps the stored text on a notice when the composer holds a draft', async () => {
    const h = harness({ stillOnBranch: true, draftEmpty: false })
    await settleCommittedPassRetry({ ...h.deps, stored: STORED })
    expect(h.calls).toEqual([['keep', STORED]])
  })

  it('dismisses into an empty composer', async () => {
    const h = harness({ stillOnBranch: true, draftEmpty: true })
    await settleCommittedPassRetry({ ...h.deps, stored: STORED })
    expect(h.calls).toEqual(['dismiss'])
  })

  it('dismisses an entry that stores no text', async () => {
    const h = harness({ stillOnBranch: true, draftEmpty: false })
    await settleCommittedPassRetry({ ...h.deps, stored: undefined })
    expect(h.calls).toEqual(['dismiss'])
  })
})

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

describe('planPassRetryCustody', () => {
  const HELD = { held: true, stillOnBranch: true }

  it('keeps the text a held entry already carries, leaving the composer alone', () => {
    expect(planPassRetryCustody({ ...HELD, entryHasText: true, draftEmpty: false })).toBe('keep')
  })

  // reader-composer.md → Custody of the turn's text: the held copy advises a restart.
  it('moves the draft onto a held entry that stores no text', () => {
    expect(planPassRetryCustody({ ...HELD, entryHasText: false, draftEmpty: false })).toBe(
      'take-draft',
    )
  })

  it('keeps a held entry without text when the composer is empty', () => {
    expect(planPassRetryCustody({ ...HELD, entryHasText: false, draftEmpty: true })).toBe('keep')
  })

  it("leaves another branch's draft in the composer", () => {
    expect(
      planPassRetryCustody({
        held: true,
        stillOnBranch: false,
        entryHasText: false,
        draftEmpty: false,
      }),
    ).toBe('keep')
  })

  // A failed entry still offers Retry and advises no restart, so the draft stays put.
  it('leaves the draft alone when the Retry failed without a hold', () => {
    expect(
      planPassRetryCustody({
        held: false,
        stillOnBranch: true,
        entryHasText: false,
        draftEmpty: false,
      }),
    ).toBe('keep')
  })
})

describe('draftSubmission', () => {
  // Dismiss hands an entry's text back under Free, so the stored form must carry the wrap.
  it('stores the draft wrapped, as Send takes it', () => {
    expect(
      draftSubmission(
        { text: 'draw my blade', mode: 'do' },
        { modesUsable: true, pov: 'first', leadName: null },
      ),
    ).toEqual({ content: 'I draw my blade.', composerMode: 'do' })
  })

  it('stores a mode the composer cannot use as free', () => {
    expect(
      draftSubmission(
        { text: 'draw my blade', mode: 'do' },
        { modesUsable: false, pov: 'first', leadName: null },
      ),
    ).toEqual({ content: 'draw my blade', composerMode: 'free' })
  })
})

describe('settlePassRetryCustody', () => {
  type Draft = { text: string; mode: ComposerMode }
  const STORED = { content: 'I wait.', composerMode: 'free' }

  function harness(opts: {
    held?: boolean
    stored?: { content: string; composerMode: string }
    drafts: (Draft | undefined)[]
    onBranch?: boolean[]
  }) {
    const calls: string[] = []
    let draftRead = 0
    let branchRead = 0
    const onBranch = opts.onBranch ?? [true]
    const deps = {
      held: opts.held ?? true,
      stored: opts.stored,
      stillOnBranch: () => onBranch[Math.min(branchRead++, onBranch.length - 1)]!,
      draft: () => opts.drafts[Math.min(draftRead++, opts.drafts.length - 1)],
      toSubmission: (draft: Draft) => ({
        content: `wrapped:${draft.text}`,
        composerMode: draft.mode,
      }),
      write: vi.fn(async (submission: { content: string } | undefined) => {
        calls.push(`write:${submission?.content ?? 'none'}`)
      }),
      clearDraft: vi.fn(() => {
        calls.push('clear')
      }),
    }
    return { deps, calls }
  }

  const DRAFT: Draft = { text: 'draw my blade', mode: 'do' }

  it('writes the draft onto a held entry, then empties the composer', async () => {
    const h = harness({ drafts: [DRAFT] })
    await settlePassRetryCustody(h.deps)
    expect(h.calls).toEqual(['write:wrapped:draw my blade', 'clear'])
  })

  it("writes a held entry's own text and leaves the composer alone", async () => {
    const h = harness({ stored: STORED, drafts: [DRAFT] })
    await settlePassRetryCustody(h.deps)
    expect(h.calls).toEqual(['write:I wait.'])
  })

  it('writes a held entry without text when the composer is empty', async () => {
    const h = harness({ drafts: [{ text: '  ', mode: 'free' }] })
    await settlePassRetryCustody(h.deps)
    expect(h.calls).toEqual(['write:none'])
  })

  it('writes a held entry without text when no composer is mounted', async () => {
    const h = harness({ drafts: [undefined] })
    await settlePassRetryCustody(h.deps)
    expect(h.calls).toEqual(['write:none'])
  })

  it("leaves another branch's draft alone", async () => {
    const h = harness({ drafts: [DRAFT], onBranch: [false] })
    await settlePassRetryCustody(h.deps)
    expect(h.calls).toEqual(['write:none'])
  })

  it('rewrites a failed entry with its own text', async () => {
    const h = harness({ held: false, stored: STORED, drafts: [DRAFT] })
    await settlePassRetryCustody(h.deps)
    expect(h.calls).toEqual(['write:I wait.'])
  })

  it('leaves the draft alone when a failed entry has no text', async () => {
    const h = harness({ held: false, drafts: [DRAFT] })
    await settlePassRetryCustody(h.deps)
    expect(h.calls).toEqual(['write:none'])
  })

  // Typed during the write: the entry holds the snapshot, the composer the newer text.
  it('leaves a draft edited during the write in the composer', async () => {
    const h = harness({ drafts: [DRAFT, { ...DRAFT, text: 'draw my blade and' }] })
    await settlePassRetryCustody(h.deps)
    expect(h.calls).toEqual(['write:wrapped:draw my blade'])
  })

  it('leaves a draft whose mode changed during the write in the composer', async () => {
    const h = harness({ drafts: [DRAFT, { ...DRAFT, mode: 'say' }] })
    await settlePassRetryCustody(h.deps)
    expect(h.calls).toEqual(['write:wrapped:draw my blade'])
  })

  it('leaves the composer alone when the user left the branch during the write', async () => {
    const h = harness({ drafts: [DRAFT], onBranch: [true, false] })
    await settlePassRetryCustody(h.deps)
    expect(h.calls).toEqual(['write:wrapped:draw my blade'])
  })

  // The text must still be somewhere: a failed write leaves it in the composer.
  it('lets a failed write through before emptying the composer', async () => {
    const h = harness({ drafts: [DRAFT] })
    h.deps.write.mockRejectedValueOnce(new Error('insert failed'))
    await expect(settlePassRetryCustody(h.deps)).rejects.toThrow('insert failed')
    expect(h.deps.clearDraft).not.toHaveBeenCalled()
  })
})
