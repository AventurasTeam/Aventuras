import { describe, expect, it, vi } from 'vitest'

import { buildGoToGroup } from './go-to-group'

const STORY = { storyId: 'story_1', branchId: 'br_1' }

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

  it('routes World by branch', () => {
    const navigate = vi.fn()
    const group = buildGoToGroup({ ...STORY, surface: 'reader' }, navigate)
    group.entries.find((e) => e.id === 'open-world')?.onActivate()
    expect(navigate).toHaveBeenCalledExactlyOnceWith('/world/br_1')
  })

  it('renders unbuilt surfaces present-but-disabled with their lands-later reason', () => {
    const navigate = vi.fn()
    const group = buildGoToGroup({ ...STORY, surface: 'reader' }, navigate)
    expect(group.entries.map((e) => e.id)).not.toContain('open-reader')
    const plot = group.entries.find((e) => e.id === 'open-plot')
    expect(plot?.disabled).toBe(true)
    expect(plot?.disabledReason).toBe('Plot lands in Slice 4.3')
    expect(group.entries.find((e) => e.id === 'open-chapter-timeline')?.disabled).toBe(true)
    plot?.onActivate()
    expect(navigate).not.toHaveBeenCalled()
  })
})
