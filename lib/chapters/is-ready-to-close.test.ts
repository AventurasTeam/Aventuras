import { describe, expect, it } from 'vitest'

import { isReadyToClose } from './is-ready-to-close'

// chapter-close.md → Manual user-triggered close.
describe('isReadyToClose', () => {
  it.each([
    { autoClose: false, tokens: 1000, canClose: true, ready: true },
    { autoClose: false, tokens: 1000, canClose: false, ready: false },
    { autoClose: false, tokens: 999, canClose: true, ready: false },
    { autoClose: false, tokens: 999, canClose: false, ready: false },
    { autoClose: true, tokens: 1000, canClose: true, ready: false },
    { autoClose: true, tokens: 1000, canClose: false, ready: false },
    { autoClose: true, tokens: 999, canClose: true, ready: false },
    { autoClose: true, tokens: 999, canClose: false, ready: false },
  ])(
    'reads auto-close $autoClose, $tokens of 1000 tokens and canClose $canClose as $ready',
    ({ autoClose, tokens, canClose, ready }) => {
      expect(isReadyToClose({ tokens, threshold: 1000, canClose }, autoClose)).toBe(ready)
    },
  )

  it('reads a region past the threshold as ready', () => {
    expect(isReadyToClose({ tokens: 2500, threshold: 1000, canClose: true }, false)).toBe(true)
  })
})
