import { describe, it, expect } from 'vitest'
import { beginStoryBlocker, type BeginStoryState } from './beginStory'

const ready: BeginStoryState = {
  title: 'Harbour',
  opening: 'written',
  startIsValid: true,
  busy: null,
}

describe('beginStoryBlocker', () => {
  it('is null when the story can begin', () => {
    expect(beginStoryBlocker(ready)).toBeNull()
  })

  it('names an unreadable starting time and the field it is in', () => {
    expect(beginStoryBlocker({ ...ready, opening: 'imported', startIsValid: false })).toBe(
      'The Starting Time under the imported opening is not a time, e.g. Y1 D1 19:00.',
    )
  })

  it('asks for the title before anything else', () => {
    expect(beginStoryBlocker({ ...ready, title: '', opening: null })).toMatch(/title/)
  })

  it('asks for an opening before its time', () => {
    expect(beginStoryBlocker({ ...ready, opening: null, startIsValid: false })).toMatch(/opening/)
  })

  it('waits out work on the opening', () => {
    expect(beginStoryBlocker({ ...ready, busy: 'generating' })).toMatch(/generating/)
    expect(beginStoryBlocker({ ...ready, busy: 'editing' })).toMatch(/edit/)
  })
})
