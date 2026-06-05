import { describe, expect, it } from 'vitest'

import { createWorkingSetStore } from './working-set-store'

type Row = { id: string; name: string }

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
})
