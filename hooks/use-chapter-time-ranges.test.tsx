// @vitest-environment jsdom
import { onlineManager, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createQueryClient } from '@/lib/cache'
import type { ChapterTimeRanges, StoryEntry } from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import { entriesStore, generationStore, resetAllStores, type RunState } from '@/lib/stores'

import { useChapterTimeRanges } from './use-chapter-time-ranges'

const reads = vi.hoisted(() => ({ ranges: vi.fn() }))

// The runtime `db` is a bridge client; the read is what the hook composes.
vi.mock('@/lib/db', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  db: {},
  readChapterTimeRanges: reads.ranges,
}))

function ranges(first: number, last: number): ChapterTimeRanges {
  return new Map([['ch_1', { first, last }]])
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
  let resolve!: (rows: ChapterTimeRanges) => void
  reads.ranges.mockImplementationOnce(
    () =>
      new Promise<ChapterTimeRanges>((r) => {
        resolve = r
      }),
  )
  return (rows: ChapterTimeRanges) => resolve(rows)
}

type ProbeProps = { branchId?: string; enabled?: boolean }
let latest: ReturnType<typeof useChapterTimeRanges> | null = null

function Probe({ branchId = 'b1', enabled = true }: ProbeProps) {
  latest = useChapterTimeRanges(branchId, { enabled })
  return null
}

function renderProbe(props: ProbeProps = {}) {
  const client = createQueryClient()
  const view = (next: ProbeProps) => (
    <QueryClientProvider client={client}>
      <Probe {...next} />
    </QueryClientProvider>
  )
  const { rerender } = render(view(props))
  return { setProps: (next: ProbeProps) => rerender(view(next)) }
}

const shown = () => latest?.ranges.get('ch_1')

describe('useChapterTimeRanges', () => {
  beforeEach(() => {
    resetAllStores()
    latest = null
    reads.ranges.mockReset()
  })
  afterEach(() => {
    cleanup()
    onlineManager.setOnline(true)
    vi.restoreAllMocks()
  })

  it('reads the branch while enabled', async () => {
    reads.ranges.mockResolvedValueOnce(ranges(120, 300))

    renderProbe()

    await waitFor(() => expect(shown()).toEqual({ first: 120, last: 300 }))
    expect(reads.ranges).toHaveBeenCalledTimes(1)
    expect(reads.ranges).toHaveBeenCalledWith('b1', {})
  })

  it('reads nothing and shows no ranges while disabled', async () => {
    renderProbe({ enabled: false })

    await act(async () => {})

    expect(reads.ranges).not.toHaveBeenCalled()
    expect(latest?.ranges.size).toBe(0)
  })

  it('reads again on a settle', async () => {
    reads.ranges.mockResolvedValueOnce(ranges(120, 300))
    renderProbe()
    await waitFor(() => expect(shown()).toEqual({ first: 120, last: 300 }))

    reads.ranges.mockResolvedValueOnce(ranges(120, 420))
    settle()

    await waitFor(() => expect(shown()).toEqual({ first: 120, last: 420 }))
    expect(reads.ranges).toHaveBeenCalledTimes(2)
  })

  it('reads again when the tail moves without a settle', async () => {
    entriesStore.hydrate('b1', [entry('e1', 1)])
    reads.ranges.mockResolvedValueOnce(ranges(120, 300))
    renderProbe()
    await waitFor(() => expect(shown()).toEqual({ first: 120, last: 300 }))

    reads.ranges.mockResolvedValueOnce(ranges(120, 420))
    act(() => {
      entriesStore.patch('b1', { op: 'create', id: 'e2', row: entry('e2', 2) })
    })

    await waitFor(() => expect(shown()).toEqual({ first: 120, last: 420 }))
    expect(reads.ranges).toHaveBeenCalledTimes(2)
  })

  // Under the app's client: a bare QueryClient has a staleTime of 0 and reads on the flip.
  it('reads a world-time edit through refetch(), which no key change or reopen does', async () => {
    reads.ranges.mockResolvedValueOnce(ranges(120, 300))
    const { setProps } = renderProbe()
    await waitFor(() => expect(shown()).toEqual({ first: 120, last: 300 }))

    reads.ranges.mockResolvedValue(ranges(120, 900))
    setProps({ enabled: false })
    setProps({ enabled: true })
    await act(async () => {})
    expect(reads.ranges).toHaveBeenCalledTimes(1)
    expect(shown()).toEqual({ first: 120, last: 300 })

    await act(async () => {
      await latest?.refetch()
    })

    expect(reads.ranges).toHaveBeenCalledTimes(2)
    await waitFor(() => expect(shown()).toEqual({ first: 120, last: 900 }))
  })

  it('reads through refetch() while disabled', async () => {
    renderProbe({ enabled: false })
    reads.ranges.mockResolvedValueOnce(ranges(120, 300))

    await act(async () => {
      await latest?.refetch()
    })

    await waitFor(() => expect(shown()).toEqual({ first: 120, last: 300 }))
  })

  it('holds the ranges while the next key reads', async () => {
    reads.ranges.mockResolvedValueOnce(ranges(120, 300))
    renderProbe()
    await waitFor(() => expect(shown()).toEqual({ first: 120, last: 300 }))

    const land = deferredRead()
    settle()
    await waitFor(() => expect(reads.ranges).toHaveBeenCalledTimes(2))
    expect(shown()).toEqual({ first: 120, last: 300 })

    await act(async () => {
      land(ranges(120, 420))
    })
    await waitFor(() => expect(shown()).toEqual({ first: 120, last: 420 }))
  })

  it("shows no earlier branch's ranges after a switch", async () => {
    reads.ranges.mockResolvedValueOnce(ranges(120, 300))
    const { setProps } = renderProbe()
    await waitFor(() => expect(shown()).toEqual({ first: 120, last: 300 }))

    const land = deferredRead()
    setProps({ branchId: 'b2' })
    expect(shown()).toBeUndefined()
    await waitFor(() => expect(reads.ranges).toHaveBeenCalledWith('b2', {}))

    await act(async () => {
      land(ranges(600, 900))
    })
    await waitFor(() => expect(shown()).toEqual({ first: 600, last: 900 }))
  })

  it('logs a failed read, shows no ranges and never retries', async () => {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    reads.ranges.mockRejectedValue(new Error('boom'))

    renderProbe()

    await waitFor(() => expect(warnSpy).toHaveBeenCalledTimes(1))
    expect(warnSpy).toHaveBeenCalledWith('app.chapter_time_ranges_read_failed', {
      branchId: 'b1',
      error: 'boom',
    })
    expect(reads.ranges).toHaveBeenCalledTimes(1)
    expect(latest?.ranges.size).toBe(0)
  })

  // The reader stays mounted, hidden, under the routes that show their own surface.
  it('logs a failed read once across mounted instances', async () => {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    reads.ranges.mockRejectedValue(new Error('boom'))

    render(
      <QueryClientProvider client={createQueryClient()}>
        <Probe enabled={false} />
        <Probe />
      </QueryClientProvider>,
    )

    await waitFor(() => expect(warnSpy).toHaveBeenCalled())
    await act(async () => {})
    expect(reads.ranges).toHaveBeenCalledTimes(1)
    expect(warnSpy).toHaveBeenCalledTimes(1)
  })

  it('keeps the ranges when a refetch fails, and resolves', async () => {
    reads.ranges.mockResolvedValueOnce(ranges(120, 300))
    renderProbe()
    await waitFor(() => expect(shown()).toEqual({ first: 120, last: 300 }))

    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    reads.ranges.mockRejectedValueOnce(new Error('boom'))
    await act(async () => {
      await latest?.refetch()
    })

    await waitFor(() => expect(warnSpy).toHaveBeenCalledTimes(1))
    expect(shown()).toEqual({ first: 120, last: 300 })
  })

  // Accepted: TanStack applies placeholderData only while pending; a failing local read is rare.
  it('shows no ranges when a settle read fails, with ranges showing before it', async () => {
    reads.ranges.mockResolvedValueOnce(ranges(120, 300))
    renderProbe()
    await waitFor(() => expect(shown()).toEqual({ first: 120, last: 300 }))

    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    reads.ranges.mockRejectedValueOnce(new Error('boom'))
    settle()

    await waitFor(() => expect(warnSpy).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(latest?.ranges.size).toBe(0))
  })

  // The read is local, so a lost network must not pause it.
  it('keeps reading while the app is offline', async () => {
    reads.ranges.mockResolvedValueOnce(ranges(120, 300))
    renderProbe()
    await waitFor(() => expect(shown()).toEqual({ first: 120, last: 300 }))

    act(() => onlineManager.setOnline(false))
    reads.ranges.mockResolvedValueOnce(ranges(120, 420))
    settle()

    await waitFor(() => expect(shown()).toEqual({ first: 120, last: 420 }))
  })
})
