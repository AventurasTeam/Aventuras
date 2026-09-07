import { describe, expect, it } from 'vitest'

import { inheritedEntryMetadata } from './inherited-metadata'

describe('inheritedEntryMetadata', () => {
  it('inherits sceneEntities, currentLocationId, worldTime from tail metadata object', () => {
    const tail = {
      sceneEntities: ['char-1', 'loc-1'],
      currentLocationId: 'loc-1',
      worldTime: 42,
    }
    expect(inheritedEntryMetadata(tail)).toEqual({
      sceneEntities: ['char-1', 'loc-1'],
      currentLocationId: 'loc-1',
      worldTime: 42,
    })
  })

  it('defaults to empty sceneEntities, null currentLocationId, worldTime 0 when tail is null or undefined', () => {
    expect(inheritedEntryMetadata(null)).toEqual({
      sceneEntities: [],
      currentLocationId: null,
      worldTime: 0,
    })
    expect(inheritedEntryMetadata(undefined)).toEqual({
      sceneEntities: [],
      currentLocationId: null,
      worldTime: 0,
    })
  })

  it('defaults missing tail properties when tail object is partially specified', () => {
    expect(inheritedEntryMetadata({})).toEqual({
      sceneEntities: [],
      currentLocationId: null,
      worldTime: 0,
    })
  })

  // Never inherited, unlike the scene triple beside it: a query carried forward from
  // three turns ago is exactly the staleness Q4 exists to avoid
  // (docs/memory/retrieval.md#q4-classifier-emitted-queries).
  it('does not carry retrievalQueries forward', () => {
    const inherited = inheritedEntryMetadata({
      sceneEntities: ['char_a'],
      currentLocationId: 'loc_a',
      worldTime: 10,
      retrievalQueries: ['House Eldrin sigil'],
    } as never)
    expect(inherited).not.toHaveProperty('retrievalQueries')
  })
})
