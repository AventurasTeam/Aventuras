// @vitest-environment jsdom
import { onlineManager, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createQueryClient } from '@/lib/cache'
import type { ChapterProgress } from '@/lib/chapters'
import {
  STORY_SETTINGS_DEFAULTS,
  storyDefinitionSchema,
  type OpenRegionRow,
  type StoryEntry,
} from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import {
  currentStoryStore,
  entriesStore,
  generationStore,
  resetAllStores,
  type RunState,
} from '@/lib/stores'

import { useChapterProgress } from './use-chapter-progress'

const reads = vi.hoisted(() => ({ series: vi.fn() }))

// The runtime `db` is a bridge client; the read is what the hook composes.
vi.mock('@/lib/db', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  db: {},
  openRegionSeries: reads.series,
}))

const DEFINITION = storyDefinitionSchema.parse({
  mode: 'adventure',
  leadEntityId: 'char_00000000-0000-4000-8000-000000000001',
  narration: 'first',
  genre: { label: 'Fantasy', promptBody: 'high fantasy' },
  tone: { label: 'Wry', promptBody: 'wry' },
  setting: 'A keep on a hill.',
  calendarSystemId: 'gregorian',
  worldTimeOrigin: { year: 0 },
})

const ZEROS = { tokens: 0, percent: 0, tone: 'success', canClose: false }

function openStory({ branchId = 'b1', threshold = 1_000 } = {}): void {
  currentStoryStore.set({
    storyId: 's1',
    branchId,
    definition: DEFINITION,
    settings: { ...STORY_SETTINGS_DEFAULTS, chapterTokenThreshold: threshold },
  })
}

function reply(id: string, tokens: number): OpenRegionRow {
  return { id, kind: 'ai_reply', position: Number(id.slice(1)), tokens }
}

function entry(id: string, position: number, branchId = 'b1'): StoryEntry {
  return {
    id,
    branchId,
    position,
    kind: 'user_action',
    content: '',
    contentTokens: null,
    chapterId: null,
    metadata: null,
    createdAt: position,
  }
}

function run(id: string): RunState {
  return {
    runId: id,
    kind: 'per-turn',
    gateBehavior: 'hard-gate',
    interruptible: null,
    beforeTurn: false,
    actionId: `act_${id}`,
    storyId: 's1',
    branchId: 'b1',
    abortController: new AbortController(),
    currentPhase: '',
    intermediates: {},
    terminal: Promise.resolve(),
    resolveTerminal: () => {},
  }
}

function settle(): void {
  act(() => generationStore.startRun(run('r1')))
  act(() => generationStore.finishRun('r1'))
}

function deferredRead() {
  let resolve!: (rows: OpenRegionRow[]) => void
  reads.series.mockImplementationOnce(
    () =>
      new Promise<OpenRegionRow[]>((r) => {
        resolve = r
      }),
  )
  return (rows: OpenRegionRow[]) => resolve(rows)
}

let latest: ChapterProgress | null = null

function Probe({ storyId = 's1' }: { storyId?: string | null; nonce?: number }) {
  latest = useChapterProgress(storyId)
  return null
}

function renderProbe(storyId?: string | null) {
  const client = createQueryClient()
  const view = (nonce: number) => (
    <QueryClientProvider client={client}>
      <Probe storyId={storyId} nonce={nonce} />
    </QueryClientProvider>
  )
  const { rerender } = render(view(0))
  return { rerenderWith: (nonce: number) => rerender(view(nonce)) }
}

describe('useChapterProgress', () => {
  beforeEach(() => {
    resetAllStores()
    latest = null
    reads.series.mockReset()
  })
  afterEach(() => {
    cleanup()
    onlineManager.setOnline(true)
  })

  it('reads the open region through openRegionSeries and sums it against the threshold', async () => {
    openStory()
    reads.series.mockResolvedValueOnce([reply('e1', 100), reply('e2', 150)])

    renderProbe()

    await waitFor(() => expect(latest?.tokens).toBe(250))
    expect(latest).toEqual({
      tokens: 250,
      threshold: 1_000,
      percent: 25,
      tone: 'success',
      canClose: true,
    })
    expect(reads.series).toHaveBeenCalledTimes(1)
    expect(reads.series).toHaveBeenCalledWith('b1', { db: {} })
  })

  it('reads as zeros with no read for another story, and no story, while one is open', async () => {
    openStory()

    renderProbe('s2')
    await act(async () => {})
    expect(latest).toEqual({ ...ZEROS, threshold: 0 })
    cleanup()

    renderProbe(null)
    await act(async () => {})
    expect(latest).toEqual({ ...ZEROS, threshold: 0 })
    expect(reads.series).not.toHaveBeenCalled()

    // Positive control: the same store state reads for the story's own caller.
    cleanup()
    reads.series.mockResolvedValueOnce([reply('e1', 100)])
    renderProbe()
    await waitFor(() => expect(latest?.tokens).toBe(100))
  })

  it('reads as zeros with no story open', async () => {
    renderProbe()
    await act(async () => {})
    expect(latest).toEqual({ ...ZEROS, threshold: 0 })
    expect(reads.series).not.toHaveBeenCalled()
  })

  it('reads as zeros, with the threshold, before the first read lands', async () => {
    openStory()
    const land = deferredRead()

    renderProbe()
    expect(latest).toEqual({ ...ZEROS, threshold: 1_000 })

    await act(async () => {
      land([reply('e1', 100)])
    })
    await waitFor(() => expect(latest?.tokens).toBe(100))
  })

  it('reads again on a settle', async () => {
    openStory()
    reads.series.mockResolvedValueOnce([reply('e1', 100)])
    renderProbe()
    await waitFor(() => expect(latest?.tokens).toBe(100))

    // Negative control: starting a run alone isn't a settle.
    act(() => generationStore.startRun(run('r1')))
    await act(async () => {})
    expect(reads.series).toHaveBeenCalledTimes(1)

    reads.series.mockResolvedValueOnce([reply('e1', 180)])
    act(() => generationStore.finishRun('r1'))
    await waitFor(() => expect(latest?.tokens).toBe(180))
    expect(reads.series).toHaveBeenCalledTimes(2)
  })

  it('reads again when the tail moves without a settle', async () => {
    entriesStore.hydrate('b1', [entry('e1', 1)])
    openStory()
    reads.series.mockResolvedValueOnce([reply('e1', 100)])
    renderProbe()
    await waitFor(() => expect(latest?.tokens).toBe(100))

    reads.series.mockResolvedValueOnce([reply('e1', 100), reply('e2', 40)])
    act(() => {
      entriesStore.patch('b1', { op: 'create', id: 'e2', row: entry('e2', 2) })
    })
    await waitFor(() => expect(latest?.tokens).toBe(140))
    expect(reads.series).toHaveBeenCalledTimes(2)
  })

  it('holds the last number while the next read is pending', async () => {
    openStory()
    reads.series.mockResolvedValueOnce([reply('e1', 100)])
    renderProbe()
    await waitFor(() => expect(latest?.tokens).toBe(100))

    const land = deferredRead()
    settle()
    await waitFor(() => expect(reads.series).toHaveBeenCalledTimes(2))
    expect(latest?.tokens).toBe(100)
    expect(latest?.percent).toBe(10)
    expect(latest?.canClose).toBe(true)

    await act(async () => {
      land([reply('e1', 300)])
    })
    await waitFor(() => expect(latest?.tokens).toBe(300))
  })

  it("shows no earlier branch's number after a switch", async () => {
    openStory()
    reads.series.mockResolvedValueOnce([reply('e1', 100)])
    renderProbe()
    await waitFor(() => expect(latest?.tokens).toBe(100))

    const land = deferredRead()
    act(() => openStory({ branchId: 'b2' }))
    expect(latest).toEqual({ ...ZEROS, threshold: 1_000 })
    await waitFor(() => expect(reads.series).toHaveBeenCalledWith('b2', { db: {} }))

    await act(async () => {
      land([reply('f1', 700)])
    })
    await waitFor(() => expect(latest?.tokens).toBe(700))
  })

  it('moves percent with the threshold and no new read', async () => {
    openStory()
    reads.series.mockResolvedValueOnce([reply('e1', 100)])
    renderProbe()
    await waitFor(() => expect(latest?.percent).toBe(10))

    act(() => openStory({ threshold: 200 }))
    expect(latest?.percent).toBe(50)
    expect(latest?.threshold).toBe(200)
    expect(latest?.tokens).toBe(100)
    await act(async () => {})
    expect(reads.series).toHaveBeenCalledTimes(1)
  })

  it('logs a failed read once and keeps the last number', async () => {
    openStory()
    reads.series.mockResolvedValueOnce([reply('e1', 100)])
    const { rerenderWith } = renderProbe()
    await waitFor(() => expect(latest?.tokens).toBe(100))

    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    reads.series.mockRejectedValueOnce(new Error('boom'))
    settle()

    await waitFor(() => expect(warnSpy).toHaveBeenCalledTimes(1))
    expect(warnSpy).toHaveBeenCalledWith('app.chapter_progress_read_failed', {
      branchId: 'b1',
      error: 'boom',
    })
    expect(reads.series).toHaveBeenCalledTimes(2)
    expect(latest?.tokens).toBe(100)

    // Host routes re-render on every stream chunk, and a failed key stays failed across them.
    rerenderWith(1)
    expect(warnSpy).toHaveBeenCalledTimes(1)

    warnSpy.mockRestore()
  })

  it('reads as zeros when the first read fails, and never retries', async () => {
    openStory()
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    reads.series.mockRejectedValue(new Error('boom'))

    renderProbe()

    await waitFor(() => expect(warnSpy).toHaveBeenCalledTimes(1))
    expect(reads.series).toHaveBeenCalledTimes(1)
    expect(latest).toEqual({ ...ZEROS, threshold: 1_000 })

    warnSpy.mockRestore()
  })

  it('drops the held number when the branch leaves before the next read lands', async () => {
    openStory()
    reads.series.mockResolvedValueOnce([reply('e1', 100)])
    renderProbe()
    await waitFor(() => expect(latest?.tokens).toBe(100))

    deferredRead()
    act(() => openStory({ branchId: 'b2' }))
    await waitFor(() => expect(reads.series).toHaveBeenCalledTimes(2))

    // The settle puts the return on a new key, so the cached read can't answer it.
    deferredRead()
    settle()
    await waitFor(() => expect(reads.series).toHaveBeenCalledTimes(3))

    const land = deferredRead()
    act(() => openStory({ branchId: 'b1' }))
    expect(latest?.tokens).toBe(0)
    await act(async () => {
      land([reply('e1', 120)])
    })
    await waitFor(() => expect(latest?.tokens).toBe(120))
  })

  // The read is local, so a lost network must not pause it.
  it('keeps reading while the app is offline', async () => {
    openStory()
    reads.series.mockResolvedValueOnce([reply('e1', 100)])
    renderProbe()
    await waitFor(() => expect(latest?.tokens).toBe(100))

    act(() => onlineManager.setOnline(false))
    reads.series.mockResolvedValueOnce([reply('e1', 180)])
    settle()
    await waitFor(() => expect(latest?.tokens).toBe(180))
  })

  it('returns the same object while nothing changes', async () => {
    openStory()
    reads.series.mockResolvedValueOnce([reply('e1', 100)])
    const { rerenderWith } = renderProbe()
    await waitFor(() => expect(latest?.tokens).toBe(100))

    const first = latest
    rerenderWith(1)
    rerenderWith(2)
    expect(latest).toBe(first)
  })
})
