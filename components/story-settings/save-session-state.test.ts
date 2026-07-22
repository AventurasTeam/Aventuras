import { describe, expect, it } from 'vitest'

import {
  computeSnapshot,
  removeSection,
  upsertSection,
  type SectionDirtyState,
} from './save-session-state'

const memory: SectionDirtyState = {
  id: 'embedding-status',
  tab: 'memory',
  dirtyFields: ['embedder'],
}
const generation: SectionDirtyState = {
  id: 'authoring-aids',
  tab: 'generation',
  dirtyFields: ['suggestions', 'suggestion count'],
}

describe('computeSnapshot', () => {
  it('reports a clean session for no sections', () => {
    expect(computeSnapshot([])).toEqual({ dirtyFields: [] })
  })

  it('reports a clean session when every section is clean', () => {
    const snapshot = computeSnapshot([
      { id: 'a', tab: 'about', dirtyFields: [] },
      { id: 'b', tab: 'memory', dirtyFields: [] },
    ])
    expect(snapshot).toEqual({ dirtyFields: [] })
  })

  it('flattens dirty fields in ascending rail order', () => {
    const snapshot = computeSnapshot([memory, generation])
    expect(snapshot).toEqual({ dirtyFields: ['suggestions', 'suggestion count', 'embedder'] })
  })

  it('ranks a section by its tab, not its registration order', () => {
    const snapshot = computeSnapshot([
      { id: 'late', tab: 'about', dirtyFields: ['first in the rail'] },
      { id: 'early', tab: 'advanced', dirtyFields: ['last in the rail'] },
    ])
    expect(snapshot.dirtyFields).toEqual(['first in the rail', 'last in the rail'])
  })

  it('breaks a same-tab tie deterministically by id', () => {
    const snapshot = computeSnapshot([
      { id: 'zulu', tab: 'about', dirtyFields: ['z'] },
      { id: 'alpha', tab: 'about', dirtyFields: ['a'] },
    ])
    expect(snapshot.dirtyFields).toEqual(['a', 'z'])
  })

  it('does not reorder the caller’s array', () => {
    const input = [memory, generation]
    computeSnapshot(input)
    expect(input).toEqual([memory, generation])
  })

  it('ignores clean sections when others are dirty', () => {
    const snapshot = computeSnapshot([generation, { id: 'quiet', tab: 'pack', dirtyFields: [] }])
    expect(snapshot.dirtyFields).toEqual(['suggestions', 'suggestion count'])
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

  it('replaces a known section when only its tab changed', () => {
    const moved: SectionDirtyState = { ...generation, tab: 'advanced' }
    expect(upsertSection([generation, memory], moved)).toEqual([moved, memory])
  })

  it('replaces a known section when a dirty field is appended', () => {
    const grown = { ...memory, dirtyFields: ['embedder', 'auto-embed'] }
    expect(upsertSection([generation, memory], grown)).toEqual([generation, grown])
  })

  it('replaces a known section when a dirty field is swapped for another', () => {
    const swapped = { ...memory, dirtyFields: ['auto-embed'] }
    expect(upsertSection([generation, memory], swapped)).toEqual([generation, swapped])
  })

  it('returns the same array reference for an equal but freshly built section', () => {
    // A fresh array literal, not a spread of the same one: the anti-loop guard
    // has to compare per field, and an identity check would also pass a spread.
    const list = [generation]
    const republished: SectionDirtyState = {
      id: 'authoring-aids',
      tab: 'generation',
      dirtyFields: ['suggestions', 'suggestion count'],
    }
    expect(upsertSection(list, republished)).toBe(list)
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
