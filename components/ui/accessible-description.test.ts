import { beforeEach, describe, expect, it, vi } from 'vitest'

import { describedBy } from './accessible-description'

const platform = vi.hoisted(() => ({ OS: 'web' }))
vi.mock('react-native', () => ({ Platform: platform }))

describe('describedBy', () => {
  beforeEach(() => {
    platform.OS = 'web'
  })

  it('points web at the description elements, in order', () => {
    expect(describedBy(['a', 'b'], 'ignored')).toEqual({ 'aria-describedby': 'a b' })
  })

  it('adds nothing on web with no element to point at', () => {
    expect(describedBy([], 'reason')).toEqual({})
  })

  it('gives native the text as its hint, with or without elements', () => {
    platform.OS = 'android'
    expect(describedBy(['a'], 'summary, meta')).toEqual({ accessibilityHint: 'summary, meta' })
    expect(describedBy([], 'reason')).toEqual({ accessibilityHint: 'reason' })
  })

  it('adds nothing on native with no text', () => {
    platform.OS = 'android'
    expect(describedBy(['a'], '')).toEqual({})
  })
})
