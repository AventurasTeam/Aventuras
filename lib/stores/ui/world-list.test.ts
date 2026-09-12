import { beforeEach, describe, expect, it } from 'vitest'

import { worldListStore } from './world-list'

describe('worldListStore', () => {
  beforeEach(() => {
    worldListStore.__reset()
  })

  it('starts with Staged and Retired collapsed and Active open', () => {
    const collapsed = worldListStore.getCollapsedTiers()
    expect([...collapsed].sort()).toEqual(['retired', 'staged'])
  })

  it('expands and re-collapses a tier', () => {
    worldListStore.setCollapsed('staged', false)
    expect(worldListStore.getCollapsedTiers().has('staged')).toBe(false)
    worldListStore.setCollapsed('active', true)
    expect(worldListStore.getCollapsedTiers().has('active')).toBe(true)
  })

  it('keeps the set reference when nothing changes', () => {
    const before = worldListStore.getCollapsedTiers()
    worldListStore.setCollapsed('staged', true)
    expect(worldListStore.getCollapsedTiers()).toBe(before)
  })
})
