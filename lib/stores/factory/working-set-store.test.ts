// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createWorkingSetStore, type WorkingSetStore } from './working-set-store'

type Row = { id: string; name: string }

afterEach(cleanup)

// Counts snapshots, not renders: React batches every store change inside one act() into a
// single render, so a render count can't tell one notification from fifty.
function trackNotifications(store: WorkingSetStore<Row>): () => number {
  const seen = new Set<ReadonlyMap<string, Row>>()
  renderHook(() =>
    store.useRows((rows) => {
      seen.add(rows)
      return rows.size
    }),
  )
  const before = seen.size
  return () => seen.size - before
}

const rowsNamed = (count: number): Row[] =>
  Array.from({ length: count }, (_, i) => ({ id: `x_${i}`, name: `row ${i}` }))

describe('createWorkingSetStore', () => {
  it('hydrates a branch, patches create/update/delete, and reads via selector', () => {
    const store = createWorkingSetStore<Row>()
    store.hydrate('br_1', [{ id: 'x_1', name: 'a' }])
    expect(store.getLoadedBranch()).toBe('br_1')

    store.patch('br_1', { op: 'create', id: 'x_2', row: { id: 'x_2', name: 'b' } })
    expect(store.getRows().get('x_2')?.name).toBe('b')

    store.patch('br_1', { op: 'update', id: 'x_1', columns: { name: 'a2' } })
    expect(store.getRows().get('x_1')?.name).toBe('a2')

    store.patch('br_1', { op: 'delete', id: 'x_2' })
    expect(store.getRows().has('x_2')).toBe(false)
  })

  it('no-ops a patch targeting a non-held branch', () => {
    const store = createWorkingSetStore<Row>()
    store.hydrate('br_1', [])
    store.patch('br_2', { op: 'create', id: 'x_9', row: { id: 'x_9', name: 'z' } })
    expect(store.getRows().has('x_9')).toBe(false)
  })

  it('no-ops an update patch for an id absent from the working set (never synthesizes a partial row)', () => {
    const store = createWorkingSetStore<Row>()
    store.hydrate('br_1', [{ id: 'x_1', name: 'a' }])
    // e.g. a stale operational write for a row deleted (or never hydrated) on the held branch
    store.patch('br_1', { op: 'update', id: 'gone', columns: { name: 'partial' } })
    expect(store.getRows().has('gone')).toBe(false)
    expect(store.getRows().size).toBe(1)
  })

  it('__reset clears rows and loadedBranch', () => {
    const store = createWorkingSetStore<Row>()
    store.hydrate('br_1', [{ id: 'x_1', name: 'a' }])
    store.__reset()
    expect(store.getLoadedBranch()).toBeNull()
    expect(store.getRows().size).toBe(0)
  })

  it('re-hydrate replaces the prior branch rows and flips the loaded branch', () => {
    const store = createWorkingSetStore<Row>()
    store.hydrate('br_1', [{ id: 'x_1', name: 'a' }])
    store.hydrate('br_2', [{ id: 'y_1', name: 'b' }])
    expect(store.getLoadedBranch()).toBe('br_2')
    expect(store.getRows().has('x_1')).toBe(false) // prior branch's rows gone
    expect(store.getRows().get('y_1')?.name).toBe('b')
    // a patch for the OLD branch now no-ops (loadedBranch flipped)
    store.patch('br_1', { op: 'create', id: 'x_2', row: { id: 'x_2', name: 'c' } })
    expect(store.getRows().has('x_2')).toBe(false)
  })

  it('does not conditionally hydrate a branch after another branch became active', () => {
    const store = createWorkingSetStore<Row>()
    store.hydrate('br_2', [{ id: 'y_1', name: 'active' }])

    expect(store.hydrateIfLoaded('br_1', [{ id: 'x_1', name: 'stale' }])).toBe(false)
    expect(store.getLoadedBranch()).toBe('br_2')
    expect([...store.getRows().values()]).toEqual([{ id: 'y_1', name: 'active' }])
  })

  it('conditionally hydrates the branch that is still active', () => {
    const store = createWorkingSetStore<Row>()
    store.hydrate('br_1', [{ id: 'x_1', name: 'old' }])

    expect(store.hydrateIfLoaded('br_1', [{ id: 'x_1', name: 'fresh' }])).toBe(true)
    expect([...store.getRows().values()]).toEqual([{ id: 'x_1', name: 'fresh' }])
  })

  describe('insertMany', () => {
    it('writes every row in one notification', () => {
      const store = createWorkingSetStore<Row>()
      store.hydrate('br_1', [])
      const notifications = trackNotifications(store)

      act(() => store.insertMany('br_1', rowsNamed(50)))

      expect(store.getRows().size).toBe(50)
      expect(notifications()).toBe(1)
    })

    it('no-ops with no notification for a branch other than the loaded one', () => {
      const store = createWorkingSetStore<Row>()
      store.hydrate('br_1', [])
      const notifications = trackNotifications(store)

      act(() => store.insertMany('br_2', rowsNamed(3)))

      expect(store.getRows().size).toBe(0)
      expect(notifications()).toBe(0)
    })

    it('no-ops with no notification for an empty list', () => {
      const store = createWorkingSetStore<Row>()
      store.hydrate('br_1', [{ id: 'x_1', name: 'a' }])
      const before = store.getRows()
      const notifications = trackNotifications(store)

      act(() => store.insertMany('br_1', []))

      expect(store.getRows()).toBe(before)
      expect(notifications()).toBe(0)
    })

    it('keeps a row already in the store over the incoming one', () => {
      const store = createWorkingSetStore<Row>()
      store.hydrate('br_1', [{ id: 'x_1', name: 'edited during the read' }])

      store.insertMany('br_1', [
        { id: 'x_1', name: 'stale read' },
        { id: 'x_2', name: 'new' },
      ])

      expect(store.getRows().get('x_1')?.name).toBe('edited during the read')
      expect(store.getRows().get('x_2')?.name).toBe('new')
    })

    it('no-ops with no notification when every incoming row is already held', () => {
      const store = createWorkingSetStore<Row>()
      store.hydrate('br_1', [{ id: 'x_1', name: 'a' }])
      const before = store.getRows()
      const notifications = trackNotifications(store)

      act(() => store.insertMany('br_1', [{ id: 'x_1', name: 'stale read' }]))

      expect(store.getRows()).toBe(before)
      expect(notifications()).toBe(0)
    })
  })

  it('calls a direct subscriber once per change and stops after unsubscribe', () => {
    const store = createWorkingSetStore<Row>()
    store.hydrate('br_1', [])
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)

    store.insertMany('br_1', rowsNamed(2))
    expect(listener).toHaveBeenCalledTimes(1)

    unsubscribe()
    store.insertMany('br_1', [{ id: 'x_9', name: 'late' }])
    expect(listener).toHaveBeenCalledTimes(1)
    expect(store.getRows().has('x_9')).toBe(true)
  })
})
