import { beforeEach, describe, expect, it } from 'vitest'

import { embedderSwapStore, openEmbedderSwapDialog } from './embedder-swap'

describe('embedderSwapStore', () => {
  beforeEach(() => embedderSwapStore.__reset())

  it('openEmbedderSwapDialog stores the story id and opens the dialog', () => {
    openEmbedderSwapDialog('story-1')
    expect(embedderSwapStore.getState().dialog).toEqual({ storyId: 'story-1' })
  })

  it('closeDialog clears dialog state but not progress', () => {
    openEmbedderSwapDialog('story-1')
    embedderSwapStore.setProgress({ storyId: 'story-1', done: 3, total: 10 })
    embedderSwapStore.closeDialog()
    expect(embedderSwapStore.getState().dialog).toBeNull()
    expect(embedderSwapStore.getState().progress['story-1']).toEqual({
      storyId: 'story-1',
      done: 3,
      total: 10,
      cancelRequested: false,
    })
  })

  it('requestCancel flips the cancel flag the engine polls', () => {
    embedderSwapStore.beginProgress('story-1')
    embedderSwapStore.requestCancel('story-1')
    expect(embedderSwapStore.isCancelRequested('story-1')).toBe(true)
    embedderSwapStore.clearProgress('story-1')
    expect(embedderSwapStore.isCancelRequested('story-1')).toBe(false)
    expect(embedderSwapStore.getState().progress['story-1']).toBeUndefined()
  })

  it('per-batch setProgress keeps a cancel already requested against the run', () => {
    embedderSwapStore.beginProgress('story-1')
    embedderSwapStore.requestCancel('story-1')
    embedderSwapStore.setProgress({ storyId: 'story-1', done: 16, total: 64 })
    expect(embedderSwapStore.isCancelRequested('story-1')).toBe(true)
  })

  it('beginProgress opens a run that is necessarily un-cancelled', () => {
    embedderSwapStore.beginProgress('story-1')
    embedderSwapStore.requestCancel('story-1')
    embedderSwapStore.beginProgress('story-1')
    expect(embedderSwapStore.isCancelRequested('story-1')).toBe(false)
  })

  it('a second story staging concurrently cannot disturb the first run', () => {
    embedderSwapStore.beginProgress('story-1')
    embedderSwapStore.requestCancel('story-1')

    // The swap lock is per-story, so story-2 may legitimately start while
    // story-1 is mid-stage. It must not inherit or clear story-1's cancel.
    embedderSwapStore.beginProgress('story-2')
    expect(embedderSwapStore.isCancelRequested('story-1')).toBe(true)
    expect(embedderSwapStore.isCancelRequested('story-2')).toBe(false)

    // Nor may story-1's per-batch reporting overwrite story-2's counts.
    embedderSwapStore.setProgress({ storyId: 'story-1', done: 8, total: 64 })
    embedderSwapStore.setProgress({ storyId: 'story-2', done: 1, total: 2 })
    expect(embedderSwapStore.getState().progress['story-1']?.done).toBe(8)
    expect(embedderSwapStore.getState().progress['story-2']?.done).toBe(1)

    // And finishing one leaves the other's run untouched.
    embedderSwapStore.clearProgress('story-2')
    expect(embedderSwapStore.getState().progress['story-2']).toBeUndefined()
    expect(embedderSwapStore.isCancelRequested('story-1')).toBe(true)
  })

  it('deferResume records one story and is replaced, not accumulated', () => {
    embedderSwapStore.deferResume('story-1')
    expect(embedderSwapStore.getState().resumeDeferredFor).toBe('story-1')
    // Single slot: deferring another story releases the first, so returning to it
    // prompts again rather than inheriting a suppression it never asked for.
    embedderSwapStore.deferResume('story-2')
    expect(embedderSwapStore.getState().resumeDeferredFor).toBe('story-2')
    embedderSwapStore.clearDeferredResume()
    expect(embedderSwapStore.getState().resumeDeferredFor).toBeNull()
  })

  it('deferring does not touch the swap marker or progress', () => {
    embedderSwapStore.beginProgress('story-1')
    embedderSwapStore.deferResume('story-1')
    // Later hides the prompt, never the condition behind it.
    expect(embedderSwapStore.getState().progress['story-1']?.storyId).toBe('story-1')
  })

  it('expires a resume deferral when another story becomes current', () => {
    embedderSwapStore.deferResume('story-1')

    embedderSwapStore.expireDeferredResume('story-2', 'model-b')

    expect(embedderSwapStore.getState().resumeDeferredFor).toBeNull()
  })

  it('expires a resume deferral when its swap marker clears', () => {
    embedderSwapStore.deferResume('story-1')

    embedderSwapStore.expireDeferredResume('story-1', null)

    expect(embedderSwapStore.getState().resumeDeferredFor).toBeNull()
  })

  it('keeps a resume deferral while its story and marker still match', () => {
    embedderSwapStore.deferResume('story-1')

    embedderSwapStore.expireDeferredResume('story-1', 'model-a')

    expect(embedderSwapStore.getState().resumeDeferredFor).toBe('story-1')
  })

  it('requestCancel with no run in flight cannot leave a flag behind', () => {
    embedderSwapStore.requestCancel('story-1')
    expect(embedderSwapStore.getState().progress['story-1']).toBeUndefined()
    openEmbedderSwapDialog('story-2')
    // Nesting the flag under the run entry is what makes this structural: there
    // is no slot for a cancel to sit in while nothing is running.
    expect(embedderSwapStore.isCancelRequested('story-1')).toBe(false)
    expect(embedderSwapStore.getState().dialog).toEqual({ storyId: 'story-2' })
  })
})
