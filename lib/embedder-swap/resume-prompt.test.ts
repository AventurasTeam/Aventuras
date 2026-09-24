import { describe, expect, it } from 'vitest'

import { swapResumePromptOpen, type SwapResumePromptInput } from './resume-prompt'

const OPEN: SwapResumePromptInput = {
  storyId: 'story-1',
  swapTarget: 'onnx-community/embeddinggemma-300m-ONNX',
  swapRunning: false,
  deferredForThisStory: false,
  recoveryActive: false,
}

describe('swapResumePromptOpen', () => {
  it('opens for an open story carrying a swap marker', () => {
    expect(swapResumePromptOpen(OPEN)).toBe(true)
  })

  it.each<[string, Partial<SwapResumePromptInput>]>([
    ['no open story', { storyId: null }],
    ['no swap marker', { swapTarget: null }],
    ['swap already running', { swapRunning: true }],
    ['deferred for this story', { deferredForThisStory: true }],
    ['crash-recovery report still open', { recoveryActive: true }],
  ])('stays closed: %s', (_label, override) => {
    expect(swapResumePromptOpen({ ...OPEN, ...override })).toBe(false)
  })
})
