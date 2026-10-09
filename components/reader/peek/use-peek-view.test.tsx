// @vitest-environment jsdom
import { QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { RailData } from '@/components/reader/rail/use-rail-data'
import { EntryIndexReadProvider } from '@/hooks/use-entry-index'
import { createQueryClient } from '@/lib/cache'
import { DEFAULT_CALENDAR_ID, EARTH_GREGORIAN } from '@/lib/calendar'
import { STORY_SETTINGS_DEFAULTS, storyDefinitionSchema, type StoryEntry } from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import type { EntryRef } from '@/lib/entry-refs'
import { makeEntity } from '@/lib/list-modules/__tests__/fixtures'
import type { RailPeek } from '@/lib/reader-rail'
import { currentStoryStore, entriesStore, resetAllStores } from '@/lib/stores'

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
      leadEntityId: 'char_kael',
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
    chapterId: null,
    metadata: { sceneEntities: [], currentLocationId: null, worldTime },
    createdAt: position,
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
    // Neither store order nor its reverse ends on e4; another branch's entry sits past it.
    entriesStore.hydrate('br_1', [
      entry('e2', 'user_action', 2, 200),
      entry('e4', 'user_action', 4, 400),
      entry('f9', 'ai_reply', 9, 900, 'br_2'),
      entry('e1', 'opening', 1, 100),
      entry('e3', 'ai_reply', 3, 300),
    ])
    const { result } = renderPeek(null)
    expect(result.current.entityContext.worldTime).toBe(400)
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
})
