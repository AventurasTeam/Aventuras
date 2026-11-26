import { describe, it, expect } from 'vitest'
import { beginStoryBlocker, type BeginStoryState } from './beginStory'

const ready: BeginStoryState = {
  title: 'Harbour',
  opening: 'written',
  startText: 'Y1 D1 19:00',
  startIsValid: true,
  busy: null,
}

describe('beginStoryBlocker', () => {
  it('is null when the story can begin', () => {
    expect(beginStoryBlocker(ready)).toBeNull()
  })

  it('names a missing starting time and the field it goes in', () => {
    expect(
      beginStoryBlocker({ ...ready, opening: 'imported', startText: ' ', startIsValid: false }),
    ).toBe('Enter a Starting Time under the imported opening, e.g. Y1 D1 19:00.')
  })

  it('tells an invalid starting time from a missing one', () => {
    expect(beginStoryBlocker({ ...ready, startText: 'soon', startIsValid: false })).toMatch(
      /is not a time/,
    )
  })

  it('asks for the title before anything else', () => {
    expect(beginStoryBlocker({ ...ready, title: '', opening: null, startText: '' })).toMatch(
      /title/,
    )
  })

  it('asks for an opening before its time', () => {
    expect(beginStoryBlocker({ ...ready, opening: null, startText: '' })).toMatch(/opening/)
  })

  it('waits out work on the opening', () => {
    expect(beginStoryBlocker({ ...ready, busy: 'generating' })).toMatch(/generating/)
    expect(beginStoryBlocker({ ...ready, busy: 'editing' })).toMatch(/edit/)
  })
})
