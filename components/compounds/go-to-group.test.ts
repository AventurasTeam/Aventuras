import { describe, expect, it, vi } from 'vitest'

import { buildGoToGroup, IN_STORY_SURFACES } from './go-to-group'

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

  it('routes Plot by branch', () => {
    const navigate = vi.fn()
    const group = buildGoToGroup({ ...STORY, surface: 'reader' }, navigate)
    const plot = group.entries.find((e) => e.id === 'open-plot')
    plot?.onActivate()
    expect(navigate).toHaveBeenCalledWith('/plot/br_1')
    expect(plot?.disabled).toBeUndefined()
  })

  it('routes the Chapter Timeline by branch', () => {
    const navigate = vi.fn()
    const group = buildGoToGroup({ ...STORY, surface: 'reader' }, navigate)
    group.entries.find((e) => e.id === 'open-chapter-timeline')?.onActivate()
    expect(navigate).toHaveBeenCalledExactlyOnceWith('/chapter-timeline/br_1')
  })

  it('omits the Chapter Timeline on the Timeline itself', () => {
    const group = buildGoToGroup({ ...STORY, surface: 'chapter-timeline' }, vi.fn())
    expect(group.entries.map((e) => e.id)).toEqual([
      'open-reader',
      'open-world',
      'open-plot',
      'open-story-settings',
    ])
  })

  it.each([...IN_STORY_SURFACES])('disables no entry on %s', (surface) => {
    const group = buildGoToGroup({ ...STORY, surface }, vi.fn())
    expect(group.entries).toHaveLength(IN_STORY_SURFACES.length - 1)
    expect(group.entries.filter((e) => e.disabled === true).map((e) => e.id)).toEqual([])
  })
})
