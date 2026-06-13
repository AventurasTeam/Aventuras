import { describe, expect, it } from 'vitest'

import type { Story as StoryRow } from '@/lib/db'

import { hydrateStories, storiesStore } from './stories'

const ROW = { id: 's1', title: 'T' } as StoryRow

describe('storiesStore', () => {
  it('hydrate applies rows; selectors read them', async () => {
    storiesStore.__reset()
    await hydrateStories(async () => [ROW])
    expect(storiesStore.getStories().rows).toHaveLength(1)
  })

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
