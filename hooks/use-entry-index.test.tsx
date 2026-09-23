// @vitest-environment jsdom
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createQueryClient } from '@/lib/cache'
import type { StoryEntry } from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import type { EntryRef } from '@/lib/entry-refs'
import { entriesStore, generationStore, resetAllStores, type RunState } from '@/lib/stores'

import { useEntryIndex, type EntryIndexSnapshot } from './use-entry-index'

const reads = vi.hoisted(() => ({ index: vi.fn() }))

// The runtime `db` is a bridge client; the read is what the hook composes.
vi.mock('@/lib/db', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  db: {},
}))
vi.mock('@/lib/entry-refs', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  readEntryIndex: reads.index,
}))

function entry(id: string, position: number, branchId = 'br_1'): StoryEntry {
  return {
    id,
    branchId,
    position,
    kind: 'user_action',
    content: '',
    chapterId: null,
    metadata: null,
    createdAt: position,
  }
}

function ref(id: string, position: number): EntryRef {
  return { id, position, kind: 'user_action', chapterId: null, excerpt: '' }
}

function run(id: string): RunState {
  return {
    runId: id,
    kind: 'per-turn',
    gateBehavior: 'no-gate',
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

let latest: EntryIndexSnapshot | null = null
function Probe({ branchId = 'br_1' }: { branchId?: string }) {
  latest = useEntryIndex(branchId)
  return null
}

function renderProbe(props: { branchId?: string; client?: QueryClient } = {}) {
  const client = props.client ?? createQueryClient()
  return render(
    <QueryClientProvider client={client}>
      <Probe branchId={props.branchId} />
    </QueryClientProvider>,
  )
}

describe('useEntryIndex', () => {
  beforeEach(() => {
    resetAllStores()
    latest = null
    reads.index.mockReset()
  })
  afterEach(() => {
    cleanup()
  })

  it('reads once for a branch and lists entries newest first', async () => {
    entriesStore.hydrate('br_1', [entry('e1', 1), entry('e2', 2)])
    reads.index.mockResolvedValue([ref('e2', 2), ref('e1', 1)])

    renderProbe()

    await waitFor(() => expect(latest?.ready).toBe(true))
    expect(latest?.entries.map((e) => e.id)).toEqual(['e2', 'e1'])
    expect(latest?.index.get('e1')?.position).toBe(1)
    expect(latest?.failed).toBe(false)
    expect(reads.index).toHaveBeenCalledTimes(1)
  })

  it('re-reads when the generation store settles', async () => {
    entriesStore.hydrate('br_1', [entry('e1', 1)])
    reads.index.mockResolvedValue([ref('e1', 1)])

    renderProbe()
    await waitFor(() => expect(reads.index).toHaveBeenCalledTimes(1))

    act(() => generationStore.startRun(run('r1')))
    // Negative control: starting a run alone must not trigger a re-read — only its exit does.
    await act(async () => {})
    expect(reads.index).toHaveBeenCalledTimes(1)

    act(() => generationStore.finishRun('r1'))
    await waitFor(() => expect(reads.index).toHaveBeenCalledTimes(2))
  })

  it('re-reads when the tail moves without a settle', async () => {
    entriesStore.hydrate('br_1', [entry('e1', 1)])
    reads.index.mockResolvedValueOnce([ref('e1', 1)])

    renderProbe()
    await waitFor(() => expect(reads.index).toHaveBeenCalledTimes(1))

    reads.index.mockResolvedValueOnce([ref('e2', 2), ref('e1', 1)])
    act(() => {
      entriesStore.patch('br_1', { op: 'create', id: 'e2', row: entry('e2', 2) })
    })
    await waitFor(() => expect(reads.index).toHaveBeenCalledTimes(2))
  })

  it('does not re-read when load-older adds rows behind the tail', async () => {
    entriesStore.hydrate('br_1', [entry('e2', 2), entry('e3', 3)])
    reads.index.mockResolvedValue([ref('e3', 3), ref('e2', 2)])

    renderProbe()
    await waitFor(() => expect(reads.index).toHaveBeenCalledTimes(1))

    act(() => {
      entriesStore.patch('br_1', { op: 'create', id: 'e1', row: entry('e1', 1) })
    })
    await act(async () => {})
    expect(reads.index).toHaveBeenCalledTimes(1)
  })

  it('keeps the previous entries visible while a same-branch refetch is pending', async () => {
    entriesStore.hydrate('br_1', [entry('e1', 1)])
    reads.index.mockResolvedValueOnce([ref('e1', 1)])

    renderProbe()
    await waitFor(() => expect(latest?.ready).toBe(true))

    let resolveSecond!: (rows: EntryRef[]) => void
    reads.index.mockImplementationOnce(
      () =>
        new Promise<EntryRef[]>((resolve) => {
          resolveSecond = resolve
        }),
    )
    act(() => generationStore.startRun(run('r1')))
    act(() => generationStore.finishRun('r1'))
    await waitFor(() => expect(reads.index).toHaveBeenCalledTimes(2))

    // The second read is still pending — the old entries must not blank out.
    expect(latest?.entries.map((e) => e.id)).toEqual(['e1'])
    expect(latest?.ready).toBe(true)

    await act(async () => {
      resolveSecond([ref('e1', 1), ref('e2', 2)])
    })
  })

  it('keeps the last good data after a failed refetch, and logs once', async () => {
    entriesStore.hydrate('br_1', [entry('e1', 1)])
    reads.index.mockResolvedValueOnce([ref('e1', 1)])

    renderProbe()
    await waitFor(() => expect(latest?.ready).toBe(true))

    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    reads.index.mockRejectedValueOnce(new Error('boom'))
    act(() => generationStore.startRun(run('r1')))
    act(() => generationStore.finishRun('r1'))

    await waitFor(() => expect(warnSpy).toHaveBeenCalledTimes(1))
    // The failed refetch must not blank the entries the prior success produced.
    expect(latest?.entries.map((e) => e.id)).toEqual(['e1'])
    expect(latest?.ready).toBe(true)
    expect(latest?.failed).toBe(false)

    warnSpy.mockRestore()
  })

  it('reports failed with no data when the first read for a branch fails, and never retries', async () => {
    entriesStore.hydrate('br_1', [entry('e1', 1)])
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    reads.index.mockRejectedValue(new Error('boom'))

    renderProbe()

    await waitFor(() => expect(warnSpy).toHaveBeenCalledTimes(1))
    expect(warnSpy).toHaveBeenCalledWith('app.entry_index_read_failed', {
      branchId: 'br_1',
      error: 'boom',
    })
    // Pins retry: false without depending on waitFor's default 1s timeout.
    expect(reads.index).toHaveBeenCalledTimes(1)
    expect(latest?.ready).toBe(false)
    expect(latest?.failed).toBe(true)
    expect(latest?.entries).toEqual([])

    warnSpy.mockRestore()
  })

  it('reads again on retry and clears the failure once the read succeeds', async () => {
    entriesStore.hydrate('br_1', [entry('e1', 1)])
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    reads.index.mockRejectedValueOnce(new Error('boom'))

    renderProbe()
    await waitFor(() => expect(latest?.failed).toBe(true))

    reads.index.mockResolvedValueOnce([ref('e1', 1)])
    act(() => latest?.retry())

    await waitFor(() => expect(latest?.ready).toBe(true))
    expect(reads.index).toHaveBeenCalledTimes(2)
    expect(latest?.failed).toBe(false)
    expect(latest?.entries.map((e) => e.id)).toEqual(['e1'])

    warnSpy.mockRestore()
  })

  it("does not carry another branch's entries into a fresh branch before its own read resolves", async () => {
    entriesStore.hydrate('br_1', [entry('e1', 1)])
    reads.index.mockResolvedValueOnce([ref('e1', 1)])

    const client = createQueryClient()
    const { rerender } = renderProbe({ client, branchId: 'br_1' })
    await waitFor(() => expect(latest?.ready).toBe(true))

    let resolveSecond!: (rows: EntryRef[]) => void
    reads.index.mockImplementationOnce(
      () =>
        new Promise<EntryRef[]>((resolve) => {
          resolveSecond = resolve
        }),
    )
    act(() => {
      entriesStore.hydrate('br_2', [entry('f1', 1, 'br_2')])
      // Hydrate + branchId switch land in one batch — no render sees br_1's entries
      // paired with br_2's id, isolating the branch guard from the pending-fetch path.
      rerender(
        <QueryClientProvider client={client}>
          <Probe branchId="br_2" />
        </QueryClientProvider>,
      )
    })
    expect(latest?.ready).toBe(false)
    expect(latest?.entries).toEqual([])

    await act(async () => {
      resolveSecond([ref('f1', 1)])
    })
    await waitFor(() => expect(latest?.entries.map((e) => e.id)).toEqual(['f1']))
  })
})
