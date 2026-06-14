import { describe, expect, it } from 'vitest'

import { storiesStore } from './stories'

// The read→apply round-trip is covered by the action tests (insert → action → store reflects it);
// here we test the in-memory-only surface.
describe('storiesStore', () => {
  it('open-failure write/clear is in-memory and pruned on clear', () => {
    storiesStore.__reset()
    storiesStore.setOpenFailure({ storyId: 's1', kind: 'definition-corrupt' })
    expect(storiesStore.getStories().openFailures.s1).toBe('definition-corrupt')
    storiesStore.clearOpenFailure('s1')
    expect('s1' in storiesStore.getStories().openFailures).toBe(false)
  })

  it('__reset clears rows and failures', () => {
    storiesStore.setOpenFailure({ storyId: 'x', kind: 'settings-corrupt' })
    storiesStore.__reset()
    expect(storiesStore.getStories()).toEqual({ rows: [], openFailures: {} })
  })
})
