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
})
