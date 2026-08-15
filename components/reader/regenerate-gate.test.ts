import { describe, expect, it } from 'vitest'

import { classifyRegenerateGate } from './regenerate-gate'

describe('classifyRegenerateGate', () => {
  it('terminal reply (only itself removed) fires without confirm', () => {
    expect(classifyRegenerateGate({ entries: 1, chapters: 0, worldStateChanges: 4 })).toBe(
      'immediate',
    )
  })
  it('older reply (cascade removes later entries) requires the cascade confirm', () => {
    expect(classifyRegenerateGate({ entries: 3, chapters: 0, worldStateChanges: 7 })).toBe(
      'cascade-confirm',
    )
  })
  it('a chapter-close in the window routes to the M5.2 cost-confirm arm', () => {
    expect(classifyRegenerateGate({ entries: 1, chapters: 1, worldStateChanges: 9 })).toBe(
      'chapter-close-confirm',
    )
  })
})
