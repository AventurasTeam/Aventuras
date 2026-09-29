import { describe, it, expect } from 'vitest'
import type { StoryEntry } from '$lib/types'
import { CLEAN_NONE } from '$lib/utils/narrationClean'
import { buildReviewPassages } from './styleReviewPassages'

function entry(
  content: string,
  position: number,
  type: StoryEntry['type'] = 'narration',
): StoryEntry {
  return {
    id: `e${position}`,
    storyId: 's1',
    type,
    content,
    parentId: null,
    position,
    createdAt: position,
    metadata: null,
    branchId: null,
  }
}

const PIC_ONLY = '<pic prompt="A tavern interior, dark fantasy art style" characters=""></pic>'

describe('buildReviewPassages', () => {
  it('numbers the passages oldest first', () => {
    const { passages, count } = buildReviewPassages([entry('One.', 0), entry('Two.', 1)], 5)
    expect(passages).toBe('--- Passage 1 ---\nOne.\n\n--- Passage 2 ---\nTwo.')
    expect(count).toBe(2)
  })

  it('takes the window from the end', () => {
    const entries = ['a', 'b', 'c', 'd'].map((c, i) => entry(c, i))
    expect(buildReviewPassages(entries, 2).passages).toBe(
      '--- Passage 1 ---\nc\n\n--- Passage 2 ---\nd',
    )
  })

  it('ignores player actions and system notes', () => {
    const entries = [
      entry('Walk.', 0, 'user_action'),
      entry('Note.', 1, 'system'),
      entry('She walks.', 2),
    ]
    expect(buildReviewPassages(entries, 5)).toEqual({
      passages: '--- Passage 1 ---\nShe walks.',
      count: 1,
    })
  })

  it('cleans each passage', () => {
    const { passages } = buildReviewPassages(
      [entry('### Dawn | The Keep\n\n<p>She wakes.</p>\n\n***', 0)],
      5,
    )
    expect(passages).toBe('--- Passage 1 ---\nShe wakes.')
  })

  it('skips an entry that is only markup without shrinking the window', () => {
    const entries = [
      entry('First.', 0),
      entry('Second.', 1),
      entry(PIC_ONLY, 2),
      entry('Third.', 3),
    ]
    const { passages, count } = buildReviewPassages(entries, 3)
    expect(passages).toBe(
      '--- Passage 1 ---\nFirst.\n\n--- Passage 2 ---\nSecond.\n\n--- Passage 3 ---\nThird.',
    )
    expect(count).toBe(3)
  })

  it('is empty when nothing readable is left', () => {
    expect(buildReviewPassages([entry(PIC_ONLY, 0)], 5)).toEqual({ passages: '', count: 0 })
    expect(buildReviewPassages([], 5)).toEqual({ passages: '', count: 0 })
  })

  it('is empty for a window of zero, not the whole story', () => {
    expect(buildReviewPassages([entry('One.', 0)], 0)).toEqual({ passages: '', count: 0 })
  })

  it('keeps and counts a markup-only entry when cleaning is off', () => {
    const { passages, count } = buildReviewPassages([entry(PIC_ONLY, 0)], 5, CLEAN_NONE)
    expect(passages).toBe(`--- Passage 1 ---\n${PIC_ONLY}`)
    expect(count).toBe(1)
  })
})
