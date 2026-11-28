// @vitest-environment jsdom
import { QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { RailData } from '@/components/reader/rail/use-rail-data'
import { EntryIndexReadProvider } from '@/hooks/use-entry-index'
import { createQueryClient } from '@/lib/cache'
import { DEFAULT_CALENDAR_ID, EARTH_GREGORIAN } from '@/lib/calendar'
import {
  STORY_SETTINGS_DEFAULTS,
  storyDefinitionSchema,
  type Happening,
  type StoryEntry,
} from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import type { EntryRef } from '@/lib/entry-refs'
import { makeEntity } from '@/lib/list-modules/__tests__/fixtures'
import type { RailPeek } from '@/lib/reader-rail'
import {
  currentStoryStore,
  entriesStore,
  happeningAwarenessStore,
  happeningInvolvementsStore,
  resetAllStores,
} from '@/lib/stores'

import { usePeekView } from './use-peek-view'

// The built-in registry holds one calendar, so a story's own choice can't be told from the
// default without a resolver that echoes the id it is asked for.
vi.mock('@/lib/calendar', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  resolveCalendar: (id: string) => ({ ...EARTH_GREGORIAN, id }),
}))

const read = vi.fn<(branchId: string) => Promise<readonly EntryRef[]>>()

const DATA: RailData = {
  branchId: 'br_1',
  entities: [makeEntity({ id: 'char_kael', kind: 'character', name: 'Kael' })],
  lore: [],
  threads: [],
  happenings: [],
  entityListSignals: { leadId: null, inScene: new Set() },
  hasClosedChapters: false,
  rowSignals: () => ({ lead: null, inScene: false, recentlyClassified: undefined }),
  categoryTint: new Map(),
}

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={createQueryClient()}>
      <EntryIndexReadProvider value={read}>{children}</EntryIndexReadProvider>
    </QueryClientProvider>
  )
}

function renderPeek(peek: RailPeek | null) {
  return renderHook(() => usePeekView(peek, DATA), { wrapper })
}

function openStory(branchId: string, calendarSystemId: string) {
  currentStoryStore.set({
    storyId: 's1',
    branchId,
    definition: storyDefinitionSchema.parse({
      mode: 'adventure',
      narration: 'second',
      genre: { label: 'Fantasy', promptBody: '' },
      tone: { label: 'Wry', promptBody: '' },
      setting: '',
      calendarSystemId,
      worldTimeOrigin: { year: 0 },
    }),
    settings: STORY_SETTINGS_DEFAULTS,
  })
}

function ref(id: string, position: number): EntryRef {
  return { id, position, kind: 'user_action', chapterId: null, excerpt: '' }
}

function entry(
  id: string,
  kind: StoryEntry['kind'],
  position: number,
  worldTime: number,
  branchId = 'br_1',
): StoryEntry {
  return {
    id,
    branchId,
    position,
    kind,
    content: '',
    contentTokens: null,
    chapterId: null,
    metadata: { sceneEntities: [], currentLocationId: null, worldTime },
    createdAt: position,
  }
}

function happening(id: string): Happening {
  return {
    id,
    branchId: 'br_1',
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

beforeEach(() => {
  resetAllStores()
  read.mockReset()
  read.mockResolvedValue([ref('e1', 1)])
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('usePeekView', () => {
  it('reads the entry index for a happening peek only', async () => {
    renderPeek(null)
    renderPeek({ category: 'character', id: 'char_kael' })
    await act(async () => {})
    expect(read).not.toHaveBeenCalled()

    renderPeek({ category: 'happening', id: 'h_ambush' })
    await waitFor(() => expect(read).toHaveBeenCalledWith('br_1'))
  })

  it('holds the entry index reading until the read resolves', async () => {
    let resolve!: (rows: EntryRef[]) => void
    read.mockImplementationOnce(
      () =>
        new Promise<EntryRef[]>((r) => {
          resolve = r
        }),
    )
    const { result } = renderPeek({ category: 'happening', id: 'h_ambush' })
    await waitFor(() => expect(read).toHaveBeenCalled())
    expect(result.current.entryIndex).toEqual({ state: 'reading' })

    await act(async () => resolve([ref('e1', 1)]))
    await waitFor(() => expect(result.current.entryIndex.state).toBe('ready'))
    const { entryIndex } = result.current
    if (entryIndex.state !== 'ready') throw new Error('Expected a read entry index')
    expect(entryIndex.index.get('e1')?.position).toBe(1)
  })

  it('marks the entry index failed when its read rejects', async () => {
    vi.spyOn(logger, 'warn').mockImplementation(() => {})
    read.mockRejectedValueOnce(new Error('disk I/O error'))
    const { result } = renderPeek({ category: 'happening', id: 'h_ambush' })
    await waitFor(() => expect(result.current.entryIndex).toEqual({ state: 'failed' }))
  })

  it('takes world time from this branch’s tail by position, not by store order', () => {
    // Neither store order nor its reverse ends on e4.
    entriesStore.hydrate('br_1', [
      entry('e2', 'user_action', 2, 200),
      entry('e4', 'user_action', 4, 400),
      entry('e1', 'opening', 1, 100),
      entry('e3', 'ai_reply', 3, 300),
    ])
    const { result } = renderPeek(null)
    expect(result.current.entityContext.worldTime).toBe(400)
  })

  it('takes no world time while another branch is loaded', () => {
    entriesStore.hydrate('br_2', [entry('f9', 'ai_reply', 9, 900, 'br_2')])
    const { result } = renderPeek(null)
    expect(result.current.entityContext.worldTime).toBe(0)
  })

  it('takes the default calendar from a story open on another branch', () => {
    openStory('br_2', 'other-calendar')
    const { result } = renderPeek(null)
    expect(result.current.entityContext.calendar.id).toBe(DEFAULT_CALENDAR_ID)
  })

  it('takes the open story’s calendar on its own branch', () => {
    openStory('br_1', 'other-calendar')
    const { result } = renderPeek(null)
    expect(result.current.entityContext.calendar.id).toBe('other-calendar')
  })

  it("counts a happening's links on the rail's branch, none from another branch loaded", async () => {
    const data: RailData = { ...DATA, happenings: [happening('h_ambush')] }
    const peek: RailPeek = { category: 'happening', id: 'h_ambush' }
    const link = { id: 'hi_1', happeningId: 'h_ambush', entityId: 'char_kael', role: null }
    const known = {
      id: 'haw_1',
      happeningId: 'h_ambush',
      characterId: 'char_kael',
      learnedAtEntryId: null,
      decayResistance: null,
      retrievalCount: 0,
      source: null,
    }
    happeningInvolvementsStore.hydrate('br_2', [{ ...link, branchId: 'br_2' }])
    happeningAwarenessStore.hydrate('br_2', [{ ...known, branchId: 'br_2' }])
    const { result } = renderHook(() => usePeekView(peek, data), { wrapper })
    expect(result.current.model).toMatchObject({ kind: 'happening', involved: 0, aware: 0 })

    act(() => {
      happeningInvolvementsStore.hydrate('br_1', [{ ...link, branchId: 'br_1' }])
      happeningAwarenessStore.hydrate('br_1', [{ ...known, branchId: 'br_1' }])
    })
    expect(result.current.model).toMatchObject({ kind: 'happening', involved: 1, aware: 1 })
    await waitFor(() => expect(result.current.entryIndex.state).toBe('ready'))
  })
})
