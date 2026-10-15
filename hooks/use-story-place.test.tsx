// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import type { StoryEntry } from '@/lib/db'
import { entriesStore, resetAllStores } from '@/lib/stores'
import type { StoryPlace } from '@/lib/world'

import { useStoryPlace } from './use-story-place'

function entry(
  id: string,
  position: number,
  kind: StoryEntry['kind'],
  currentLocationId: string | null,
): StoryEntry {
  return {
    id,
    branchId: 'br_1',
    position,
    kind,
    content: '',
    chapterId: null,
    metadata: { sceneEntities: [], currentLocationId, worldTime: 0 },
    createdAt: position,
  }
}

let latest: StoryPlace | null = null

function Probe() {
  latest = useStoryPlace('br_1')
  return null
}

afterEach(() => {
  cleanup()
  resetAllStores()
  latest = null
})

describe('useStoryPlace', () => {
  // A user_action standing at the tail, a banner past it, and the store's rows out of order.
  it("reads the narrative tail's place and the latest reply's, in position order", () => {
    entriesStore.hydrate('br_1', [
      entry('e_banner', 4, 'system', null),
      entry('e_action', 3, 'user_action', 'loc_tail'),
      entry('e_opening', 1, 'opening', 'loc_opening'),
      entry('e_reply', 2, 'ai_reply', 'loc_reply'),
    ])
    render(<Probe />)
    expect(latest).toEqual({ tail: 'loc_tail', scene: 'loc_reply' })
  })
})
