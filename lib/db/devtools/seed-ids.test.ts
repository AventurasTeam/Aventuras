import { describe, expect, it } from 'vitest'

import { ID_PATTERN } from '@/lib/ids'

import { canonicalSeedId, remapSeedIds } from './seed-ids'

describe('canonicalSeedId', () => {
  it('rewrites a mnemonic id to a matching prefix_<uuid>', () => {
    const id = canonicalSeedId('char_kael')
    expect(id).not.toBeNull()
    expect(ID_PATTERN.test(id!)).toBe(true)
    expect(id!.startsWith('char_')).toBe(true)
  })

  it('corrects the off-spec authored prefixes (fac→fact, thread→thr)', () => {
    expect(canonicalSeedId('fac_watch')!.startsWith('fact_')).toBe(true)
    expect(canonicalSeedId('thread_trust')!.startsWith('thr_')).toBe(true)
  })

  it('is deterministic and distinct per authored id, even across shared suffixes', () => {
    expect(canonicalSeedId('lore_veil')).toBe(canonicalSeedId('lore_veil'))
    // item_amulet, lore_amulet, thread_amulet share a suffix but are distinct ids.
    const ids = new Set([
      canonicalSeedId('item_amulet'),
      canonicalSeedId('lore_amulet'),
      canonicalSeedId('thread_amulet'),
    ])
    expect(ids.size).toBe(3)
  })

  it('leaves non-ids, non-substitutable prefixes, and already-canonical ids untouched', () => {
    expect(canonicalSeedId('Just some prose about a blade.')).toBeNull()
    expect(canonicalSeedId('item')).toBeNull() // bare kind word, no id
    expect(canonicalSeedId('ai_classifier')).toBeNull() // delta source enum
    expect(canonicalSeedId('story_hero')).toBeNull() // non-substitutable prefix
    expect(canonicalSeedId('char_9f8e7d6c-1a2b-4c3d-8e4f-0a1b2c3d4e5f')).toBeNull()
  })
})

describe('remapSeedIds', () => {
  it('rewrites ids inside nested state, arrays, and delta targets while preserving structure', () => {
    const row = {
      id: 'char_kael',
      kind: 'character',
      state: { current_location_id: 'loc_hollow', inventory: ['item_blade'], faction_id: null },
      metadata: { sceneEntities: ['char_kael', 'char_mira'] },
      count: 3,
      undoPayload: null,
    }
    const out = remapSeedIds(row)

    expect(out.id).toBe(canonicalSeedId('char_kael'))
    expect(out.state.current_location_id).toBe(canonicalSeedId('loc_hollow'))
    expect(out.state.inventory[0]).toBe(canonicalSeedId('item_blade'))
    // Same authored id resolves identically wherever it appears (FK integrity).
    expect(out.metadata.sceneEntities[0]).toBe(out.id)
    // Non-id scalars and nulls pass through.
    expect(out.kind).toBe('character')
    expect(out.count).toBe(3)
    expect(out.state.faction_id).toBeNull()
    expect(out.undoPayload).toBeNull()
  })
})
