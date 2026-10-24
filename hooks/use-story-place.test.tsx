// @vitest-environment jsdom
import { act, cleanup, render, renderHook } from '@testing-library/react'
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

  // Its consumers memo on the value, so an entries patch that moves no place must not rebuild them.
  it('keeps its identity through a patch that moves neither place, and not through one that does', () => {
    entriesStore.hydrate('br_1', [
      entry('e_opening', 1, 'opening', 'loc_opening'),
      entry('e_reply', 2, 'ai_reply', 'loc_reply'),
      entry('e_action', 3, 'user_action', 'loc_tail'),
    ])
    const { result } = renderHook(() => useStoryPlace('br_1'))
    const first = result.current
    const moveTo = (id: string, currentLocationId: string) =>
      act(() => {
        entriesStore.patch('br_1', {
          op: 'update',
          id,
          columns: { metadata: { sceneEntities: [], currentLocationId, worldTime: 0 } },
        })
      })

    act(() => {
      entriesStore.patch('br_1', { op: 'update', id: 'e_opening', columns: { content: 'edited' } })
    })
    expect(result.current).toBe(first)

    // The reply is the scene source under the action at the tail, so only the scene moves.
    moveTo('e_reply', 'loc_moved')
    const sceneMoved = result.current
    expect(sceneMoved).not.toBe(first)
    expect(sceneMoved).toEqual({ tail: 'loc_tail', scene: 'loc_moved' })

    moveTo('e_action', 'loc_moved')
    expect(result.current).not.toBe(sceneMoved)
    expect(result.current).toEqual({ tail: 'loc_moved', scene: 'loc_moved' })
  })
})
