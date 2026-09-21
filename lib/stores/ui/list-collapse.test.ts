import { beforeEach, describe, expect, it } from 'vitest'

import { listCollapseStore } from './list-collapse'

const WORLD_DEFAULTS: ReadonlySet<string> = new Set(['staged', 'retired'])
const THREAD_DEFAULTS: ReadonlySet<string> = new Set(['pending', 'resolved', 'failed'])

describe('listCollapseStore', () => {
  beforeEach(() => {
    listCollapseStore.__reset()
  })

  it('answers the kind defaults until something changes', () => {
    expect(listCollapseStore.getCollapsed('character', WORLD_DEFAULTS)).toBe(WORLD_DEFAULTS)
  })

  it('keys collapse per kind', () => {
    listCollapseStore.setCollapsed('character', 'staged', false, WORLD_DEFAULTS)
    expect(listCollapseStore.getCollapsed('character', WORLD_DEFAULTS).has('staged')).toBe(false)
    expect(listCollapseStore.getCollapsed('location', WORLD_DEFAULTS).has('staged')).toBe(true)
  })

  it('keeps `active` apart across vocabularies', () => {
    listCollapseStore.setCollapsed('character', 'active', true, WORLD_DEFAULTS)
    expect(listCollapseStore.getCollapsed('thread', THREAD_DEFAULTS).has('active')).toBe(false)
  })

  it('keeps the set reference when nothing changes', () => {
    listCollapseStore.setCollapsed('thread', 'pending', false, THREAD_DEFAULTS)
    const before = listCollapseStore.getCollapsed('thread', THREAD_DEFAULTS)
    listCollapseStore.setCollapsed('thread', 'pending', false, THREAD_DEFAULTS)
    expect(listCollapseStore.getCollapsed('thread', THREAD_DEFAULTS)).toBe(before)
  })
})
