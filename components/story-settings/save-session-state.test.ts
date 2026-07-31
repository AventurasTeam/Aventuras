import { describe, expect, it } from 'vitest'

import {
  cloneDraft,
  computeSnapshot,
  removeSection,
  sameDraft,
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

describe('computeSnapshot — validity', () => {
  it('carries the invalid reason of a dirty section', () => {
    const snapshot = computeSnapshot([
      {
        id: 'aids',
        tab: 'generation',
        dirtyFields: ['suggestion categories'],
        invalidReason: 'dup',
      },
    ])
    expect(snapshot.invalidReason).toBe('dup')
  })

  it('ignores an invalid section that is clean', () => {
    const snapshot = computeSnapshot([
      { id: 'aids', tab: 'generation', dirtyFields: [], invalidReason: 'dup' },
    ])
    expect(snapshot.invalidReason).toBeUndefined()
    expect(snapshot.dirtyFields).toEqual([])
  })

  it('reports the first invalid section in rail order', () => {
    const snapshot = computeSnapshot([
      { id: 'b', tab: 'memory', dirtyFields: ['x'], invalidReason: 'memory-problem' },
      { id: 'a', tab: 'generation', dirtyFields: ['y'], invalidReason: 'generation-problem' },
    ])
    expect(snapshot.invalidReason).toBe('generation-problem')
  })
})

describe('upsertSection — validity', () => {
  it('replaces a section whose only change is going invalid', () => {
    const before = [{ id: 'aids', tab: 'generation' as const, dirtyFields: ['label'] }]
    const after = upsertSection(before, {
      id: 'aids',
      tab: 'generation',
      dirtyFields: ['label'],
      invalidReason: 'dup',
    })
    expect(after).not.toBe(before)
    expect(after[0]?.invalidReason).toBe('dup')
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

describe('sameDraft', () => {
  // JSON.stringify collapses this pair. Harmless while `updateStorySettings`
  // also strips undefined — the point is that the reset decision no longer
  // rests on the two modules happening to agree.
  it('separates a cleared key from an absent one', () => {
    expect(sameDraft({ embedding_swap_target: undefined }, {})).toBe(false)
    expect(sameDraft({}, { embedding_swap_target: undefined })).toBe(false)
    expect(
      sameDraft({ embedding_swap_target: undefined }, { embedding_swap_target: undefined }),
    ).toBe(true)
  })

  it('compares nested values structurally', () => {
    expect(sameDraft({ models: { narrative: 'a' } }, { models: { narrative: 'a' } })).toBe(true)
    expect(sameDraft({ models: { narrative: 'a' } }, { models: { narrative: 'b' } })).toBe(false)
    expect(sameDraft({ models: { narrative: undefined } }, { models: {} })).toBe(false)
  })

  it('does not confuse an array with an object holding the same keys', () => {
    expect(sameDraft(['a'], { 0: 'a' })).toBe(false)
  })

  it('reads an unrepresentable draft as changed rather than throwing', () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    const twin: Record<string, unknown> = {}
    twin.self = twin
    expect(sameDraft(cyclic, twin)).toBe(false)
  })
})

describe('cloneDraft', () => {
  // getPatch may hand back the section's own draft object; holding it by
  // reference would let a later edit rewrite what we compare against.
  it('detaches the copy from later mutation', () => {
    const draft = { models: { narrative: 'a' }, packVariables: { tone: 'wry' } }
    const before = cloneDraft(draft)

    draft.models.narrative = 'b'
    expect(sameDraft(draft, before)).toBe(false)
  })

  it('preserves a cleared key', () => {
    expect(sameDraft(cloneDraft({ activePackId: undefined }), { activePackId: undefined })).toBe(
      true,
    )
    expect(sameDraft(cloneDraft({ activePackId: undefined }), {})).toBe(false)
  })
})
