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
    expect(embedderSwapStore.getState().progress).toEqual({
      storyId: 'story-1',
      done: 3,
      total: 10,
      cancelRequested: false,
    })
  })

  it('requestCancel flips the cancel flag the engine polls', () => {
    embedderSwapStore.beginProgress('story-1')
    embedderSwapStore.requestCancel()
    expect(embedderSwapStore.isCancelRequested()).toBe(true)
    embedderSwapStore.clearProgress()
    expect(embedderSwapStore.isCancelRequested()).toBe(false)
    expect(embedderSwapStore.getState().progress).toBeNull()
  })

  it('per-batch setProgress keeps a cancel already requested against the run', () => {
    embedderSwapStore.beginProgress('story-1')
    embedderSwapStore.requestCancel()
    embedderSwapStore.setProgress({ storyId: 'story-1', done: 16, total: 64 })
    expect(embedderSwapStore.isCancelRequested()).toBe(true)
  })

  it('beginProgress opens a run that is necessarily un-cancelled', () => {
    embedderSwapStore.beginProgress('story-1')
    embedderSwapStore.requestCancel()
    embedderSwapStore.beginProgress('story-2')
    expect(embedderSwapStore.isCancelRequested()).toBe(false)
  })

  it('requestCancel with no run in flight cannot leave a flag behind', () => {
    embedderSwapStore.requestCancel()
    expect(embedderSwapStore.getState().progress).toBeNull()
    openEmbedderSwapDialog('story-2')
    // Nesting the flag under `progress` is what makes this structural: there is
    // no slot for a cancel to sit in while nothing is running.
    expect(embedderSwapStore.isCancelRequested()).toBe(false)
    expect(embedderSwapStore.getState().dialog).toEqual({ storyId: 'story-2' })
  })
})
