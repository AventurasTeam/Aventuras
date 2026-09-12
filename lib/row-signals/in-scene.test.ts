import { describe, expect, it } from 'vitest'

import type { EntryMetadata } from '@/lib/db'

import { selectInScene } from './in-scene'
import type { SignalEntity, SignalEntry } from './types'

const ENTITIES: SignalEntity[] = [
  { id: 'char_a', kind: 'character' },
  { id: 'char_b', kind: 'character' },
  { id: 'item_1', kind: 'item' },
  { id: 'loc_1', kind: 'location' },
  { id: 'loc_2', kind: 'location' },
  { id: 'fac_1', kind: 'faction' },
]

function meta(sceneEntities: string[], currentLocationId: string | null): EntryMetadata {
  return { sceneEntities, currentLocationId, worldTime: 0 }
}

describe('selectInScene', () => {
  it('returns characters and items in sceneEntities plus the current location, never factions', () => {
    const entries: SignalEntry[] = [
      { id: 'e1', kind: 'opening', position: 1, metadata: meta([], null) },
      {
        id: 'e2',
        kind: 'ai_reply',
        position: 2,
        metadata: meta(['char_a', 'item_1', 'fac_1'], 'loc_1'),
      },
    ]
    const set = selectInScene(entries, ENTITIES)
    expect([...set].sort()).toEqual(['char_a', 'item_1', 'loc_1'])
    expect(set.has('char_b')).toBe(false)
    expect(set.has('loc_2')).toBe(false)
  })

  it('reads the tail user_action, which carries the inherited triple', () => {
    const entries: SignalEntry[] = [
      { id: 'e1', kind: 'ai_reply', position: 1, metadata: meta(['char_a'], 'loc_1') },
      { id: 'e2', kind: 'user_action', position: 2, metadata: meta(['char_a'], 'loc_1') },
    ]
    expect([...selectInScene(entries, ENTITIES)].sort()).toEqual(['char_a', 'loc_1'])
  })

  it('falls back to the entry above when the tail carries no metadata', () => {
    const entries: SignalEntry[] = [
      { id: 'e1', kind: 'ai_reply', position: 1, metadata: meta(['char_b'], 'loc_2') },
      { id: 'e2', kind: 'user_action', position: 2, metadata: null },
    ]
    expect([...selectInScene(entries, ENTITIES)].sort()).toEqual(['char_b', 'loc_2'])
  })

  it('excludes currentLocationId when it does not name a location entity', () => {
    const entries: SignalEntry[] = [
      { id: 'e1', kind: 'ai_reply', position: 1, metadata: meta(['char_a'], 'item_1') },
    ]
    expect([...selectInScene(entries, ENTITIES)]).toEqual(['char_a'])
  })

  it('skips a trailing system entry and is empty on an empty branch', () => {
    const entries: SignalEntry[] = [
      { id: 'e1', kind: 'ai_reply', position: 1, metadata: meta(['char_a'], null) },
      { id: 'e2', kind: 'system', position: 2, metadata: null },
    ]
    expect([...selectInScene(entries, ENTITIES)]).toEqual(['char_a'])
    expect(selectInScene([], ENTITIES).size).toBe(0)
  })
})
