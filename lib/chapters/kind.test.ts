import { describe, expect, it } from 'vitest'

import { CHAPTER_CLOSE_KIND, CHAPTER_CLOSE_RERUN } from './kind'

describe('CHAPTER_CLOSE_RERUN', () => {
  // A gate reason tells a re-run from a close by it; a re-run's run is CHAPTER_CLOSE_KIND.
  it('names a re-run apart from the close pipeline it runs as', () => {
    expect(CHAPTER_CLOSE_RERUN).toBe('chapter-close-rerun')
    expect(CHAPTER_CLOSE_RERUN).not.toBe(CHAPTER_CLOSE_KIND)
  })
})
