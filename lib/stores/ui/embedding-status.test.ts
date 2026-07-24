import { beforeEach, describe, expect, it } from 'vitest'

import { embeddingStatusStore } from './embedding-status'

describe('embeddingStatusStore', () => {
  beforeEach(() => embeddingStatusStore.__reset())

  it('starts with no story tracked', () => {
    expect(embeddingStatusStore.getState()).toEqual({ storyId: null, staleTotal: 0 })
  })

  it('setStatus records the story and its stale count', () => {
    embeddingStatusStore.setStatus('story-1', 12)
    expect(embeddingStatusStore.getState()).toEqual({ storyId: 'story-1', staleTotal: 12 })
  })

  it('setStatus for a new story replaces the prior one (single-slot store)', () => {
    embeddingStatusStore.setStatus('story-1', 12)
    embeddingStatusStore.setStatus('story-2', 3)
    expect(embeddingStatusStore.getState()).toEqual({ storyId: 'story-2', staleTotal: 3 })
  })

  it('clear resets to the initial state', () => {
    embeddingStatusStore.setStatus('story-1', 12)
    embeddingStatusStore.clear()
    expect(embeddingStatusStore.getState()).toEqual({ storyId: null, staleTotal: 0 })
  })
})
