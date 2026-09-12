import { describe, expect, it, vi } from 'vitest'

import { buildGoToGroup, inStoryRoute } from './go-to-group'

const STORY = { storyId: 'story_1', branchId: 'br_1' }

describe('inStoryRoute', () => {
  it('maps built surfaces to their routes and unbuilt ones to null', () => {
    expect(inStoryRoute('reader', STORY)).toBe('/reader-composer/br_1')
    expect(inStoryRoute('world', STORY)).toBe('/world/br_1')
    expect(inStoryRoute('story-settings', STORY)).toBe('/story-settings/story_1')
    expect(inStoryRoute('plot', STORY)).toBeNull()
    expect(inStoryRoute('chapter-timeline', STORY)).toBeNull()
  })
})

describe('buildGoToGroup', () => {
  it('omits the current surface and navigates the others', () => {
    const navigate = vi.fn()
    const group = buildGoToGroup({ ...STORY, surface: 'world' }, navigate)
    expect(group.header).toBe('Go to')
    expect(group.entries.map((e) => e.id)).toEqual([
      'open-reader',
      'open-plot',
      'open-chapter-timeline',
      'open-story-settings',
    ])
    group.entries.find((e) => e.id === 'open-reader')?.onActivate()
    expect(navigate).toHaveBeenCalledWith('/reader-composer/br_1')
    group.entries.find((e) => e.id === 'open-story-settings')?.onActivate()
    expect(navigate).toHaveBeenCalledWith('/story-settings/story_1')
  })

  it('renders unbuilt surfaces present-but-disabled with their lands-later reason', () => {
    const navigate = vi.fn()
    const group = buildGoToGroup({ ...STORY, surface: 'reader' }, navigate)
    expect(group.entries.map((e) => e.id)).toContain('open-world')
    expect(group.entries.map((e) => e.id)).not.toContain('open-reader')
    const plot = group.entries.find((e) => e.id === 'open-plot')
    expect(plot?.disabled).toBe(true)
    expect(plot?.disabledReason).toBe('Plot lands in Slice 4.3')
    plot?.onActivate()
    expect(navigate).not.toHaveBeenCalled()
  })
})
