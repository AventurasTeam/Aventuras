// @vitest-environment jsdom
import { QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createQueryClient } from '@/lib/cache'
import type { ChapterTimeRanges, StoryEntry } from '@/lib/db'
import { entriesStore, generationStore, resetAllStores, type RunState } from '@/lib/stores'

import { useTimelineTimeRanges } from './use-timeline-time-ranges'

const reads = vi.hoisted(() => ({ ranges: vi.fn() }))

// The runtime `db` is a bridge client, so the read `useChapterTimeRanges` makes is mocked.
vi.mock('@/lib/db', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  db: {},
  readChapterTimeRanges: reads.ranges,
}))

function ranges(first: number, last: number): ChapterTimeRanges {
  return new Map([['chap_1', { first, last }]])
}

function entry(id: string, position: number, branchId = 'br_1'): StoryEntry {
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

function closeRun(id: string): RunState {
  return {
    runId: id,
    kind: 'chapter-close',
    gateBehavior: 'hard-gate',
    interruptible: 'close',
    beforeTurn: false,
    actionId: `act_${id}`,
    storyId: 's1',
    branchId: 'br_1',
    abortController: new AbortController(),
    currentPhase: '',
    intermediates: {},
    terminal: Promise.resolve(),
    resolveTerminal: () => {},
  }
}

let latest: ChapterTimeRanges | null = null

function Probe({ focused, branchId = 'br_1' }: { focused: boolean; branchId?: string }) {
  latest = useTimelineTimeRanges(branchId, focused)
  return null
}

function renderProbe(focused: boolean) {
  const client = createQueryClient()
  const view = (next: boolean) => (
    <QueryClientProvider client={client}>
      <Probe focused={next} />
    </QueryClientProvider>
  )
  const { rerender } = render(view(focused))
  return { setFocused: (next: boolean) => rerender(view(next)) }
}

const shown = () => latest?.get('chap_1')

describe('useTimelineTimeRanges', () => {
  beforeEach(() => {
    resetAllStores()
    latest = null
    reads.ranges.mockReset()
  })
  afterEach(() => {
    cleanup()
  })

  it('rereads on a return to focus with the key unchanged', async () => {
    reads.ranges.mockResolvedValue(ranges(120, 300))
    const { setFocused } = renderProbe(true)
    await waitFor(() => expect(shown()).toEqual({ first: 120, last: 300 }))

    const readsBeforeReturn = reads.ranges.mock.calls.length
    setFocused(false)
    reads.ranges.mockResolvedValue(ranges(120, 900))
    await act(async () => {})
    expect(reads.ranges).toHaveBeenCalledTimes(readsBeforeReturn)
    expect(shown()).toEqual({ first: 120, last: 300 })

    setFocused(true)
    await waitFor(() => expect(shown()).toEqual({ first: 120, last: 900 }))
    await act(async () => {})
    expect(reads.ranges).toHaveBeenCalledTimes(readsBeforeReturn + 1)
  })

  it('reads nothing while unfocused', async () => {
    renderProbe(false)
    await act(async () => {})

    expect(reads.ranges).not.toHaveBeenCalled()
    expect(latest?.size).toBe(0)
  })

  // A settle moves the key but none of the reread effect's deps: only the enabled query reads it.
  it('reads the new key when a run ends while focused', async () => {
    reads.ranges.mockResolvedValue(ranges(120, 300))
    renderProbe(true)
    await waitFor(() => expect(shown()).toEqual({ first: 120, last: 300 }))

    reads.ranges.mockResolvedValue(ranges(120, 900))
    act(() => generationStore.startRun(closeRun('r1')))
    act(() => generationStore.finishRun('r1'))

    await waitFor(() => expect(shown()).toEqual({ first: 120, last: 900 }))
  })

  it('rereads once per return, not on each render', async () => {
    reads.ranges.mockResolvedValue(ranges(120, 300))
    const { setFocused } = renderProbe(true)
    await waitFor(() => expect(shown()).toEqual({ first: 120, last: 300 }))

    const readsBefore = reads.ranges.mock.calls.length
    setFocused(true)
    setFocused(true)
    await act(async () => {})
    expect(reads.ranges).toHaveBeenCalledTimes(readsBefore)
  })

  it('rereads on a mount over a warm key', async () => {
    const client = createQueryClient()
    reads.ranges.mockResolvedValue(ranges(120, 300))
    const first = render(
      <QueryClientProvider client={client}>
        <Probe focused />
      </QueryClientProvider>,
    )
    await waitFor(() => expect(shown()).toEqual({ first: 120, last: 300 }))
    first.unmount()

    reads.ranges.mockResolvedValue(ranges(120, 900))
    render(
      <QueryClientProvider client={client}>
        <Probe focused />
      </QueryClientProvider>,
    )
    await waitFor(() => expect(shown()).toEqual({ first: 120, last: 900 }))
  })

  it('rereads when the tail moves onto a warm key while focused', async () => {
    const client = createQueryClient()
    const view = (
      <QueryClientProvider client={client}>
        <Probe focused />
      </QueryClientProvider>
    )
    entriesStore.hydrate('br_1', [entry('e1', 1)])
    reads.ranges.mockResolvedValue(ranges(120, 300))
    const first = render(view)
    await waitFor(() => expect(shown()).toEqual({ first: 120, last: 300 }))
    first.unmount()

    entriesStore.hydrate('br_1', [])
    reads.ranges.mockResolvedValue(ranges(120, 900))
    render(view)
    await waitFor(() => expect(shown()).toEqual({ first: 120, last: 900 }))
    act(() => entriesStore.hydrate('br_1', [entry('e1', 1)]))

    await waitFor(() => expect(shown()).toEqual({ first: 120, last: 900 }))
  })

  it('rereads when the branch changes onto a warm key while focused', async () => {
    const client = createQueryClient()
    const view = (branchId: string) => (
      <QueryClientProvider client={client}>
        <Probe focused branchId={branchId} />
      </QueryClientProvider>
    )
    reads.ranges.mockResolvedValue(ranges(120, 300))
    const { rerender } = render(view('br_2'))
    await waitFor(() => expect(shown()).toEqual({ first: 120, last: 300 }))
    rerender(view('br_1'))
    await waitFor(() => expect(reads.ranges).toHaveBeenCalledTimes(2))

    reads.ranges.mockResolvedValue(ranges(120, 900))
    rerender(view('br_2'))

    await waitFor(() => expect(shown()).toEqual({ first: 120, last: 900 }))
  })
})
