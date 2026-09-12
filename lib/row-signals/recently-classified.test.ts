import { describe, expect, it } from 'vitest'

import type { EntityKind, EntryMetadata } from '@/lib/db'

import { sceneTransitionIds, selectRecentlyClassified } from './recently-classified'
import type { ReplyEdit, SignalDelta, SignalEntry } from './types'

const KINDS: Record<string, EntityKind> = {
  char_a: 'character',
  char_b: 'character',
  item_1: 'item',
  loc_1: 'location',
  loc_2: 'location',
  fac_1: 'faction',
  old_char: 'character',
  mid_char: 'character',
}
const categoryOf = (id: string): EntityKind | null => KINDS[id] ?? null

function meta(sceneEntities: string[], currentLocationId: string | null): EntryMetadata {
  return { sceneEntities, currentLocationId, worldTime: 0 }
}

// opening, then two turns; the second reply adds char_b and moves loc_1 → loc_2.
const ENTRIES: SignalEntry[] = [
  { id: 'e1', kind: 'opening', position: 1, metadata: meta(['char_a'], 'loc_1') },
  { id: 'e2', kind: 'user_action', position: 2, metadata: meta(['char_a'], 'loc_1') },
  { id: 'e3', kind: 'ai_reply', position: 3, metadata: meta(['char_a'], 'loc_1') },
  { id: 'e4', kind: 'user_action', position: 4, metadata: meta(['char_a'], 'loc_1') },
  { id: 'e5', kind: 'ai_reply', position: 5, metadata: meta(['char_a', 'char_b'], 'loc_2') },
]

function delta(
  logPosition: number,
  targetTable: string,
  targetId: string,
  source: SignalDelta['source'] = 'periodic_classifier',
): SignalDelta {
  return { logPosition, targetTable, targetId, source }
}

// Boundaries: e5's create delta sits at log position 10, e3's at 7.
const BOUNDARIES = { fresh: 10, fading: 7 }

describe('selectRecentlyClassified', () => {
  it('tiers pipeline deltas by log position: fresh at/after N, fading between N-1 and N, none before', () => {
    const { rows } = selectRecentlyClassified({
      replyEdits: [],
      deltas: [
        delta(10, 'entities', 'char_x'),
        delta(12, 'happenings', 'hap_1'),
        delta(8, 'lore', 'lore_1'),
        delta(6, 'threads', 'thr_old'),
      ],
      entries: [],
      boundaries: BOUNDARIES,
      categoryOf,
    })
    expect(rows.get('char_x')).toBe('fresh')
    expect(rows.get('hap_1')).toBe('fresh')
    expect(rows.get('lore_1')).toBe('fading')
    expect(rows.has('thr_old')).toBe(false)
  })

  it('ignores user_edit deltas and tables that are not row surfaces', () => {
    const { rows } = selectRecentlyClassified({
      replyEdits: [],
      deltas: [
        delta(11, 'entities', 'char_a', 'user_edit'),
        delta(11, 'chapters', 'chap_1'),
        delta(11, 'story_entries', 'e5'),
      ],
      entries: [],
      boundaries: BOUNDARIES,
      categoryOf,
    })
    expect(rows.size).toBe(0)
  })

  it('ignores a targetTable that collides with an inherited Object.prototype key', () => {
    const { rows } = selectRecentlyClassified({
      replyEdits: [],
      deltas: [delta(11, 'constructor', 'x'), delta(11, 'toString', 'y')],
      entries: [],
      boundaries: BOUNDARIES,
      categoryOf,
    })
    expect(rows.size).toBe(0)
  })

  it('fresh wins over the previous reply’s transition for the same ids', () => {
    const entries: SignalEntry[] = [
      { id: 'e1', kind: 'opening', position: 1, metadata: meta([], null) },
      { id: 'e2', kind: 'user_action', position: 2, metadata: meta([], null) },
      { id: 'e3', kind: 'ai_reply', position: 3, metadata: meta(['char_a'], 'loc_1') },
      { id: 'e4', kind: 'user_action', position: 4, metadata: meta(['char_a'], 'loc_1') },
      { id: 'e5', kind: 'ai_reply', position: 5, metadata: meta(['char_b'], 'loc_2') },
    ]
    const { rows } = selectRecentlyClassified({
      replyEdits: [],
      deltas: [],
      entries,
      boundaries: BOUNDARIES,
      categoryOf,
    })
    // e5 vs e4: char_a left, char_b arrived, loc_1 → loc_2 — all fresh.
    expect(rows.get('char_a')).toBe('fresh')
    expect(rows.get('char_b')).toBe('fresh')
    expect(rows.get('loc_1')).toBe('fresh')
    expect(rows.get('loc_2')).toBe('fresh')
  })

  it('only transitioning rows tint; an unchanged scene member stays untinted', () => {
    const { rows } = selectRecentlyClassified({
      replyEdits: [],
      deltas: [],
      entries: ENTRIES,
      boundaries: BOUNDARIES,
      categoryOf,
    })
    // e5 vs e4: char_a is present in both and doesn't transition; char_b, loc_1, loc_2 do.
    expect(rows.get('char_b')).toBe('fresh')
    expect(rows.get('loc_1')).toBe('fresh')
    expect(rows.get('loc_2')).toBe('fresh')
    expect(rows.has('char_a')).toBe(false)
  })

  it('tints an item entering sceneEntities', () => {
    const entries: SignalEntry[] = [
      { id: 'e1', kind: 'opening', position: 1, metadata: meta([], null) },
      { id: 'e2', kind: 'ai_reply', position: 2, metadata: meta(['item_1'], null) },
    ]
    const { rows } = selectRecentlyClassified({
      replyEdits: [],
      deltas: [],
      entries,
      boundaries: BOUNDARIES,
      categoryOf,
    })
    expect(rows.get('item_1')).toBe('fresh')
  })

  it('tints an item leaving sceneEntities', () => {
    const entries: SignalEntry[] = [
      { id: 'e1', kind: 'opening', position: 1, metadata: meta(['item_1'], null) },
      { id: 'e2', kind: 'ai_reply', position: 2, metadata: meta([], null) },
    ]
    const { rows } = selectRecentlyClassified({
      replyEdits: [],
      deltas: [],
      entries,
      boundaries: BOUNDARIES,
      categoryOf,
    })
    expect(rows.get('item_1')).toBe('fresh')
  })

  it('fades the previous reply’s scene transition when the latest reply changes nothing', () => {
    const entries: SignalEntry[] = [
      { id: 'e1', kind: 'opening', position: 1, metadata: meta([], null) },
      { id: 'e2', kind: 'user_action', position: 2, metadata: meta([], null) },
      { id: 'e3', kind: 'ai_reply', position: 3, metadata: meta(['char_a'], 'loc_1') },
      { id: 'e4', kind: 'user_action', position: 4, metadata: meta(['char_a'], 'loc_1') },
      { id: 'e5', kind: 'ai_reply', position: 5, metadata: meta(['char_a'], 'loc_1') },
    ]
    const { rows, byCategory } = selectRecentlyClassified({
      replyEdits: [],
      deltas: [],
      entries,
      boundaries: BOUNDARIES,
      categoryOf,
    })
    // e5 vs e4 has no transition (nothing fresh); e3 vs e2 introduced char_a + loc_1 → fading.
    expect(rows.get('char_a')).toBe('fading')
    expect(rows.get('loc_1')).toBe('fading')
    expect(byCategory.get('character')).toBe('fading')
    expect(byCategory.get('location')).toBe('fading')
  })

  it('expires a transition older than the last two replies', () => {
    const entries: SignalEntry[] = [
      { id: 'e1', kind: 'opening', position: 1, metadata: meta([], null) },
      { id: 'e2', kind: 'user_action', position: 2, metadata: meta([], null) },
      // Oldest reply: introduces old_char. It never changes again, so it should expire.
      { id: 'e3', kind: 'ai_reply', position: 3, metadata: meta(['old_char'], null) },
      { id: 'e4', kind: 'user_action', position: 4, metadata: meta(['old_char'], null) },
      // Middle reply: introduces mid_char.
      { id: 'e5', kind: 'ai_reply', position: 5, metadata: meta(['old_char', 'mid_char'], null) },
      {
        id: 'e6',
        kind: 'user_action',
        position: 6,
        metadata: meta(['old_char', 'mid_char'], null),
      },
      // Latest reply: no change from e6.
      { id: 'e7', kind: 'ai_reply', position: 7, metadata: meta(['old_char', 'mid_char'], null) },
    ]
    const { rows } = selectRecentlyClassified({
      replyEdits: [],
      deltas: [],
      entries,
      boundaries: BOUNDARIES,
      categoryOf,
    })
    expect(rows.get('mid_char')).toBe('fading')
    expect(rows.has('old_char')).toBe(false)
  })

  it('lets fresh win over fading for one row and aggregates per category', () => {
    const { rows, byCategory } = selectRecentlyClassified({
      replyEdits: [],
      deltas: [
        delta(8, 'entities', 'char_a'),
        delta(11, 'entities', 'char_a'),
        delta(8, 'lore', 'lore_1'),
      ],
      entries: [],
      boundaries: BOUNDARIES,
      categoryOf,
    })
    expect(rows.get('char_a')).toBe('fresh')
    expect(byCategory.get('character')).toBe('fresh')
    expect(byCategory.get('lore')).toBe('fading')
    expect(byCategory.has('location')).toBe(false)
  })

  it('keeps a category fresh even when the fresh delta is processed before a fading one', () => {
    const { byCategory } = selectRecentlyClassified({
      replyEdits: [],
      deltas: [delta(11, 'entities', 'char_a'), delta(8, 'entities', 'char_b')],
      entries: [],
      boundaries: BOUNDARIES,
      categoryOf,
    })
    expect(byCategory.get('character')).toBe('fresh')
  })

  it('aggregates threads and happenings deltas under their own categories', () => {
    const { byCategory } = selectRecentlyClassified({
      replyEdits: [],
      deltas: [delta(10, 'threads', 'thr_1'), delta(10, 'happenings', 'hap_1')],
      entries: [],
      boundaries: BOUNDARIES,
      categoryOf,
    })
    expect(byCategory.get('thread')).toBe('fresh')
    expect(byCategory.get('happening')).toBe('fresh')
  })

  it('does not tint a scene transition id unknown to categoryOf', () => {
    const entries: SignalEntry[] = [
      { id: 'e1', kind: 'opening', position: 1, metadata: meta([], null) },
      { id: 'e2', kind: 'ai_reply', position: 2, metadata: meta(['mystery_1'], null) },
    ]
    const { rows, byCategory } = selectRecentlyClassified({
      replyEdits: [],
      deltas: [],
      entries,
      boundaries: BOUNDARIES,
      categoryOf,
    })
    expect(rows.has('mystery_1')).toBe(false)
    expect(byCategory.size).toBe(0)
  })

  it('does not tint a faction id that enters sceneEntities, nor its category', () => {
    const entries: SignalEntry[] = [
      { id: 'e1', kind: 'opening', position: 1, metadata: meta([], null) },
      { id: 'e2', kind: 'ai_reply', position: 2, metadata: meta(['fac_1'], null) },
    ]
    const { rows, byCategory } = selectRecentlyClassified({
      replyEdits: [],
      deltas: [],
      entries,
      boundaries: BOUNDARIES,
      categoryOf,
    })
    expect(rows.has('fac_1')).toBe(false)
    expect(byCategory.has('faction')).toBe(false)
  })

  it('does not tint a location id placed inside sceneEntities via the scene-member rule', () => {
    const entries: SignalEntry[] = [
      { id: 'e1', kind: 'opening', position: 1, metadata: meta([], null) },
      { id: 'e2', kind: 'ai_reply', position: 2, metadata: meta(['loc_1'], null) },
    ]
    const { rows } = selectRecentlyClassified({
      replyEdits: [],
      deltas: [],
      entries,
      boundaries: BOUNDARIES,
      categoryOf,
    })
    expect(rows.has('loc_1')).toBe(false)
  })

  it('does not tint a currentLocationId change that resolves to a non-location kind', () => {
    const entries: SignalEntry[] = [
      { id: 'e1', kind: 'opening', position: 1, metadata: meta([], null) },
      { id: 'e2', kind: 'ai_reply', position: 2, metadata: meta([], 'char_a') },
    ]
    const { rows } = selectRecentlyClassified({
      replyEdits: [],
      deltas: [],
      entries,
      boundaries: BOUNDARIES,
      categoryOf,
    })
    expect(rows.has('char_a')).toBe(false)
  })

  it('does not tint a faction id leaving sceneEntities, nor its category', () => {
    const entries: SignalEntry[] = [
      { id: 'e1', kind: 'opening', position: 1, metadata: meta(['fac_1'], null) },
      { id: 'e2', kind: 'ai_reply', position: 2, metadata: meta([], null) },
    ]
    const { rows, byCategory } = selectRecentlyClassified({
      replyEdits: [],
      deltas: [],
      entries,
      boundaries: BOUNDARIES,
      categoryOf,
    })
    expect(rows.has('fac_1')).toBe(false)
    expect(byCategory.has('faction')).toBe(false)
  })

  it('tints only the new location when the previous currentLocationId resolves to a non-location', () => {
    const entries: SignalEntry[] = [
      { id: 'e1', kind: 'opening', position: 1, metadata: meta([], 'char_a') },
      { id: 'e2', kind: 'ai_reply', position: 2, metadata: meta([], 'loc_1') },
    ]
    const { rows } = selectRecentlyClassified({
      replyEdits: [],
      deltas: [],
      entries,
      boundaries: BOUNDARIES,
      categoryOf,
    })
    expect(rows.get('loc_1')).toBe('fresh')
    expect(rows.has('char_a')).toBe(false)
  })

  it('returns nothing without a boundary (no ai_reply on the branch yet)', () => {
    const { rows, byCategory } = selectRecentlyClassified({
      replyEdits: [],
      deltas: [delta(1, 'entities', 'char_a')],
      entries: ENTRIES,
      boundaries: null,
      categoryOf,
    })
    expect(rows.size).toBe(0)
    expect(byCategory.size).toBe(0)
  })

  it('computes transitions for the latest replies even when the tail is a user_action', () => {
    const entries: SignalEntry[] = [
      ...ENTRIES,
      { id: 'e6', kind: 'user_action', position: 6, metadata: meta(['char_a', 'char_b'], 'loc_2') },
    ]
    const { rows } = selectRecentlyClassified({
      replyEdits: [],
      deltas: [],
      entries,
      boundaries: BOUNDARIES,
      categoryOf,
    })
    expect(rows.get('char_b')).toBe('fresh')
  })

  it('skips a system row when finding the entry before a reply', () => {
    const entries: SignalEntry[] = [
      { id: 'e1', kind: 'opening', position: 1, metadata: meta(['char_a'], 'loc_1') },
      { id: 'e2', kind: 'system', position: 2, metadata: null },
      { id: 'e3', kind: 'ai_reply', position: 3, metadata: meta(['char_a', 'char_b'], 'loc_1') },
    ]
    const { rows } = selectRecentlyClassified({
      replyEdits: [],
      deltas: [],
      entries,
      boundaries: BOUNDARIES,
      categoryOf,
    })
    // "before" e3 is e1 (unchanged char_a), not the system row (would read as no prior scene).
    expect(rows.get('char_b')).toBe('fresh')
    expect(rows.has('char_a')).toBe(false)
  })
})

describe('sceneTransitionIds', () => {
  const abcKinds: Record<string, EntityKind> = {
    a: 'character',
    b: 'character',
    c: 'character',
    l1: 'location',
    l2: 'location',
  }
  const abcCategoryOf = (id: string): EntityKind | null => abcKinds[id] ?? null

  it('is the symmetric difference of sceneEntities plus both sides of a location change', () => {
    expect(
      sceneTransitionIds(meta(['a', 'b'], 'l2'), meta(['a', 'c'], 'l1'), abcCategoryOf).sort(),
    ).toEqual(['b', 'c', 'l1', 'l2'])
    expect(sceneTransitionIds(meta(['a'], 'l1'), meta(['a'], 'l1'), abcCategoryOf)).toEqual([])
    expect(sceneTransitionIds(meta(['a'], 'l1'), null, abcCategoryOf)).toEqual(['a', 'l1'])
  })

  it('drops a diffed id whose kind does not match the side it came from', () => {
    // b enters sceneEntities but resolves to a location; only a (character) survives.
    const mismatchedKinds: Record<string, EntityKind> = { a: 'character', b: 'location' }
    const mismatchedCategoryOf = (id: string): EntityKind | null => mismatchedKinds[id] ?? null
    expect(
      sceneTransitionIds(meta(['a', 'b'], null), meta([], null), mismatchedCategoryOf),
    ).toEqual(['a'])
  })
})

describe('selectRecentlyClassified — manual scene edits', () => {
  function edit(
    logPosition: number,
    targetId: string,
    metadata: Record<string, unknown> | null,
  ): ReplyEdit {
    return { targetId, logPosition, undoPayload: { metadata } }
  }

  function rowsFor(replyEdits: ReplyEdit[], entries: SignalEntry[] = ENTRIES) {
    return selectRecentlyClassified({
      deltas: [],
      replyEdits,
      entries,
      boundaries: BOUNDARIES,
      categoryOf,
    }).rows
  }

  it('does not tint a character the user added, while the classifier move still tints', () => {
    // The classifier moved loc_1 → loc_2; the user then added char_b by hand.
    const rows = rowsFor([edit(11, 'e5', { sceneEntities: ['char_a'] })])
    expect(rows.has('char_b')).toBe(false)
    expect(rows.get('loc_1')).toBe('fresh')
    expect(rows.get('loc_2')).toBe('fresh')
  })

  it('does not tint a location the user set, while the classifier arrival still tints', () => {
    // The classifier brought char_b in; the user then moved loc_1 → loc_2 by hand.
    const rows = rowsFor([edit(11, 'e5', { currentLocationId: 'loc_1' })])
    expect(rows.has('loc_1')).toBe(false)
    expect(rows.has('loc_2')).toBe(false)
    expect(rows.get('char_b')).toBe('fresh')
  })

  it('reads each field from its earliest edit', () => {
    // Two hand edits, char_b then item_1: the second one's prior scene already holds char_b.
    const entries: SignalEntry[] = [
      ...ENTRIES.slice(0, 4),
      { ...ENTRIES[4], metadata: meta(['char_a', 'char_b', 'item_1'], 'loc_2') },
    ]
    const rows = rowsFor(
      [
        edit(11, 'e5', { sceneEntities: ['char_a'] }),
        edit(12, 'e5', { sceneEntities: ['char_a', 'char_b'] }),
      ],
      entries,
    )
    expect(rows.has('char_b')).toBe(false)
    expect(rows.has('item_1')).toBe(false)
  })

  it('ignores an edit that changed no scene field, and an edit on another entry', () => {
    const rows = rowsFor([
      edit(11, 'e5', { worldTime: 3 }),
      edit(12, 'e3', { sceneEntities: ['char_a'] }),
    ])
    expect(rows.get('char_b')).toBe('fresh')
    expect(rows.get('loc_2')).toBe('fresh')
  })

  it('reads a NULL metadata column as the empty scene the reply held before the edit', () => {
    const rows = rowsFor([edit(11, 'e5', null)])
    expect(rows.get('char_a')).toBe('fresh')
    expect(rows.get('loc_1')).toBe('fresh')
    expect(rows.has('char_b')).toBe(false)
  })
})
