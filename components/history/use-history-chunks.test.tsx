// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { useLayoutEffect, useState, type ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Delta } from '@/lib/db'
import { logger } from '@/lib/diagnostics'
import type { HistoryChunk, HistoryQuery, HistoryRow } from '@/lib/history'
import { toast } from '@/lib/toast'

import { HistoryLoaderProvider, type HistoryLoader } from './history-loader'
import { useHistoryChunks } from './use-history-chunks'

const row = (logPosition: number): HistoryRow => ({
  delta: { id: `delta_${logPosition}`, logPosition } as Delta,
  via: { kind: 'own' },
})

const chunk = (
  rows: readonly HistoryRow[],
  nextCursor: number | null,
  names: Readonly<Record<string, string>> = {},
): HistoryChunk => ({ rows: [...rows], nextCursor, names })

const positions = (rows: readonly HistoryRow[]) => rows.map((r) => r.delta.logPosition)

function autoLoader() {
  return vi.fn(
    async (query: HistoryQuery): Promise<HistoryChunk> =>
      query.cursor == null ? chunk([row(4), row(3)], 3) : chunk([row(2)], null),
  )
}

/** Each call waits until the test settles it, so responses can land out of order. */
function manualLoader() {
  const calls: {
    query: HistoryQuery
    resolve: (chunk: HistoryChunk) => void
    reject: (error: Error) => void
  }[] = []
  const load = vi.fn(
    (query: HistoryQuery) =>
      new Promise<HistoryChunk>((resolve, reject) => calls.push({ query, resolve, reject })),
  )
  return { load, calls }
}

function setup(load: HistoryLoader = autoLoader()) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <HistoryLoaderProvider value={load}>{children}</HistoryLoaderProvider>
  )
  const version = {}
  const hook = renderHook(
    ({ search, version }: { search: string; version: object }) =>
      useHistoryChunks(
        { branchId: 'b1', targetTable: 'entities', targetId: 'char_1', search, sort: 'newest' },
        version,
      ),
    { wrapper, initialProps: { search: '', version } },
  )
  return { load, hook, version }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('useHistoryChunks', () => {
  it('loads the first chunk once and appends the next only on loadMore', async () => {
    const { load, hook } = setup()
    await waitFor(() => expect(hook.result.current.status).toBe('ready'))
    expect(positions(hook.result.current.rows)).toEqual([4, 3])
    expect(hook.result.current.hasMore).toBe(true)
    expect(load).toHaveBeenCalledTimes(1)

    act(() => hook.result.current.loadMore())
    await waitFor(() => expect(positions(hook.result.current.rows)).toEqual([4, 3, 2]))
    expect(load).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: 3 }))
    expect(hook.result.current.hasMore).toBe(false)
  })

  it('starts over from the first chunk when the query changes', async () => {
    const { load, hook, version } = setup()
    await waitFor(() => expect(hook.result.current.status).toBe('ready'))
    hook.rerender({ search: 'traits', version })
    await waitFor(() =>
      expect(load).toHaveBeenLastCalledWith(
        expect.objectContaining({ search: 'traits', cursor: null }),
      ),
    )
    await waitFor(() => expect(positions(hook.result.current.rows)).toEqual([4, 3]))
  })

  it('refreshes in place when the version changes, keeping the loaded rows until the refetch lands', async () => {
    const { load, calls } = manualLoader()
    const { hook } = setup(load)
    await waitFor(() => expect(calls).toHaveLength(1))
    await act(async () => calls[0].resolve(chunk([row(4), row(3)], 3)))
    act(() => hook.result.current.loadMore())
    await act(async () => calls[1].resolve(chunk([row(2)], null)))

    hook.rerender({ search: '', version: {} })
    expect(hook.result.current.status).toBe('ready')
    expect(positions(hook.result.current.rows)).toEqual([4, 3, 2])
    await waitFor(() => expect(calls).toHaveLength(3))
    expect(calls[2].query).toEqual(expect.objectContaining({ cursor: null, limit: 50 }))

    await act(async () => calls[2].resolve(chunk([row(5), row(4), row(3)], 3)))
    expect(positions(hook.result.current.rows)).toEqual([5, 4, 3])
    expect(hook.result.current.hasMore).toBe(true)
  })

  it('refetches every loaded row on a version change once more than a chunk is loaded', async () => {
    const { load, calls } = manualLoader()
    const { hook } = setup(load)
    await waitFor(() => expect(calls).toHaveLength(1))
    const firstPage = Array.from({ length: 50 }, (_, i) => row(100 - i))
    await act(async () => calls[0].resolve(chunk(firstPage, 51)))
    act(() => hook.result.current.loadMore())
    await waitFor(() => expect(calls).toHaveLength(2))
    expect(calls[1].query).toEqual(expect.objectContaining({ cursor: 51 }))
    await act(async () =>
      calls[1].resolve(
        chunk(
          Array.from({ length: 10 }, (_, i) => row(50 - i)),
          null,
        ),
      ),
    )
    expect(hook.result.current.rows).toHaveLength(60)

    hook.rerender({ search: '', version: {} })
    await waitFor(() => expect(calls).toHaveLength(3))
    expect(calls[2].query).toEqual(expect.objectContaining({ cursor: null, limit: 60 }))
  })

  it('keeps the shown rows when a version refresh fails, and logs it', async () => {
    const error = vi.spyOn(logger, 'error').mockImplementation(() => {})
    const { load, calls } = manualLoader()
    const { hook } = setup(load)
    await waitFor(() => expect(calls).toHaveLength(1))
    await act(async () => calls[0].resolve(chunk([row(4), row(3)], 3)))

    hook.rerender({ search: '', version: {} })
    await waitFor(() => expect(calls).toHaveLength(2))
    await act(async () => calls[1].reject(new Error('busy')))
    expect(hook.result.current.status).toBe('ready')
    expect(positions(hook.result.current.rows)).toEqual([4, 3])
    expect(hook.result.current.hasMore).toBe(true)
    expect(error).toHaveBeenCalledWith('app.history_load_failed', expect.anything())
  })

  it('ignores loadMore while a version refresh is in flight', async () => {
    const { load, calls } = manualLoader()
    const { hook } = setup(load)
    await waitFor(() => expect(calls).toHaveLength(1))
    await act(async () => calls[0].resolve(chunk([row(4), row(3)], 3)))

    hook.rerender({ search: '', version: {} })
    await waitFor(() => expect(calls).toHaveLength(2))
    act(() => hook.result.current.loadMore())
    expect(calls).toHaveLength(2)

    await act(async () => calls[1].resolve(chunk([row(5), row(4)], 4)))
    act(() => hook.result.current.loadMore())
    expect(calls).toHaveLength(3)
    expect(calls[2].query).toEqual(expect.objectContaining({ cursor: 4 }))
  })

  it('shows loading with no rows while a changed query reloads (same-commit reset: ClearingASearch story)', async () => {
    const { load, calls } = manualLoader()
    const { hook, version } = setup(load)
    await waitFor(() => expect(calls).toHaveLength(1))
    await act(async () => calls[0].resolve(chunk([row(4), row(3)], 3)))
    expect(hook.result.current.status).toBe('ready')

    hook.rerender({ search: 'traits', version })
    expect(hook.result.current.status).toBe('loading')
    expect(hook.result.current.rows).toEqual([])
    expect(hook.result.current.hasMore).toBe(false)

    await act(async () => calls[1].resolve(chunk([row(4)], null)))
    expect(hook.result.current.status).toBe('ready')
  })

  it('fails the first chunk, then retries it from the top', async () => {
    const { load, calls } = manualLoader()
    const { hook } = setup(load)
    await waitFor(() => expect(calls).toHaveLength(1))
    await act(async () => calls[0].reject(new Error('read failed')))
    expect(hook.result.current.status).toBe('failed')

    act(() => hook.result.current.retry())
    expect(hook.result.current.status).toBe('loading')
    expect(calls).toHaveLength(2)
    expect(calls[1].query.cursor).toBeNull()
    await act(async () => calls[1].resolve(chunk([row(4)], null)))
    expect(positions(hook.result.current.rows)).toEqual([4])
  })

  it('keeps the newer first chunk when the superseded one resolves after it', async () => {
    const { load, calls } = manualLoader()
    const { hook, version } = setup(load)
    await waitFor(() => expect(calls).toHaveLength(1))
    hook.rerender({ search: 'traits', version })
    await waitFor(() => expect(calls).toHaveLength(2))

    await act(async () => calls[1].resolve(chunk([row(9)], null)))
    await act(async () => calls[0].resolve(chunk([row(4), row(3)], 3)))
    expect(positions(hook.result.current.rows)).toEqual([9])
    expect(hook.result.current.hasMore).toBe(false)
  })

  it('never shows a superseded first chunk as ready when it lands between the reset commit and its effects', async () => {
    const { load, calls } = manualLoader()
    const version = {}
    const shown: { search: string; status: string; rows: number[] }[] = []
    let setSearch: (search: string) => void = () => {}
    const wrapper = ({ children }: { children: ReactNode }) => (
      <HistoryLoaderProvider value={load}>{children}</HistoryLoaderProvider>
    )
    const hook = renderHook(
      () => {
        const [search, set] = useState('')
        setSearch = set
        const chunks = useHistoryChunks(
          { branchId: 'b1', targetTable: 'entities', targetId: 'char_1', search, sort: 'newest' },
          version,
        )
        shown.push({ search, status: chunks.status, rows: positions(chunks.rows) })
        // Settles the old read inside the new query's commit, before its passive effects run.
        useLayoutEffect(() => {
          if (search === 'traits') calls[0].resolve(chunk([row(4), row(3)], 3))
        }, [search])
        return chunks
      },
      { wrapper },
    )
    await waitFor(() => expect(calls).toHaveLength(1))

    // A debounced value lands from a timer, so React renders it at default priority.
    setTimeout(() => setSearch('traits'), 0)
    await waitFor(() => expect(calls).toHaveLength(2))
    await act(async () => {})
    expect(shown.filter((s) => s.search === 'traits' && s.status === 'ready')).toEqual([])
    expect(hook.result.current.status).toBe('loading')

    act(() => hook.result.current.loadMore())
    expect(calls).toHaveLength(2)
    await act(async () => calls[1].resolve(chunk([row(9)], null)))
    expect(hook.result.current.status).toBe('ready')
    expect(positions(hook.result.current.rows)).toEqual([9])
  })

  it('drops a loadMore that resolves after the query changed', async () => {
    const { load, calls } = manualLoader()
    const { hook, version } = setup(load)
    await waitFor(() => expect(calls).toHaveLength(1))
    await act(async () => calls[0].resolve(chunk([row(4), row(3)], 3)))
    act(() => hook.result.current.loadMore())
    expect(calls[1].query.cursor).toBe(3)

    hook.rerender({ search: 'traits', version })
    await waitFor(() => expect(calls).toHaveLength(3))
    await act(async () => calls[2].resolve(chunk([row(8)], 8)))
    await act(async () => calls[1].resolve(chunk([row(2)], null)))
    expect(positions(hook.result.current.rows)).toEqual([8])
    expect(hook.result.current.status).toBe('ready')

    act(() => hook.result.current.loadMore())
    expect(calls).toHaveLength(4)
    expect(calls[3].query).toMatchObject({ search: 'traits', cursor: 8 })
  })

  it('fires one load for two loadMore calls before a re-render', async () => {
    const { load, calls } = manualLoader()
    const { hook } = setup(load)
    await waitFor(() => expect(calls).toHaveLength(1))
    await act(async () => calls[0].resolve(chunk([row(4), row(3)], 3)))
    act(() => {
      hook.result.current.loadMore()
      hook.result.current.loadMore()
    })
    expect(calls).toHaveLength(2)
    await act(async () => calls[1].resolve(chunk([row(2)], 2)))
    expect(positions(hook.result.current.rows)).toEqual([4, 3, 2])

    act(() => hook.result.current.loadMore())
    expect(calls).toHaveLength(3)
    expect(calls[2].query.cursor).toBe(2)
  })

  it('keeps the loaded rows and toasts when a loadMore fails, then loads again', async () => {
    const toastError = vi.spyOn(toast, 'error')
    const { load, calls } = manualLoader()
    const { hook } = setup(load)
    await waitFor(() => expect(calls).toHaveLength(1))
    await act(async () => calls[0].resolve(chunk([row(4), row(3)], 3)))
    act(() => hook.result.current.loadMore())
    await act(async () => calls[1].reject(new Error('read failed')))
    expect(toastError).toHaveBeenCalledTimes(1)
    expect(positions(hook.result.current.rows)).toEqual([4, 3])
    expect(hook.result.current.status).toBe('ready')

    act(() => hook.result.current.loadMore())
    expect(calls).toHaveLength(3)
    expect(calls[2].query.cursor).toBe(3)
  })

  it('stays silent when a loadMore fails after unmount', async () => {
    const toastError = vi.spyOn(toast, 'error')
    const { load, calls } = manualLoader()
    const { hook } = setup(load)
    await waitFor(() => expect(calls).toHaveLength(1))
    await act(async () => calls[0].resolve(chunk([row(4), row(3)], 3)))
    act(() => hook.result.current.loadMore())

    hook.unmount()
    await act(async () => calls[1].reject(new Error('read failed')))
    expect(toastError).not.toHaveBeenCalled()
  })

  it("merges each loaded chunk's names, and a refresh replaces them", async () => {
    const { load, calls } = manualLoader()
    const { hook } = setup(load)
    await waitFor(() => expect(calls).toHaveLength(1))
    await act(async () => calls[0].resolve(chunk([row(4), row(3)], 3, { char_kael: 'Kael' })))
    expect(hook.result.current.names).toEqual({ char_kael: 'Kael' })

    act(() => hook.result.current.loadMore())
    await act(async () => calls[1].resolve(chunk([row(2)], null, { char_zed: 'Zed' })))
    expect(hook.result.current.names).toEqual({ char_kael: 'Kael', char_zed: 'Zed' })

    hook.rerender({ search: '', version: {} })
    await waitFor(() => expect(calls).toHaveLength(3))
    await act(async () =>
      calls[2].resolve(chunk([row(4), row(3), row(2)], null, { char_mira: 'Mira' })),
    )
    expect(hook.result.current.names).toEqual({ char_mira: 'Mira' })
  })
})
