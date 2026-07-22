import { describe, expect, it } from 'vitest'

import {
  computeSnapshot,
  removeSection,
  upsertSection,
  type SectionDirtyState,
} from './save-session-state'

const memory: SectionDirtyState = {
  id: 'embedding-status',
  order: 20,
  dirtyFields: ['embedder'],
}
const generation: SectionDirtyState = {
  id: 'authoring-aids',
  order: 10,
  dirtyFields: ['suggestions', 'suggestion count'],
}

describe('computeSnapshot', () => {
  it('reports a clean session for no sections', () => {
    expect(computeSnapshot([])).toEqual({ isDirty: false, dirtyFields: [], dirtyCount: 0 })
  })

  it('reports a clean session when every section is clean', () => {
    const snapshot = computeSnapshot([{ id: 'a', order: 0, dirtyFields: [] }])
    expect(snapshot).toEqual({ isDirty: false, dirtyFields: [], dirtyCount: 0 })
  })

  it('flattens dirty fields in ascending order, then by id', () => {
    const snapshot = computeSnapshot([memory, generation])
    expect(snapshot).toEqual({
      isDirty: true,
      dirtyFields: ['suggestions', 'suggestion count', 'embedder'],
      dirtyCount: 3,
    })
  })

  it('breaks an order tie deterministically by id', () => {
    const snapshot = computeSnapshot([
      { id: 'zulu', order: 0, dirtyFields: ['z'] },
      { id: 'alpha', order: 0, dirtyFields: ['a'] },
    ])
    expect(snapshot.dirtyFields).toEqual(['a', 'z'])
  })

  it('ignores clean sections when others are dirty', () => {
    const snapshot = computeSnapshot([generation, { id: 'quiet', order: 99, dirtyFields: [] }])
    expect(snapshot.dirtyCount).toBe(2)
  })
})

describe('upsertSection', () => {
  it('appends an unknown section', () => {
    expect(upsertSection([generation], memory)).toEqual([generation, memory])
  })

  it('replaces a known section in place', () => {
    const updated = { ...generation, dirtyFields: ['suggestions'] }
    expect(upsertSection([generation, memory], updated)).toEqual([updated, memory])
  })

  it('replaces a known section when only its order changed', () => {
    const moved = { ...generation, order: 30 }
    expect(upsertSection([generation, memory], moved)).toEqual([moved, memory])
  })

  it('replaces a known section when a dirty field is appended', () => {
    const grown = { ...memory, dirtyFields: ['embedder', 'auto-embed'] }
    expect(upsertSection([generation, memory], grown)).toEqual([generation, grown])
  })

  it('returns the same array reference when nothing changed', () => {
    const list = [generation]
    expect(upsertSection(list, { ...generation })).toBe(list)
  })
})

describe('removeSection', () => {
  it('drops the matching section', () => {
    expect(removeSection([generation, memory], 'authoring-aids')).toEqual([memory])
  })

  it('returns the same array reference when the id is absent', () => {
    const list = [generation]
    expect(removeSection(list, 'nope')).toBe(list)
  })
})
