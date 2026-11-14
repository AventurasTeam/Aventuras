import { describe, expect, it } from 'vitest'

import { chapterListLabel } from './chapter-list-label'

describe('chapterListLabel', () => {
  it('names one chapter by its number', () => {
    expect(chapterListLabel([5])).toBe('5')
  })

  it('joins two chapters with "and"', () => {
    expect(chapterListLabel([5, 6])).toBe('5 and 6')
  })

  it('spans three chapters by their ends', () => {
    expect(chapterListLabel([5, 6, 7])).toBe('5–7')
  })

  it('spans four chapters by their ends', () => {
    expect(chapterListLabel([5, 6, 7, 8])).toBe('5–8')
  })

  it('reads empty for no chapters', () => {
    expect(chapterListLabel([])).toBe('')
  })
})
