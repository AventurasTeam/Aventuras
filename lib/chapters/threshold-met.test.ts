import { describe, expect, it } from 'vitest'

import { thresholdMet } from './threshold-met'

// chapter-close.md → the threshold met with a reply to end on, shared by the auto close and the label.
describe('thresholdMet', () => {
  it.each([
    { tokens: 999, canClose: true, met: false },
    { tokens: 999, canClose: false, met: false },
    { tokens: 1000, canClose: true, met: true },
    { tokens: 1000, canClose: false, met: false },
    { tokens: 2500, canClose: true, met: true },
    { tokens: 2500, canClose: false, met: false },
  ])('reads $tokens of 1000 tokens and canClose $canClose as $met', ({ tokens, canClose, met }) => {
    expect(thresholdMet({ tokens, threshold: 1000, canClose })).toBe(met)
  })
})
