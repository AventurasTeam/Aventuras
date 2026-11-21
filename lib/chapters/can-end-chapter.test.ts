import { describe, expect, it } from 'vitest'

import { canEndInOpenRegion } from './can-end-chapter'

describe('canEndInOpenRegion', () => {
  it('takes an ai_reply no chapter holds', () => {
    expect(canEndInOpenRegion({ kind: 'ai_reply', chapterId: null })).toBe(true)
  })

  it('refuses an ai_reply a chapter already holds', () => {
    expect(canEndInOpenRegion({ kind: 'ai_reply', chapterId: 'chapter_1' })).toBe(false)
  })

  it('refuses an open-region row a chapter cannot end on', () => {
    expect(canEndInOpenRegion({ kind: 'user_action', chapterId: null })).toBe(false)
  })
})
