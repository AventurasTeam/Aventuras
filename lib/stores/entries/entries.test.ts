import { afterEach, describe, expect, it } from 'vitest'

import type { StoryEntry } from '@/lib/db'

import { entriesStore } from './entries'

afterEach(() => entriesStore.__reset())

function row(id: string, position: number): StoryEntry {
  return {
    id,
    branchId: 'b1',
    position,
    kind: 'ai_reply',
    content: `c${id}`,
    chapterId: null,
    metadata: { sceneEntities: [], currentLocationId: null, worldTime: 0 },
    createdAt: 1,
  }
}

describe('entriesStore', () => {
  it('hydrates a branch and reads rows back by id', () => {
    entriesStore.hydrate('b1', [row('e1', 1), row('e2', 2)])
    expect(entriesStore.getLoadedBranch()).toBe('b1')
    expect(entriesStore.getById('e1')?.content).toBe('ce1')
    expect(entriesStore.getEntries().size).toBe(2)
  })

  it('applies create / update / delete patches to the held branch', () => {
    entriesStore.hydrate('b1', [row('e1', 1)])
    entriesStore.patch('b1', { op: 'create', id: 'e2', row: row('e2', 2) })
    entriesStore.patch('b1', { op: 'update', id: 'e1', columns: { content: 'edited' } })
    entriesStore.patch('b1', { op: 'delete', id: 'e2' })
    expect(entriesStore.getById('e1')?.content).toBe('edited')
    expect(entriesStore.getById('e2')).toBeUndefined()
  })

  it('ignores a patch for a non-held branch', () => {
    entriesStore.hydrate('b1', [row('e1', 1)])
    entriesStore.patch('other', { op: 'delete', id: 'e1' })
    expect(entriesStore.getById('e1')).toBeDefined()
  })
})
