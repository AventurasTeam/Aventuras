// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { RowSignalsSnapshot } from '@/hooks/use-row-signals'
import {
  STORY_SETTINGS_DEFAULTS,
  storyDefinitionSchema,
  type Chapter,
  type Entity,
  type Happening,
  type Lore,
  type Thread,
} from '@/lib/db'
import type { EntryIndex } from '@/lib/entry-refs'
import {
  chaptersStore,
  currentStoryStore,
  entitiesStore,
  happeningsStore,
  loreStore,
  readerRailStore,
  resetAllStores,
  threadsStore,
} from '@/lib/stores'

import { railChipTintOf, railStripOf, useRailData } from './use-rail-data'

const harness = vi.hoisted(() => ({
  signals: null as RowSignalsSnapshot | null,
  index: new Map() as EntryIndex,
  ready: true,
  failed: false,
  retry: vi.fn(),
  indexOptions: vi.fn(),
}))

// Row signals and the entry index read the DB; the hook only composes them.
vi.mock('@/hooks/use-row-signals', () => ({ useRowSignals: () => harness.signals }))
vi.mock('@/hooks/use-entry-index', () => ({
  useEntryIndex: (branchId: string, options?: { enabled?: boolean }) => {
    harness.indexOptions(branchId, options)
    return {
      entries: [],
      index: harness.index,
      ready: harness.ready,
      failed: harness.failed,
      retry: harness.retry,
    }
  },
}))

function entity(id: string, kind: Entity['kind'], extra: Partial<Entity> = {}): Entity {
  return {
    id,
    branchId: 'br_1',
    kind,
    name: id,
    description: null,
    status: 'active',
    retiredReason: null,
    injectionMode: 'auto',
    nameCollisionFlag: 0,
    state: null,
    tags: [],
    keywords: [],
    priority: 0,
    embeddingStale: 1,
    createdAt: 1,
    updatedAt: 1,
    ...extra,
  }
}

function lore(id: string, branchId = 'br_1'): Lore {
  return {
    id,
    branchId,
    title: id,
    body: null,
    category: null,
    tags: [],
    keywords: [],
    injectionMode: 'auto',
    priority: 0,
    embeddingStale: 1,
    createdAt: 1,
    updatedAt: 1,
  }
}

function thread(id: string, branchId = 'br_1'): Thread {
  return {
    id,
    branchId,
    title: id,
    description: null,
    category: null,
    icon: null,
    status: 'active',
    injectionMode: 'auto',
    triggeredAtEntryId: null,
    resolvedAtEntryId: null,
    embeddingStale: 1,
    createdAt: 1,
    updatedAt: 1,
  }
}

function happening(id: string, branchId = 'br_1'): Happening {
  return {
    id,
    branchId,
    title: id,
    description: null,
    category: null,
    icon: null,
    temporal: null,
    occurredAtEntryId: null,
    commonKnowledge: 0,
    embeddingStale: 1,
    createdAt: 1,
    updatedAt: 1,
  }
}

function chapter(id: string, branchId: string): Chapter {
  return {
    id,
    branchId,
    sequenceNumber: 1,
    title: 'One',
    summary: '',
    theme: '',
    keywords: [],
    startEntryId: 'e_1',
    endEntryId: 'e_2',
    tokenCount: 0,
    closedAt: 1,
    embeddingStale: 1,
    createdAt: 1,
    updatedAt: 1,
  }
}

function openStory(over: { branchId?: string; mode?: 'adventure' | 'creative'; lead?: string }) {
  currentStoryStore.set({
    storyId: 's1',
    branchId: over.branchId ?? 'br_1',
    definition: storyDefinitionSchema.parse({
      mode: over.mode ?? 'adventure',
      leadEntityId: over.lead ?? 'char_kael',
      narration: 'second',
      genre: { label: 'Fantasy', promptBody: '' },
      tone: { label: 'Wry', promptBody: '' },
      setting: '',
      calendarSystemId: 'gregorian',
      worldTimeOrigin: { year: 0 },
    }),
    settings: STORY_SETTINGS_DEFAULTS,
  })
}

const ENTITIES = [
  entity('char_kael', 'character'),
  entity('char_mira', 'character', { nameCollisionFlag: 1 }),
  entity('item_blade', 'item'),
  entity('loc_hollow', 'location'),
  entity('fac_watch', 'faction'),
  entity('char_other', 'character', { branchId: 'br_2' }),
]

beforeEach(() => {
  resetAllStores()
  harness.ready = true
  harness.failed = false
  harness.retry.mockReset()
  harness.indexOptions.mockReset()
  harness.signals = {
    inScene: new Set(['char_kael', 'char_mira', 'item_blade', 'loc_hollow']),
    recentlyClassified: {
      rows: new Map([
        ['char_mira', 'fresh'],
        ['item_blade', 'fading'],
      ]),
      byCategory: new Map([
        ['character', 'fresh'],
        ['item', 'fading'],
      ]),
    },
  }
  entitiesStore.hydrate('br_1', ENTITIES)
})

afterEach(() => {
  cleanup()
})

describe('useRailData', () => {
  it('keeps only the branch’s rows', () => {
    loreStore.hydrate('br_1', [lore('lore_1'), lore('lore_x', 'br_2')])
    threadsStore.hydrate('br_1', [thread('t_1'), thread('t_x', 'br_2')])
    happeningsStore.hydrate('br_1', [happening('h_1'), happening('h_x', 'br_2')])
    const { result } = renderHook(() => useRailData('br_1'))
    expect(result.current.entities.map((e) => e.id)).not.toContain('char_other')
    expect(result.current.entities).toHaveLength(5)
    expect(result.current.lore.map((r) => r.id)).toEqual(['lore_1'])
    expect(result.current.threads.map((r) => r.id)).toEqual(['t_1'])
    expect(result.current.happenings.map((r) => r.id)).toEqual(['h_1'])
  })

  it('labels the lead `you` in adventure and `protagonist` in creative', () => {
    openStory({ mode: 'adventure' })
    const adventure = renderHook(() => useRailData('br_1'))
    expect(adventure.result.current.entityListSignals).toEqual({
      leadId: 'char_kael',
      inScene: harness.signals?.inScene,
    })
    expect(adventure.result.current.rowSignals('char_kael').lead).toBe('you')
    expect(adventure.result.current.rowSignals('char_mira').lead).toBeNull()
    adventure.unmount()
    openStory({ mode: 'creative' })
    const creative = renderHook(() => useRailData('br_1'))
    expect(creative.result.current.rowSignals('char_kael').lead).toBe('protagonist')
  })

  it('reads no lead from a story open on another branch', () => {
    openStory({ branchId: 'br_2' })
    const { result } = renderHook(() => useRailData('br_1'))
    expect(result.current.entityListSignals.leadId).toBeNull()
    expect(result.current.rowSignals('char_kael').lead).toBeNull()
  })

  it('treats a lead that is not a character on the branch as absent', () => {
    openStory({ lead: 'item_blade' })
    const { result } = renderHook(() => useRailData('br_1'))
    expect(result.current.entityListSignals.leadId).toBeNull()
  })

  it('carries lead, in-scene and recently-classified, never a collision', () => {
    openStory({})
    const { result } = renderHook(() => useRailData('br_1'))
    expect(result.current.rowSignals('char_mira')).toEqual({
      lead: null,
      inScene: true,
      recentlyClassified: 'fresh',
    })
    expect(Object.keys(result.current.rowSignals('char_mira')).sort()).toEqual([
      'inScene',
      'lead',
      'recentlyClassified',
    ])
    expect(result.current.rowSignals('fac_watch')).toEqual({
      lead: null,
      inScene: false,
      recentlyClassified: undefined,
    })
  })

  it('builds the strip and the chip tint from the per-kind aggregate', () => {
    const { result } = renderHook(() => useRailData('br_1'))
    const strip = railStripOf(result.current)
    expect(strip.counted).toEqual([
      { category: 'character', count: 2, tint: 'fresh' },
      { category: 'item', count: 1, tint: 'fading' },
    ])
    expect(strip.quickAccess).toEqual([
      { category: 'location', tint: undefined },
      { category: 'faction', tint: undefined },
    ])
    expect(result.current.categoryTint).toBe(harness.signals?.recentlyClassified.byCategory)
    expect(railChipTintOf(result.current)).toBe('fresh')
  })

  it('leaves the chip untinted when no kind has a classifier write', () => {
    harness.signals = {
      inScene: new Set(),
      recentlyClassified: { rows: new Map(), byCategory: new Map() },
    }
    const { result } = renderHook(() => useRailData('br_1'))
    expect(railChipTintOf(result.current)).toBeUndefined()
  })

  it('offers chapter-scoped happenings only once this branch closed a chapter', () => {
    chaptersStore.hydrate('br_1', [chapter('chap_x', 'br_2')])
    const before = renderHook(() => useRailData('br_1'))
    expect(before.result.current.plotListSignals).toEqual({
      entries: harness.index,
      hasClosedChapters: false,
    })
    before.unmount()
    chaptersStore.hydrate('br_1', [chapter('chap_1', 'br_1')])
    const after = renderHook(() => useRailData('br_1'))
    expect(after.result.current.plotListSignals.hasClosedChapters).toBe(true)
    expect(after.result.current.plotListSignals.entries).toBe(harness.index)
  })

  it('reads the entry index only while the happening list is the rail’s category', () => {
    const { result } = renderHook(() => useRailData('br_1'))
    expect(harness.indexOptions).toHaveBeenLastCalledWith('br_1', { enabled: false })
    act(() => readerRailStore.setCategory('happening'))
    expect(harness.indexOptions).toHaveBeenLastCalledWith('br_1', { enabled: true })
    expect(result.current.entryIndex.ready).toBe(true)
  })

  it('passes the entry index’s ready, failed and retry through', () => {
    harness.ready = false
    harness.failed = true
    const { result } = renderHook(() => useRailData('br_1'))
    expect(result.current.entryIndex.ready).toBe(false)
    expect(result.current.entryIndex.failed).toBe(true)
    result.current.entryIndex.retry()
    expect(harness.retry).toHaveBeenCalledTimes(1)
  })
})
