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
    })
  })

  it('requestCancel flips the cancel flag the engine polls', () => {
    embedderSwapStore.setProgress({ storyId: 'story-1', done: 0, total: 10 })
    embedderSwapStore.requestCancel()
    expect(embedderSwapStore.getState().cancelRequested).toBe(true)
    embedderSwapStore.clearProgress()
    expect(embedderSwapStore.getState().cancelRequested).toBe(false)
    expect(embedderSwapStore.getState().progress).toBeNull()
  })
})
